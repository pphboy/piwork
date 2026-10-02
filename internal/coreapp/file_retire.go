package coreapp

import (
	"context"
	"database/sql"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/fileprotocol"
)

func (a *Application) retireFileAttempt(ctx context.Context, job corestore.FileJob, attempt corestore.FileAttempt) error {
	if attempt.State == "removed" {
		return nil
	}
	spec := fileAttemptSpec(job, attempt)
	view, err := a.dockerRuntime.InspectFileHelper(ctx, spec)
	if err != nil {
		return fileFailure(err)
	}
	if view == nil {
		// A timed-out create may still arrive. Only a never-issued planned
		// attempt or a confirmed immutable container can establish absence.
		if attempt.ContainerID == nil && attempt.State != "planned" {
			return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
		}
		if attempt.ContainerID != nil {
			if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, *attempt.ContainerID, attempt.ContainerName); err != nil {
				return fileFailure(err)
			}
		}
	} else {
		if attempt.ContainerID != nil && *attempt.ContainerID != view.ID || view.State == nil {
			return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
		}
		if view.State.Running {
			view, err = a.dockerRuntime.StopContainer(ctx, dockerengine.FileHelperIdentity(spec), 1)
			if err != nil {
				return fileFailure(err)
			}
		}
		if view == nil || view.State == nil || view.State.Running {
			return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
		}
		if attempt.State != "exited" {
			id := view.ID
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				return corestore.UpdateFileAttempt(tx, attempt.ID, attempt.State, "exited", packageNow(), &id)
			}); err != nil {
				return fileFailure(err)
			}
			attempt.State = "exited"
		}
		id := view.ID
		if err := a.dockerRuntime.RemoveContainer(ctx, dockerengine.FileHelperIdentity(spec)); err != nil {
			return fileFailure(err)
		}
		if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, id, attempt.ContainerName); err != nil {
			return fileFailure(err)
		}
	}
	return fileFailure(a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.ConfirmFileAttemptRemoved(tx, attempt.ID, attempt.State, packageNow(), true); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM resource_bindings WHERE installation_id=? AND resource_kind='file-helper' AND logical_id=?`, a.Store.InstallationID(), job.WorkID+"/"+dockerengine.FileHelperIdentity(spec).LogicalID)
		return err
	}))
}

func (a *Application) markFileCleanupPending(ctx context.Context, jobID string, cause error) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		job, err := corestore.ReadFileJob(tx, jobID)
		if err != nil {
			return err
		}
		if job.State == "cleaned" {
			return nil
		}
		code := fileprotocol.Code(fileFailure(cause))
		return corestore.UpdateFileJobState(tx, jobID, job.State, "cleanup-pending", packageNow(), &code)
	})
}
