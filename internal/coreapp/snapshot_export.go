package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/snapshottree"
	"piwork/internal/workaccess"
	"piwork/internal/workpackage"
)

func (a *Application) acceptWorkExport(ctx context.Context, actor identity.Principal, workID, key string) (contracts.AcceptedWorkExport, error) {
	var output contracts.AcceptedWorkExport
	if key == "" || len(key) > 256 {
		return output, contracts.NewError("INVALID_REQUEST", "")
	}
	work, err := workaccess.Work(ctx, a.Store, actor, workID, workaccess.Content)
	if err != nil {
		return output, err
	}
	request := string(snapshotRaw(map[string]any{"workId": workID}))
	response := func(prior corestore.AcceptedMutation) (contracts.AcceptedWorkExport, error) {
		var job corestore.SnapshotJob
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			job, err = corestore.ReadSnapshotJob(tx, prior.OperationID)
			return err
		})
		if err != nil {
			return contracts.AcceptedWorkExport{}, err
		}
		if job.Kind != "export" || job.SourceWorkID == nil || *job.SourceWorkID != workID || job.SnapshotID == nil || job.OwnerUserID != actor.UserID {
			return contracts.AcceptedWorkExport{}, corestore.ErrStorage
		}
		return contracts.AcceptedWorkExport{WorkId: contracts.ResourceId(workID), OperationId: contracts.ResourceId(prior.OperationID), CorrelationId: contracts.ResourceId(prior.OperationID), SnapshotId: contracts.ResourceId(*job.SnapshotID), Reused: prior.Reused}, nil
	}
	if prior, found, err := a.Store.FindAcceptedMutation(ctx, actor.UserID, workID, "export-work", key, request); err != nil {
		return output, snapshotPublicError(err)
	} else if found {
		return response(prior)
	}
	if a.Status().State != "READY" {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	image, err := a.requireSnapshotImage()
	if err != nil {
		return output, err
	}
	if _, err := a.snapshotPreflight(ctx, workID, ""); err != nil {
		return output, snapshotPublicError(err)
	}
	now := packageNow()
	snapshotID, packageID := "snapshot-"+uuid.NewString(), "package-"+uuid.NewString()
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.UserID, WorkScope: workID, Kind: "export-work", IdempotencyKey: key, RequestJSON: request, TargetVersion: work.ControlVersion, WorkID: &workID, ExpectedWorkVersion: &work.ControlVersion, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return corestore.MutationEffect{}, err
		}
		current, err := corestore.ReadWork(tx, workID, false)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if current.OwnerUserID != actor.UserID {
			return corestore.MutationEffect{}, contracts.NewError("PERMISSION_DENIED", "")
		}
		if current.DesiredState != "stopped" || current.ObservedState != "stopped" {
			return corestore.MutationEffect{}, contracts.NewError("SNAPSHOT_REQUIRES_STOPPED", "")
		}
		if err := a.rejectUnresolvedHistoryTx(tx, workID); err != nil {
			return corestore.MutationEffect{}, err
		}
		var busy int
		if err := tx.QueryRow(`SELECT count(*) FROM operations WHERE work_id=? AND id!=? AND state IN ('pending','running')`, workID, id).Scan(&busy); err != nil {
			return corestore.MutationEffect{}, err
		}
		if busy != 0 {
			return corestore.MutationEffect{}, contracts.NewError("WORK_BUSY", "")
		}
		if err := corestore.InsertSnapshotPackage(tx, corestore.SnapshotPackage{ID: packageID, OwnerUserID: actor.UserID, State: "staging", CreatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		digest, err := contracts.PrivateDigest("snapshot/export-work", map[string]any{"workId": workID})
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		job := corestore.SnapshotJob{OperationID: id, OwnerUserID: actor.UserID, Kind: "export", SourceWorkID: &workID, SnapshotID: &snapshotID, RequestDigest: digest, Phase: "accepted", DeadlineAt: time.Now().Add(30 * time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now}
		if err := corestore.InsertSnapshotJob(tx, job); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.Exec(`UPDATE snapshot_jobs SET package_id=? WHERE operation_id=?`, packageID, id); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.Exec(`UPDATE snapshot_packages SET job_id=? WHERE id=?`, id, packageID); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := a.Store.LockSnapshotWork(tx, corestore.SnapshotLock{WorkID: workID, OperationID: id, WorkerEpoch: 1}); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: id, ArtifactKey: "helper-image", Kind: "helper-image", LogicalID: image, State: "ready"}, 1); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: workID}, nil
	})
	if err != nil {
		return output, snapshotPublicError(err)
	}
	if !accepted.Reused {
		a.kickSnapshotExport(accepted.OperationID)
	}
	return response(accepted)
}
func snapshotPublicError(err error) error {
	var tree *snapshottree.Error
	if errors.As(err, &tree) {
		return contracts.NewError(snapshottree.Code(err), "")
	}
	if errors.Is(err, corestore.ErrIdempotencyConflict) {
		return contracts.NewError("IDEMPOTENCY_CONFLICT", "")
	}
	if errors.Is(err, corestore.ErrSnapshotBusy) {
		return contracts.NewError("WORK_BUSY", "")
	}
	var repository *corestore.RepositoryError
	if errors.As(err, &repository) {
		switch repository.Code() {
		case "SNAPSHOT_CAPACITY_BUSY", "SNAPSHOT_TRANSFER_BUSY", "WORK_BUSY", "WORK_NAME_CONFLICT":
			return contracts.NewError(repository.Code(), "")
		}
	}
	var validation *workpackage.ValidationError
	if errors.As(err, &validation) {
		return contracts.NewError(validation.Code, validation.Field)
	}
	var helper *dockerengine.SnapshotHelperError
	if errors.As(err, &helper) {
		return contracts.NewError(helper.Code, "")
	}
	return err
}
func (a *Application) kickSnapshotExport(id string) {
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
		var artifacts []corestore.SnapshotArtifact
		if err := a.Store.Read(a.ctx, func(tx *sql.Tx) error {
			var err error
			job, err = corestore.ReadSnapshotJob(tx, id)
			if err == nil {
				artifacts, err = corestore.SnapshotArtifacts(tx, id)
			}
			return err
		}); err != nil || job.Kind != "export" || job.Phase != "accepted" {
			return
		}
		image := ""
		for _, artifact := range artifacts {
			if artifact.ArtifactKey == "helper-image" && artifact.Kind == "helper-image" {
				image = artifact.LogicalID
			}
		}
		a.runSnapshotExport(a.ctx, job, image)
	}()
}
func (a *Application) runSnapshotExport(parent context.Context, job corestore.SnapshotJob, image string) {
	deadline, err := time.Parse(time.RFC3339Nano, job.DeadlineAt)
	if err != nil {
		a.failSnapshotExport(job, err)
		return
	}
	ctx, cancel := context.WithDeadline(parent, deadline)
	defer cancel()
	run := func() error {
		if err := a.advanceSnapshot(ctx, job, "capturing"); err != nil {
			return err
		}
		metadata, err := a.snapshotPreflight(ctx, *job.SourceWorkID, job.OperationID)
		if err != nil {
			return err
		}
		root, err := a.openSnapshotJobRoot(job.OperationID)
		if err != nil {
			return err
		}
		defer root.Close()
		verified, err := a.captureSnapshotPackage(ctx, job, metadata, image, root)
		if err != nil {
			return err
		}
		if err := a.advanceSnapshot(ctx, job, "sealing"); err != nil {
			return err
		}
		packages, err := a.Store.OpenSnapshotArea("packages")
		if err != nil {
			return err
		}
		defer packages.Close()
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := root.PublishTo("package.work", packages, *job.PackageID+".work", false); err != nil {
			return err
		}
		now := packageNow()
		expires := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339Nano)
		marker := snapshotRaw(map[string]any{"digest": verified.Digest, "size": verified.Size, "readyAt": now, "expiresAt": expires})
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: job.OperationID, ArtifactKey: "sealed-package", Kind: "sealed-package", LogicalID: string(marker), State: "ready"}, job.WorkerEpoch)
		}); err != nil {
			return err
		}
		result := string(snapshotRaw(map[string]any{"correlationId": job.OperationID, "result": map[string]any{"observedState": "stopped"}}))
		_, err = a.Store.CompleteOperation(ctx, job.OperationID, "succeeded", &result, nil, func(tx *sql.Tx) error {
			if _, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); err != nil {
				return err
			}
			if err := corestore.SealSnapshotPackage(tx, *job.PackageID, verified.Digest, verified.Size, now, expires); err != nil {
				return err
			}
			if err := corestore.ReleaseSnapshotReservations(tx, job.OperationID, job.WorkerEpoch, true); err != nil {
				return err
			}
			return corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "succeeded", now, nil)
		})
		return err
	}
	if err := run(); err != nil {
		a.failSnapshotExport(job, err)
		return
	}
	// Publication succeeded atomically; cleanup failure cannot reverse the result.
	_ = a.removeSnapshotJobRoot(job.OperationID)
}
func (a *Application) failSnapshotExport(job corestore.SnapshotJob, cause error) {
	cause = snapshotPublicError(cause)
	_, diagnostic := contracts.ProjectError(cause)
	code := diagnostic.Code
	if contracts.Validate("DiagnosticCodeSchema", code) != nil {
		code = "WORK_OPERATION_FAILED"
	}
	diagnostics.Write(os.Stderr, diagnostics.Event{Component: "core", Stage: "runtime-prepare", Outcome: "failed", Code: code}, snapshotJobWork(job), job.OperationID, job.OperationID)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	var artifacts []corestore.SnapshotArtifact
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		artifacts, err = corestore.SnapshotArtifacts(tx, job.OperationID)
		return err
	})
	for _, artifact := range artifacts {
		if err != nil {
			break
		}
		if artifact.Kind == "helper" && artifact.State != "cleaned" {
			var journal snapshotHelperJournal
			if strictMetadata([]byte(artifact.LogicalID), &journal) != nil {
				err = corestore.ErrStorage
				break
			}
			err = a.retireSnapshotHelper(ctx, job, artifact.ArtifactKey, journal)
		}
	}
	if err == nil && job.PackageID != nil {
		root, openErr := a.Store.OpenSnapshotArea("packages")
		if openErr != nil {
			err = openErr
		} else {
			removeErr := root.Remove(*job.PackageID + ".work")
			root.Close()
			if removeErr != nil && !isSnapshotMissing(removeErr) {
				err = removeErr
			}
		}
	}
	if err == nil {
		err = a.removeSnapshotJobRoot(job.OperationID)
	}
	code = "SNAPSHOT_EXPORT_FAILED"
	var known *contracts.PublicError
	if errors.As(cause, &known) {
		_, view := contracts.ProjectError(known)
		code = view.Code
	}
	failure := string(snapshotRaw(map[string]any{"code": code, "stage": "runtime-prepare", "message": "Work export failed.", "remediation": "Correct the identified condition and retry export.", "retryable": false}))
	_, _ = a.Store.CompleteOperation(ctx, job.OperationID, "failed", nil, &failure, func(tx *sql.Tx) error {
		if _, failure := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); failure != nil {
			return failure
		}
		if err != nil {
			cleanup := "SNAPSHOT_CLEANUP_REQUIRED"
			return corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "cleanup-pending", packageNow(), &cleanup)
		}
		if _, failure := tx.Exec(`UPDATE snapshot_artifacts SET state='cleaned' WHERE operation_id=?`, job.OperationID); failure != nil {
			return failure
		}
		if _, failure := tx.Exec(`UPDATE snapshot_packages SET state='expired' WHERE id=? AND state='staging'`, job.PackageID); failure != nil {
			return failure
		}
		if failure := corestore.ReleaseSnapshotReservations(tx, job.OperationID, job.WorkerEpoch, true); failure != nil {
			return failure
		}
		return corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "cleaned", packageNow(), nil)
	})
}

func isSnapshotMissing(err error) bool { return errors.Is(err, os.ErrNotExist) }
