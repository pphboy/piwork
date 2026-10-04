package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/packagehelper"
	"piwork/internal/packageprepare"
	"piwork/internal/pipackage"
	"piwork/internal/workcontext"
)

// The captured Core artifact has a durable lease selected in the acceptance
// transaction. A later catalog update cannot substitute another source.
func (a *Application) captureFromCore(ctx context.Context, job corestore.PackageJob, spool string) (packageprepare.Result, error) {
	var source packageSourceInput
	if json.Unmarshal([]byte(job.SourceJSON), &source) != nil || source.Kind != "core" || source.ArtifactID == "" {
		return packageprepare.Result{}, pipackage.ErrSource
	}
	var stored corestore.PackageArtifact
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		stored, err = corestore.ReadPackageArtifact(tx, source.ArtifactID)
		return err
	}); err != nil {
		return packageprepare.Result{}, err
	}
	if stored.ScopeKind != "core" || stored.Name != source.Name || stored.LeaseCount <= 0 || filepath.Clean(stored.StoragePath) != stored.StoragePath || filepath.IsAbs(stored.StoragePath) || !strings.HasPrefix(stored.StoragePath, "pi-packages/artifacts/") {
		return packageprepare.Result{}, corestore.ErrStorage
	}
	metadata, err := contracts.Decode[contracts.PiPackageArtifactMetadata](strings.NewReader(stored.MetadataJSON), "PiPackageArtifactMetadataSchema", 2<<20)
	if err != nil {
		return packageprepare.Result{}, err
	}
	environment, err := pipackage.ValidateEnvironment([]byte(job.PreparedEnvironmentJSON))
	if err != nil || pipackage.AssertEnvironment(metadata.PreparedEnvironment, environment) != nil {
		return packageprepare.Result{}, pipackage.ErrEnvironment
	}
	directory := filepath.Join(a.options.DataDirectory, stored.StoragePath)
	parent, err := os.OpenRoot(filepath.Dir(directory))
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer parent.Close()
	tree, err := pipackage.OpenTreeAt(ctx, parent, filepath.Base(directory))
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer tree.Close()
	artifact, err := pipackage.ValidateArtifact(tree, string(metadata.SourceKind), metadata.ResolvedSource, environment, stored.ContentDigest)
	if err != nil {
		return packageprepare.Result{}, err
	}
	left, _ := json.Marshal(artifact.Metadata)
	right, _ := json.Marshal(metadata)
	if string(left) != string(right) {
		return packageprepare.Result{}, pipackage.ErrManifest
	}
	packed, err := pipackage.PackArchive(ctx, tree, filepath.Join(spool, "artifact.zip"))
	if err != nil {
		return packageprepare.Result{}, err
	}
	capture := packagehelper.Captured{Artifact: artifact, ZipBytes: packed.Bytes, ZipSHA256: packed.Digest}
	raw, _ := json.Marshal(capture)
	root, err := os.OpenRoot(spool)
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer root.Close()
	f, err := root.OpenFile("result.json", os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return packageprepare.Result{}, err
	}
	_, writeErr := f.Write(raw)
	syncErr := f.Sync()
	closeErr := f.Close()
	if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
		return packageprepare.Result{}, err
	}
	return packageprepare.ValidateCapture(ctx, spool, job.OperationID, environment, capture)
}

func (a *Application) publishWorkPackage(ctx context.Context, job corestore.PackageJob, source workcontext.PackageSource) error {
	if job.WorkID == nil {
		return corestore.ErrStorage
	}
	workID := *job.WorkID
	var candidateSource packageSourceInput
	if strictMetadata([]byte(job.SourceJSON), &candidateSource) != nil {
		return corestore.ErrStorage
	}
	var submission *contracts.BrainCandidateSubmission
	if candidateSource.Kind == "brain" {
		submission = candidateSource.Brain
		if submission == nil || source.Name != brainPackageName || job.ActorID != "work-agent:"+workID {
			return corestore.ErrStorage
		}
	}
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	for attempt := 0; attempt < 8; attempt++ {
		if submission != nil {
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				work, err := corestore.ReadWork(tx, workID, false)
				if err != nil {
					return err
				}
				return a.checkBrainBaselineTx(tx, work, *submission)
			}); err != nil {
				return err
			}
		}
		state, err := a.Store.Configuration(ctx, workID)
		if err != nil {
			return err
		}
		if state.DesiredContextID == nil || state.DesiredRevision >= contracts.MaxSafeInteger {
			return corestore.ErrRevisionConflict
		}
		config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
		if err != nil {
			return err
		}
		exists := false
		for _, item := range config.Packages {
			if string(item.Name) == source.Name {
				exists = true
			}
		}
		if job.Kind == "install" && exists {
			return contracts.NewError("PI_PACKAGE_ALREADY_INSTALLED", "")
		}
		if job.Kind == "update" && !exists {
			return contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		}
		if job.Kind == "install" {
			config.Packages = append(config.Packages, contracts.PiPackageSelectionEntry{Name: source.Metadata.Name, Enabled: true})
		}
		sort.Slice(config.Packages, func(i, j int) bool { return config.Packages[i].Name < config.Packages[j].Name })
		var imageID, profile string
		var revision sql.NullInt64
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT r.resolved_image_digest,r.runtime_profile_json,r.source_runtime_revision FROM work_config_revisions r WHERE r.work_id=? AND r.revision=?`, workID, state.DesiredRevision).Scan(&imageID, &profile, &revision)
		}); err != nil {
			return err
		}
		now := packageNow()
		published, err := a.buildWorkContext(ctx, workID, *state.DesiredContextID, false, config, imageID, now, &source)
		if err != nil {
			return err
		}
		result, _ := json.Marshal(map[string]any{"name": source.Name, "version": source.Metadata.Version, "resourceCounts": source.Metadata.ResourceCounts, "scope": "work", "pendingApply": true})
		if err := a.advanceCorePackage(ctx, job, "publish", &source.Name, nil); err != nil {
			_ = workcontext.RemoveCandidate(a.Store, workID, published.ID)
			return err
		}
		err = a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.CommitPackageJob(tx, job.OperationID, job.WorkerEpoch, now, string(result), true, func(tx *sql.Tx, _ corestore.PackageJob) error {
				current, err := corestore.ReadWork(tx, workID, false)
				if err != nil {
					return err
				}
				if current.DesiredRevision != state.DesiredRevision || current.DesiredContextID == nil || *current.DesiredContextID != *state.DesiredContextID {
					return corestore.ErrRevisionConflict
				}
				createdBy := job.ActorID
				if submission != nil {
					if err := a.checkBrainBaselineTx(tx, current, *submission); err != nil {
						return err
					}
					createdBy = current.OwnerUserID
					var boundary int64
					if err := tx.QueryRow(`SELECT MAX(rowid) FROM operations`).Scan(&boundary); err != nil {
						return err
					}
					raw, _ := json.Marshal(brainCandidateReceipt{ArtifactDigest: string(source.Metadata.ContentDigest), Version: source.Metadata.Version, ContextID: published.ID, OperationBoundary: boundary})
					if _, err := tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)`, brainReceiptKey(job.OperationID), string(raw), now); err != nil {
						return err
					}
				}
				newRevision := state.DesiredRevision + 1
				var sourceRevision *int64
				if revision.Valid {
					sourceRevision = &revision.Int64
				}
				if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: workID, Revision: newRevision, ConfigJSON: published.ConfigurationJSON, ResolvedImageDigest: &imageID, RuntimeProfileJSON: &profile, SourceRuntimeRevision: sourceRevision, CreatedByUserID: createdBy, CreatedAt: now}); err != nil {
					return err
				}
				if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: published.ID, WorkID: workID, InternalRevision: &newRevision, ConfigurationJSON: published.ConfigurationJSON, ImageIdentity: imageID, CreatedByUserID: createdBy, CreatedAt: now}); err != nil {
					return err
				}
				metadata, _ := json.Marshal(source.Metadata)
				storage, err := filepath.Rel(a.options.DataDirectory, filepath.Join(published.Directory, "packages", contracts.PackageNameKey(source.Name)))
				if err != nil {
					return err
				}
				if err := corestore.InsertPackageArtifact(tx, corestore.PackageArtifact{ID: workID + ":" + published.ID + ":" + string(source.Metadata.ContentDigest), ScopeKind: "work", WorkID: &workID, Name: source.Name, ContentDigest: string(source.Metadata.ContentDigest), MetadataJSON: string(metadata), StoragePath: storage, CreatedAt: now}); err != nil {
					return err
				}
				_, err = tx.Exec(`UPDATE works SET desired_revision=?,desired_context_id=?,updated_at=? WHERE id=?`, newRevision, published.ID, now, workID)
				return err
			})
		})
		if err == nil {
			return nil
		}
		if cleanup := workcontext.RemoveCandidate(a.Store, workID, published.ID); cleanup != nil {
			return corestore.ErrStorage
		}
		if !errors.Is(err, corestore.ErrRevisionConflict) {
			return err
		}
	}
	return corestore.ErrRevisionConflict
}
