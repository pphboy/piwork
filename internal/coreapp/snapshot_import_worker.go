package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
	"piwork/internal/snapshottree"
	"piwork/internal/workcontext"
	"piwork/internal/workpackage"
)

type snapshotImportVolume struct {
	Role, ID, RuntimeName, LogicalID string
	CreationIssued, Created          bool
}
type snapshotImportContext struct {
	Key       string
	Revision  int64
	Published workcontext.Published
	Profile   RuntimeProfile
}
type snapshotImportImage struct{ Identity, SelectionID string }

func (a *Application) snapshotImportJournal(ctx context.Context, job corestore.SnapshotJob, key string, target any) error {
	return a.Store.Read(ctx, func(tx *sql.Tx) error {
		var kind, logical, state string
		if err := tx.QueryRow(`SELECT kind,logical_id,state FROM snapshot_artifacts WHERE operation_id=? AND artifact_key=?`, job.OperationID, key).Scan(&kind, &logical, &state); err != nil {
			return err
		}
		if kind != key || state != "ready" {
			return corestore.ErrStorage
		}
		return strictMetadata([]byte(logical), target)
	})
}
func (a *Application) kickSnapshotImport(id string) {
	a.mu.Lock()
	if a.closed || a.ctx.Err() != nil {
		a.mu.Unlock()
		return
	}
	if _, exists := a.snapshotRunning.LoadOrStore(id, true); exists {
		a.mu.Unlock()
		return
	}
	a.snapshotWG.Add(1)
	a.mu.Unlock()
	go func() {
		defer a.snapshotWG.Done()
		defer a.snapshotRunning.Delete(id)
		var job corestore.SnapshotJob
		if err := a.Store.Read(a.ctx, func(tx *sql.Tx) error { var err error; job, err = corestore.ReadSnapshotJob(tx, id); return err }); err != nil || job.Kind != "import" || job.Phase != "accepted" {
			return
		}
		if err := a.runSnapshotImport(a.ctx, job); err != nil {
			a.failSnapshotImport(job, err)
		}
	}()
}
func (a *Application) runSnapshotImport(parent context.Context, job corestore.SnapshotJob) error {
	if job.TargetWorkID == nil || job.PackageID == nil || job.Name == nil {
		return corestore.ErrStorage
	}
	deadline, err := time.Parse(time.RFC3339Nano, job.DeadlineAt)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	defer cancel()
	var targets snapshotIdentityTargets
	var bindings snapshotBindings
	var helper string
	if err := a.snapshotImportJournal(ctx, job, "identity-map", &targets); err != nil {
		return err
	}
	if targets.WorkID != *job.TargetWorkID {
		return corestore.ErrStorage
	}
	if err := a.snapshotImportJournal(ctx, job, "bindings", &bindings); err != nil {
		return err
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT logical_id FROM snapshot_artifacts WHERE operation_id=? AND artifact_key='helper-image' AND state='ready'`, job.OperationID).Scan(&helper)
	}); err != nil {
		return err
	}
	root, err := a.openSnapshotJobRoot(job.OperationID)
	if err != nil {
		return err
	}
	defer root.Close()
	if err := a.advanceSnapshot(ctx, job, "verifying"); err != nil {
		return err
	}
	verified, blobs, err := a.stageSnapshotImport(ctx, job, root)
	if err != nil {
		return err
	}
	defer blobs.Close()
	if err := a.validateSnapshotPlatform(ctx, verified.Spec); err != nil {
		return err
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		_, err := a.resolveSnapshotBindings(tx, job.OwnerUserID, verified.Spec.Bindings, bindings)
		return err
	}); err != nil {
		return err
	}
	var history contracts.WorkControlHistory
	var identities contracts.WorkSourceIdentityMap
	if strictMetadata(verified.Metadata[string(verified.Spec.History.Control)], &history) != nil || strictMetadata(verified.Metadata[string(verified.Spec.History.SourceIdentityMap)], &identities) != nil {
		return snapshotInvalid("history")
	}
	if err := a.advanceSnapshot(ctx, job, "restoring"); err != nil {
		return err
	}
	images := map[string]snapshotImportImage{}
	for _, image := range verified.Spec.Images {
		if err := a.loadSnapshotImage(ctx, image, blobs, verified.Spec); err != nil {
			return err
		}
		selection := snapshotImportImage{string(image.ImageId), "owned-image-" + uuid.NewString()}
		images[string(image.Key)] = selection
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: job.OperationID, ArtifactKey: "image-" + string(image.Key), Kind: "image", LogicalID: string(snapshotRaw(selection)), State: "ready"}, job.WorkerEpoch)
		}); err != nil {
			return err
		}
	}
	volumes := []snapshotImportVolume{}
	for _, volume := range workpackage.Volumes(verified.Spec) {
		logical := "work-private"
		if volume.Role == "workspace" {
			logical = "work-workspace"
		}
		entry := snapshotImportVolume{Role: volume.Role, ID: "volume-" + uuid.NewString(), RuntimeName: dockerengine.ManagedVolumeName(a.Store.InstallationID(), targets.WorkID, logical), LogicalID: logical, CreationIssued: true}
		if _, err := a.dockerRuntime.InspectVolume(ctx, entry.RuntimeName, targets.WorkID, logical); !errors.Is(err, dockerengine.ErrResourceMissing) {
			if err != nil {
				return err
			}
			return contracts.NewError("SNAPSHOT_VOLUME_CONFLICT", "")
		}
		key := "volume-" + volume.Role
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: job.OperationID, ArtifactKey: key, Kind: "volume", LogicalID: string(snapshotRaw(entry)), State: "planned"}, job.WorkerEpoch)
		}); err != nil {
			return err
		}
		value, err := a.dockerRuntime.EnsureVolume(ctx, targets.WorkID, logical)
		if err != nil {
			return err
		}
		if value.Name != entry.RuntimeName {
			return dockerengine.ErrIdentity
		}
		entry.Created = true
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			if _, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE snapshot_artifacts SET logical_id=?,state='created' WHERE operation_id=? AND artifact_key=?`, string(snapshotRaw(entry)), job.OperationID, key)
			return err
		}); err != nil {
			return err
		}
		raw, err := a.runSnapshotHelperSpec(ctx, job, dockerengine.SnapshotHelperSpec{ImageID: helper, Action: "restore", VolumeName: entry.RuntimeName, VolumeLogicalID: logical, TreeDigest: string(volume.Tree)})
		if err != nil {
			return err
		}
		var result snapshottree.Result
		if strictMetadata(raw, &result) != nil || result.Tree != string(volume.Tree) {
			return snapshotInvalid("restore.volume")
		}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.UpdateSnapshotArtifact(tx, job.OperationID, job.WorkerEpoch, key, "ready")
		}); err != nil {
			return err
		}
		volumes = append(volumes, entry)
	}
	request := struct {
		SourceWorkID string   `json:"sourceWorkId"`
		ContextIDs   []string `json:"contextIds"`
		TargetWorkID string   `json:"targetWorkId"`
		Contexts     []struct {
			SourceID string `json:"sourceId"`
			TargetID string `json:"targetId"`
		} `json:"contexts"`
	}{SourceWorkID: string(identities.SourceWorkId), ContextIDs: []string{}, TargetWorkID: targets.WorkID, Contexts: []struct {
		SourceID string `json:"sourceId"`
		TargetID string `json:"targetId"`
	}{}}
	for _, item := range identities.Contexts {
		request.ContextIDs = append(request.ContextIDs, string(item.SourceId))
		request.Contexts = append(request.Contexts, struct {
			SourceID string `json:"sourceId"`
			TargetID string `json:"targetId"`
		}{string(item.SourceId), snapshotTargetID(targets.Contexts, string(item.Key))})
	}
	if err := root.AtomicWrite("history-request.json", "history-request.tmp", snapshotRaw(request)); err != nil {
		return err
	}
	raw, err := a.runSnapshotJobHelper(ctx, job, helper, "restore-history", volumes[0].RuntimeName, "work-private")
	if err != nil {
		return err
	}
	var restoredHistory struct {
		HistoryPresent bool `json:"historyPresent"`
	}
	var historyResponse map[string]json.RawMessage
	if json.Unmarshal(raw, &historyResponse) != nil || json.Unmarshal(historyResponse["historyPresent"], &restoredHistory.HistoryPresent) != nil || string(verified.Spec.ActiveContext) != "null" && !restoredHistory.HistoryPresent {
		return snapshotInvalid("restore.history")
	}
	contexts, err := a.prepareSnapshotImportContexts(ctx, job, helper, root, blobs, verified, history, targets, bindings, images)
	if err != nil {
		return err
	}
	if err := a.advanceSnapshot(ctx, job, "publishing"); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := a.validateSnapshotPlatform(ctx, verified.Spec); err != nil {
		return err
	}
	if err := a.publishSnapshotImport(ctx, job, verified, history, identities, targets, bindings, images, volumes, contexts); err != nil {
		return err
	}
	_ = a.removeSnapshotJobRoot(job.OperationID)
	return nil
}
func (a *Application) stageSnapshotImport(ctx context.Context, job corestore.SnapshotJob, root *safefs.Root) (workpackage.Verified, *workpackage.BlobDirectory, error) {
	blobs, err := workpackage.OpenBlobDirectory(filepath.Join(a.options.DataDirectory, "snapshots", "jobs", job.OperationID))
	if err != nil {
		return workpackage.Verified{}, nil, err
	}
	fail := func(err error) (workpackage.Verified, *workpackage.BlobDirectory, error) {
		blobs.Close()
		return workpackage.Verified{}, nil, err
	}
	var pack corestore.SnapshotPackage
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		pack, err = corestore.ReadSnapshotPackage(tx, *job.PackageID)
		return err
	}); err != nil {
		return fail(err)
	}
	if pack.State != "ready" || pack.OwnerUserID != job.OwnerUserID || pack.Digest == nil {
		return fail(contracts.NewError("PACKAGE_NOT_READY", ""))
	}
	packages, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		return fail(err)
	}
	defer packages.Close()
	file, err := packages.OpenFile(pack.ID+".work", unix.O_RDONLY)
	if err != nil {
		return fail(err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != pack.Size {
		return fail(snapshotInvalid("package.size"))
	}
	verified, err := workpackage.Read(ctx, io.NewSectionReader(file, 0, info.Size()), workpackage.ReadOptions{OnBlob: func(blob contracts.WorkBlob, reader io.Reader) error {
		value, err := blobs.Put(ctx, reader, int64(blob.Size))
		if err == nil && (value.Digest != string(blob.Digest) || value.Size != int64(blob.Size)) {
			err = snapshotInvalid("package.blob")
		}
		return err
	}})
	if err == nil && (verified.Digest != *pack.Digest || verified.Size != pack.Size) {
		err = snapshotInvalid("package.digest")
	}
	if err == nil {
		err = workpackage.ValidatePackageContent(ctx, verified, verified.Open(file))
	}
	if err == nil {
		var environments map[string]contracts.PiPackagePreparedEnvironment
		environments, err = workpackage.ImageEnvironments(ctx, verified, file)
		if err == nil {
			err = workpackage.ValidateTarget(verified.Spec, contracts.WorkImagePlatform{Os: verified.Spec.Compatibility.Os, Architecture: verified.Spec.Compatibility.Architecture, Variant: verified.Spec.Compatibility.Variant}, environments)
		}
	}
	if err != nil {
		return fail(err)
	}
	return verified, blobs, nil
}
func (a *Application) prepareSnapshotImportContexts(ctx context.Context, job corestore.SnapshotJob, helper string, root *safefs.Root, blobs *workpackage.BlobDirectory, verified workpackage.Verified, history contracts.WorkControlHistory, targets snapshotIdentityTargets, bindings snapshotBindings, images map[string]snapshotImportImage) ([]snapshotImportContext, error) {
	result := []snapshotImportContext{}
	base := filepath.Join(a.options.DataDirectory, "snapshots", "jobs", job.OperationID)
	for _, c := range verified.Spec.Contexts {
		contextID := snapshotTargetID(targets.Contexts, string(c.Key))
		if contextID == "" {
			return nil, snapshotInvalid("context.identity")
		}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: job.OperationID, ArtifactKey: "context-" + string(c.Key), Kind: "context", LogicalID: contextID, State: "planned"}, job.WorkerEpoch)
		}); err != nil {
			return nil, err
		}
		area, err := root.OpenDirectory("contexts")
		if err != nil {
			return nil, err
		}
		skills, err := area.OpenDirectory(string(c.Key))
		area.Close()
		if err != nil {
			return nil, err
		}
		skills.Close()
		raw, err := a.runSnapshotHelperSpec(ctx, job, dockerengine.SnapshotHelperSpec{ImageID: helper, Action: "restore-context", TreeDigest: string(c.SkillsTree), ContextKey: string(c.Key)})
		if err != nil {
			return nil, err
		}
		var receipt snapshottree.Result
		if strictMetadata(raw, &receipt) != nil || receipt.Tree != string(c.SkillsTree) {
			return nil, snapshotInvalid("restore.context")
		}
		packages := []workcontext.PackageSource{}
		for _, binding := range c.PackageBindings {
			var artifact contracts.PortablePiPackageArtifact
			for _, p := range verified.Spec.PiPackageArtifacts {
				if p.Key == binding.ArtifactKey {
					artifact = p
				}
			}
			key := contracts.PackageNameKey(string(binding.Name))
			area, err := root.OpenDirectory("context-packages")
			if err != nil {
				return nil, err
			}
			parent, err := area.OpenDirectory(string(c.Key))
			area.Close()
			if err != nil {
				return nil, err
			}
			child, err := parent.OpenDirectory(key)
			parent.Close()
			if err != nil {
				return nil, err
			}
			child.Close()
			raw, err := a.runSnapshotHelperSpec(ctx, job, dockerengine.SnapshotHelperSpec{ImageID: helper, Action: "restore-package", TreeDigest: string(artifact.TreeDigest), ContextKey: string(c.Key), PackageKey: key})
			if err != nil {
				return nil, err
			}
			if strictMetadata(raw, &receipt) != nil || receipt.Tree != string(artifact.TreeDigest) {
				return nil, snapshotInvalid("restore.package")
			}
			metadata := contracts.PiPackageArtifactMetadata{Name: artifact.Name, Version: artifact.Version, SourceKind: artifact.SourceKind, ResolvedSource: artifact.ResolvedSource, PreparedEnvironment: artifact.PreparedEnvironment, ResourceCounts: artifact.ResourceCounts, ContentDigest: artifact.ContentDigest}
			packages = append(packages, workcontext.PackageSource{Name: string(binding.Name), Directory: filepath.Join(base, "context-packages", string(c.Key), key), Metadata: metadata})
		}
		agents, err := readSnapshotAgents(ctx, blobs, string(c.AgentsBlob))
		if err != nil {
			return nil, err
		}
		model, ok := bindings[string(c.Configuration.ModelBindingKey)]
		if !ok {
			return nil, snapshotInvalid("context.model")
		}
		image, ok := images[string(c.ImageKey)]
		if !ok {
			return nil, snapshotInvalid("context.image")
		}
		config := contracts.WorkConfig{AgentImage: contracts.ImageSelection{CatalogId: contracts.ResourceId(image.SelectionID)}, Skills: c.Configuration.Skills, Packages: c.Configuration.Packages, AgentsMd: string(agents), ModelRef: contracts.ResourceId(model.CatalogID), Resources: c.Configuration.Resources, Tools: c.Configuration.Tools, McpServers: []contracts.McpServer{}}
		for _, mcp := range c.Configuration.McpServers {
			value := contracts.McpServer{ServerId: mcp.ServerId, Transport: mcp.Transport, Required: mcp.Required, Command: mcp.Command, Args: mcp.Args, Url: mcp.Url, TimeoutMs: mcp.TimeoutMs}
			if mcp.RequiredServiceKey.Present {
				id := snapshotTargetID(targets.Services, string(mcp.RequiredServiceKey.Value))
				if id == "" {
					return nil, snapshotInvalid("context.service")
				}
				value.RequiredServiceId = contracts.Supplied(contracts.ResourceId(id))
			}
			if mcp.SecretRefs.Present && len(mcp.SecretRefs.Value) > 0 {
				return nil, contracts.NewError("EXTERNAL_MCP_SECRET_UNAVAILABLE", "secrets")
			}
			if mcp.SecretRefs.Present {
				value.SecretRefs = contracts.Supplied([]contracts.SecretReference{})
			}
			config.McpServers = append(config.McpServers, value)
		}
		published, err := workcontext.BuildImported(a.Store, a.options.DataDirectory, targets.WorkID, contextID, filepath.Join(base, "contexts", string(c.Key)), config, image.Identity, packageNow(), packages)
		if err != nil {
			return nil, err
		}
		revision := int64(0)
		for _, r := range history.ConfigurationRevisions {
			if r.ContextKey == c.Key {
				revision = r.Revision
			}
		}
		profile := model.Profile
		profile.AgentImage = image.Identity
		result = append(result, snapshotImportContext{string(c.Key), revision, published, profile})
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.UpdateSnapshotArtifact(tx, job.OperationID, job.WorkerEpoch, "context-"+string(c.Key), "ready")
		}); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func readSnapshotAgents(ctx context.Context, blobs *workpackage.BlobDirectory, digest string) ([]byte, error) {
	// AGENTS.md is a file blob, not JSON metadata. Read the verified staged
	// content, retaining the original bytes and enforcing the context limit.
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := blobs.Read(digest)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, (256<<10)+1))
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if len(raw) > 256<<10 || !utf8.Valid(raw) {
		return nil, snapshotInvalid("context.agentsMd")
	}
	return raw, nil
}

// Shared Engine images are never deleted during failed import cleanup.
func (a *Application) failSnapshotImport(job corestore.SnapshotJob, cause error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	_ = a.cleanupSnapshotImport(ctx, job, cause)
}

func (a *Application) cleanupSnapshotImport(ctx context.Context, job corestore.SnapshotJob, cause error) error {
	cleanup := func() error {
		if job.TargetWorkID == nil {
			return corestore.ErrStorage
		}
		var published bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM work_import_provenance WHERE work_id=? AND import_operation_id=?)`, *job.TargetWorkID, job.OperationID).Scan(&published)
		}); err != nil {
			return err
		}
		if published {
			return nil
		}
		var artifacts []corestore.SnapshotArtifact
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			artifacts, err = corestore.SnapshotArtifacts(tx, job.OperationID)
			return err
		}); err != nil {
			return err
		}
		for _, artifact := range artifacts {
			if artifact.Kind == "helper" && artifact.State != "cleaned" {
				var j snapshotHelperJournal
				if strictMetadata([]byte(artifact.LogicalID), &j) != nil {
					return corestore.ErrStorage
				}
				if err := a.retireSnapshotHelper(ctx, job, artifact.ArtifactKey, j); err != nil {
					return err
				}
			}
		}
		for _, artifact := range artifacts {
			if artifact.Kind != "volume" || artifact.State == "cleaned" {
				continue
			}
			var v snapshotImportVolume
			if strictMetadata([]byte(artifact.LogicalID), &v) != nil || v.RuntimeName != dockerengine.ManagedVolumeName(a.Store.InstallationID(), *job.TargetWorkID, v.LogicalID) {
				return corestore.ErrStorage
			}
			_, err := a.dockerRuntime.InspectVolume(ctx, v.RuntimeName, *job.TargetWorkID, v.LogicalID)
			if errors.Is(err, dockerengine.ErrResourceMissing) && v.CreationIssued && !v.Created {
				return dockerengine.ErrStateUnknown
			}
			if err != nil && !errors.Is(err, dockerengine.ErrResourceMissing) {
				return err
			}
			if err := a.dockerRuntime.RemoveVolume(ctx, v.RuntimeName, *job.TargetWorkID, v.LogicalID); err != nil {
				return err
			}
			if err := a.Store.ReleaseResourceIntent(ctx, *job.TargetWorkID, "volume", v.LogicalID, true); err != nil {
				return err
			}
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				return corestore.UpdateSnapshotArtifact(tx, job.OperationID, job.WorkerEpoch, artifact.ArtifactKey, "cleaned")
			}); err != nil {
				return err
			}
		}
		if err := workcontext.RemoveUnaccepted(a.Store, *job.TargetWorkID); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := a.removeSnapshotJobRoot(job.OperationID); err != nil {
			return err
		}
		failure := string(snapshotRaw(map[string]any{"code": "WORK_OPERATION_FAILED", "stage": "runtime-prepare", "message": "Work import failed.", "remediation": "Inspect the import and retry.", "retryable": false}))
		var public *contracts.PublicError
		if errors.As(snapshotPublicError(cause), &public) {
			_, view := contracts.ProjectError(public)
			failure = string(snapshotRaw(map[string]any{"code": view.Code, "stage": "runtime-prepare", "message": "Work import failed.", "remediation": "Correct the identified condition and retry.", "retryable": false}))
		}
		return a.Store.Write(ctx, func(tx *sql.Tx) error {
			if _, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); err != nil {
				return err
			}
			if _, err := tx.Exec(`UPDATE snapshot_artifacts SET state='cleaned' WHERE operation_id=?`, job.OperationID); err != nil {
				return err
			}
			if err := corestore.ReleaseSnapshotReservations(tx, job.OperationID, job.WorkerEpoch, true); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM quota_reservations WHERE work_id=? AND subject_kind='import' AND subject_id='import'`, *job.TargetWorkID); err != nil {
				return err
			}
			if err := corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "cleaned", packageNow(), nil); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE operations SET state='failed',error_json=?,updated_at=? WHERE id=? AND state IN ('pending','running')`, failure, packageNow(), job.OperationID)
			return err
		})
	}
	if err := cleanup(); err != nil {
		code := "SNAPSHOT_CLEANUP_REQUIRED"
		_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "cleanup-pending", packageNow(), &code)
		})
		return err
	}
	return nil
}
