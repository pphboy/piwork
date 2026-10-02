package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/packageprepare"
	"piwork/internal/pipackage"
	"piwork/internal/safefs"
	"piwork/internal/workcontext"
)

type packageWorker struct {
	cancel context.CancelFunc
	done   chan struct{}
}

func (a *Application) kickCorePackageJob(id string) {
	a.mu.Lock()
	if a.closed || a.ctx.Err() != nil {
		a.mu.Unlock()
		return
	}
	workerContext, cancel := context.WithCancel(a.ctx)
	worker := &packageWorker{cancel: cancel, done: make(chan struct{})}
	if _, already := a.packageRunning.LoadOrStore(id, worker); already {
		cancel()
		a.mu.Unlock()
		return
	}
	a.packageWG.Add(1)
	a.mu.Unlock()
	go func() {
		defer a.packageWG.Done()
		defer a.packageRunning.Delete(id)
		defer close(worker.done)
		defer cancel()
		select {
		case a.packageSlots <- struct{}{}:
			defer func() { <-a.packageSlots }()
		case <-workerContext.Done():
			return
		}
		var job corestore.PackageJob
		if err := a.Store.Read(a.ctx, func(tx *sql.Tx) error { var err error; job, err = corestore.ReadPackageJob(tx, id); return err }); err != nil || job.Phase != "queued" || job.LeasesReleased {
			return
		}
		a.runCorePackageJob(workerContext, job)
	}()
}

func packageNow() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func packageWorkID(job corestore.PackageJob) string {
	if job.WorkID != nil {
		return *job.WorkID
	}
	return "core"
}

func (a *Application) advanceCorePackage(ctx context.Context, job corestore.PackageJob, phase string, name, helper *string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.AdvancePackageJob(tx, job.OperationID, job.WorkerEpoch, phase, packageNow(), name, helper)
	})
}

func (a *Application) openCorePackageJobRoot(id string) (*safefs.Root, error) {
	a.packageStorageMu.Lock()
	defer a.packageStorageMu.Unlock()
	parent, err := a.Store.OpenPackageArea("jobs")
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	return parent.OpenDirectory(id)
}

func (a *Application) removeCorePackageJobRoot(id string) error {
	a.packageStorageMu.Lock()
	defer a.packageStorageMu.Unlock()
	parent, err := a.Store.OpenPackageArea("jobs")
	if err != nil {
		return err
	}
	defer parent.Close()
	err = parent.RemoveTree(id)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

func (a *Application) runCorePackageJob(parent context.Context, job corestore.PackageJob) {
	deadline, err := time.Parse(time.RFC3339Nano, job.DeadlineAt)
	if err != nil {
		a.finishCorePackage(job, "source", packageprepare.ErrResult, false)
		return
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	defer cancel()
	stage := "source"
	if err := a.advanceCorePackage(ctx, job, stage, nil, nil); err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	root, err := a.openCorePackageJobRoot(job.OperationID)
	if err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	defer root.Close()
	keep := false
	defer func() {
		if !keep {
			root.Close()
			_ = a.removeCorePackageJobRoot(job.OperationID)
		}
	}()
	path, err := root.Path("source")
	if err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	if err := os.Mkdir(path, 0755); err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	spoolPath, _ := root.Path("spool")
	if err := os.Mkdir(spoolPath, 0700); err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	// Docker is local; use canonical paths for its bind mounts, not /proc/self
	// paths that would resolve against the Engine process's file descriptors.
	jobDir := filepath.Join(a.options.DataDirectory, "pi-packages", "jobs", job.OperationID)
	jobDir, err = filepath.Abs(jobDir)
	if err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	sourceDir := filepath.Join(jobDir, "source")
	spoolDir := filepath.Join(jobDir, "spool")
	if err := a.materializeCorePackageSource(ctx, job, sourceDir); err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	environment, err := pipackage.ValidateEnvironment([]byte(job.PreparedEnvironmentJSON))
	if err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	stage = "prepare"
	if err := a.advanceCorePackage(ctx, job, stage, nil, nil); err != nil {
		a.finishCorePackage(job, stage, err, false)
		return
	}
	var source packageSourceInput
	if json.Unmarshal([]byte(job.SourceJSON), &source) != nil {
		a.finishCorePackage(job, stage, pipackage.ErrSource, false)
		return
	}
	if source.Kind == "core" {
		prepared, err := a.captureFromCore(ctx, job, spoolDir)
		if err == nil {
			stage, err = a.publishCapturedCorePackage(ctx, job, prepared)
		}
		if err != nil {
			a.finishCorePackage(job, stage, err, false)
		}
		return
	}
	identity := dockerengine.PackageIdentity{WorkID: packageWorkID(job), JobID: job.OperationID}
	prepared, err := packageprepare.Prepare(ctx, packageprepare.Input{Runtime: a.dockerRuntime, Identity: identity, Epoch: job.WorkerEpoch, PrepareImageID: job.PrepareImageID, TrustedImageID: job.TrustedHelperImageID, SourceDirectory: sourceDir, SpoolDirectory: spoolDir, Environment: environment,
		OnPlanned: func(ctx context.Context, spec dockerengine.PackageHelperSpec) error {
			name := a.dockerRuntime.PackageHelperName(spec)
			return a.advanceCorePackage(ctx, job, "prepare", nil, &name)
		},
		OnRemoved: func(ctx context.Context, spec dockerengine.PackageHelperSpec) error {
			return a.Store.ReleaseResourceIntent(ctx, packageWorkID(job), "package-helper", job.OperationID+"-"+strconv.FormatInt(job.WorkerEpoch, 10)+"-"+spec.Action, true)
		},
		OnResourcesRemoved: func(ctx context.Context) error {
			if err := a.dockerRuntime.ConfirmPackageAbsence(ctx, identity); err != nil {
				return err
			}
			if err := a.Store.ReleaseResourceIntent(ctx, packageWorkID(job), "package-network", job.OperationID, true); err != nil {
				return err
			}
			return a.Store.ReleaseResourceIntent(ctx, packageWorkID(job), "package-volume", job.OperationID, true)
		}})
	if err != nil {
		keep = errors.Is(err, packageprepare.ErrCleanup)
		if ctx.Err() != nil {
			err = ctx.Err()
		}
		a.finishCorePackage(job, stage, err, keep)
		return
	}
	stage, err = a.publishCapturedCorePackage(ctx, job, prepared)
	if err != nil {
		a.finishCorePackage(job, stage, err, false)
	}
}

func (a *Application) cancelWorkPackageJobs(ctx context.Context, workID string) error {
	var jobs []corestore.PackageJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PackageJobs(tx, true); return err }); err != nil {
		return err
	}
	for _, job := range jobs {
		if job.WorkID == nil || *job.WorkID != workID {
			continue
		}
		if value, ok := a.packageRunning.Load(job.OperationID); ok {
			value.(*packageWorker).cancel()
		}
	}
	return nil
}

func (a *Application) settleWorkPackageJobs(ctx context.Context, workID string) error {
	if err := a.cancelWorkPackageJobs(ctx, workID); err != nil {
		return err
	}
	var jobs []corestore.PackageJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PackageJobs(tx, true); return err }); err != nil {
		return err
	}
	for _, job := range jobs {
		if job.WorkID == nil || *job.WorkID != workID {
			continue
		}
		if value, ok := a.packageRunning.Load(job.OperationID); ok {
			select {
			case <-value.(*packageWorker).done:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
	return a.assertPackageScopeIdle(ctx, workID)
}

func (a *Application) publishCapturedCorePackage(ctx context.Context, job corestore.PackageJob, prepared packageprepare.Result) (string, error) {
	stage := "validate"
	name := string(prepared.Artifact.Metadata.Name)
	if job.Kind == "update" && (job.PackageName == nil || *job.PackageName != name) {
		return stage, contracts.NewError("PI_PACKAGE_NAME_MISMATCH", "")
	}
	if err := a.advanceCorePackage(ctx, job, stage, &name, nil); err != nil {
		return stage, err
	}
	storagePath, err := a.publishCorePackageBytes(ctx, prepared)
	if err != nil {
		return stage, err
	}
	if job.ScopeKind == "work" {
		return "publish", a.publishWorkPackage(ctx, job, workcontext.PackageSource{Name: name, Directory: filepath.Join(a.options.DataDirectory, storagePath), Metadata: prepared.Artifact.Metadata})
	}
	stage = "publish"
	if err := a.advanceCorePackage(ctx, job, stage, &name, nil); err != nil {
		return stage, err
	}
	metadataJSON, _ := json.Marshal(prepared.Artifact.Metadata)
	resultJSON, _ := json.Marshal(map[string]any{"name": name, "version": prepared.Artifact.Metadata.Version, "resourceCounts": prepared.Artifact.Metadata.ResourceCounts, "scope": "core"})
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.CommitPackageJob(tx, job.OperationID, job.WorkerEpoch, packageNow(), string(resultJSON), true, func(tx *sql.Tx, current corestore.PackageJob) error {
			var exists bool
			var enabled bool
			var generation int64
			err := tx.QueryRow(`SELECT enabled,generation FROM pi_package_catalog WHERE name=?`, name).Scan(&enabled, &generation)
			if err == nil {
				exists = true
			} else if err != sql.ErrNoRows {
				return err
			}
			if job.Kind == "install" && exists {
				return contracts.NewError("PI_PACKAGE_ALREADY_INSTALLED", "")
			}
			if job.Kind == "update" && !exists {
				return contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
			}
			if generation >= contracts.MaxSafeInteger {
				return corestore.ErrRevisionConflict
			}
			artifact := corestore.PackageArtifact{ID: "core:" + job.OperationID, ScopeKind: "core", Name: name, ContentDigest: string(prepared.Artifact.Metadata.ContentDigest), MetadataJSON: string(metadataJSON), StoragePath: storagePath, CreatedAt: packageNow()}
			if err := corestore.InsertPackageArtifact(tx, artifact); err != nil {
				return err
			}
			if job.Kind == "install" {
				if _, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES(?,1,?,1,?,?)`, name, artifact.ID, artifact.CreatedAt, artifact.CreatedAt); err != nil {
					return err
				}
			} else {
				if _, err := tx.Exec(`UPDATE pi_package_catalog SET head_artifact_id=?,generation=generation+1,updated_at=? WHERE name=?`, artifact.ID, artifact.CreatedAt, name); err != nil {
					return err
				}
			}
			if current.AddToDefaults {
				return corestore.AppendDefaultPackageTx(tx, prepared.Artifact.Metadata.Name, artifact.CreatedAt)
			}
			return nil
		})
	})
	return stage, err
}

func (a *Application) materializeCorePackageSource(ctx context.Context, job corestore.PackageJob, directory string) error {
	var source packageSourceInput
	if json.Unmarshal([]byte(job.SourceJSON), &source) != nil {
		return pipackage.ErrSource
	}
	requestSource := map[string]string{"kind": source.Kind, "spec": source.Spec}
	root, err := os.OpenRoot(directory)
	if err != nil {
		return err
	}
	defer root.Close()
	if source.Kind == "core" {
		return nil
	}
	if source.Kind == "upload" {
		var upload corestore.PackageUpload
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			upload, err = corestore.ReadPackageUpload(tx, source.UploadID)
			return err
		}); err != nil {
			return err
		}
		if job.SourceUploadID == nil || upload.ID != *job.SourceUploadID || upload.ActorID != job.ActorID || upload.ScopeKind != job.ScopeKind || (upload.WorkID == nil) != (job.WorkID == nil) || job.WorkID != nil && *upload.WorkID != *job.WorkID || upload.State != "ready" || upload.Digest == nil || upload.LeaseCount <= 0 {
			return pipackage.ErrSource
		}
		uploads, err := a.Store.OpenPackageUploadsRoot()
		if err != nil {
			return err
		}
		defer uploads.Close()
		input, err := uploads.OpenFile(upload.ID+".zip", unix.O_RDONLY)
		if err != nil {
			return err
		}
		defer input.Close()
		output, err := root.OpenFile("input.zip", os.O_CREATE|os.O_EXCL|os.O_WRONLY|unix.O_NOFOLLOW, 0644)
		if err != nil {
			return err
		}
		hash := sha256.New()
		n, copyErr := io.CopyBuffer(io.MultiWriter(output, hash), io.LimitReader(input, pipackage.CompressedBytes+1), make([]byte, 32<<10))
		syncErr := output.Sync()
		closeErr := output.Close()
		if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
			return err
		}
		if n != upload.Size || "sha256:"+hex.EncodeToString(hash.Sum(nil)) != *upload.Digest {
			return pipackage.ErrSource
		}
		requestSource = map[string]string{"kind": upload.SourceKind, "displayName": upload.DisplayName}
	} else if source.Kind != "npm" && source.Kind != "git" {
		return pipackage.ErrSource
	}
	raw, _ := json.Marshal(map[string]any{"source": requestSource})
	request, err := root.OpenFile("request.json", os.O_CREATE|os.O_EXCL|os.O_WRONLY|unix.O_NOFOLLOW, 0644)
	if err != nil {
		return err
	}
	_, writeErr := request.Write(raw)
	syncErr := request.Sync()
	closeErr := request.Close()
	return errors.Join(writeErr, syncErr, closeErr)
}

func (a *Application) publishCorePackageBytes(ctx context.Context, result packageprepare.Result) (string, error) {
	a.packageStorageMu.Lock()
	defer a.packageStorageMu.Unlock()
	area, err := a.Store.OpenPackageArea("artifacts")
	if err != nil {
		return "", err
	}
	defer area.Close()
	parentPath, err := area.Path("unused")
	if err != nil {
		return "", err
	}
	parent, err := os.OpenRoot(filepath.Dir(parentPath))
	if err != nil {
		return "", err
	}
	defer parent.Close()
	name := strings.TrimPrefix(string(result.Artifact.Metadata.ContentDigest), "sha256:")
	if len(name) != 64 || !packageUploadDigest.MatchString(name) {
		return "", pipackage.ErrManifest
	}
	if info, err := parent.Lstat(name); errors.Is(err, os.ErrNotExist) {
		zip, err := os.OpenFile(result.ZipPath, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
		if err != nil {
			return "", err
		}
		defer zip.Close()
		if _, err := pipackage.ExtractArchiveAt(ctx, zip, parent, name); err != nil {
			return "", err
		}
	} else if err != nil || !info.IsDir() {
		return "", pipackage.ErrUnsafe
	}
	tree, err := pipackage.OpenTreeAt(ctx, parent, name)
	if err != nil {
		return "", err
	}
	defer tree.Close()
	if _, err := pipackage.ValidateArtifact(tree, string(result.Artifact.Metadata.SourceKind), result.Artifact.Metadata.ResolvedSource, result.Artifact.Metadata.PreparedEnvironment, string(result.Artifact.Metadata.ContentDigest)); err != nil {
		return "", err
	}
	if err := area.Sync(); err != nil {
		return "", err
	}
	return filepath.Join("pi-packages", "artifacts", name), nil
}

func packageFailureCode(err error) string {
	if errors.Is(err, context.Canceled) {
		return "PI_PACKAGE_INTERRUPTED"
	}
	var cleanup *packageprepare.CleanupError
	if errors.As(err, &cleanup) && cleanup.Primary == nil {
		return "PI_PACKAGE_CLEANUP_PENDING"
	}
	if code, ok := pipackage.ErrorCode(err).(string); ok {
		return code
	}
	var public *contracts.PublicError
	if errors.As(err, &public) {
		_, view := contracts.ProjectError(public)
		return view.Code
	}
	var repository *corestore.RepositoryError
	if errors.As(err, &repository) {
		return repository.Code()
	}
	return "PI_PACKAGE_PREPARATION_FAILED"
}

func (a *Application) finishCorePackage(job corestore.PackageJob, stage string, err error, cleanupPending bool) error {
	code := packageFailureCode(err)
	message := packageFailureMessage(code)
	phase := "failed"
	var cleanupError *string
	if cleanupPending {
		phase = "cleanup-pending"
		safe := "Package cleanup is pending"
		cleanupError = &safe
	}
	if !cleanupPending && job.WorkID != nil {
		if operation, readErr := a.Store.Operation(context.Background(), job.OperationID); readErr == nil && operation.State == "superseded" {
			phase = "superseded"
		}
	}
	raw, _ := json.Marshal(map[string]string{"stage": stage, "code": code, "message": message})
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.FinishPackageJob(tx, job.OperationID, job.WorkerEpoch, phase, packageNow(), string(raw), cleanupError, !cleanupPending)
	})
}

func packageFailureMessage(code string) string {
	switch code {
	case "PI_PACKAGE_SOURCE_FETCH_FAILED":
		return "Package source fetch failed"
	case "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED":
		return "Package dependency installation failed"
	case "PI_PACKAGE_PREPARATION_FAILED":
		return "Package preparation failed"
	case "PI_PACKAGE_INTERRUPTED":
		return "Package preparation was interrupted by Core restart"
	case "PI_PACKAGE_CLEANUP_PENDING":
		return "Package cleanup is pending"
	}
	return strings.ReplaceAll(code, "_", " ")
}
