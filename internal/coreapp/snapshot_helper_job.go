package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
)

type snapshotHelperJournal struct {
	Spec           dockerengine.SnapshotHelperSpec
	ContainerID    string
	CreationIssued bool
}

func (a *Application) openSnapshotJobRoot(id string) (*safefs.Root, error) {
	a.snapshotStorageMu.Lock()
	defer a.snapshotStorageMu.Unlock()
	root, err := a.Store.OpenSnapshotArea("jobs")
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.OpenDirectory(id)
}
func (a *Application) removeSnapshotJobRoot(id string) error {
	a.snapshotStorageMu.Lock()
	defer a.snapshotStorageMu.Unlock()
	root, err := a.Store.OpenSnapshotArea("jobs")
	if err != nil {
		return err
	}
	defer root.Close()
	err = root.RemoveTree(id)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
func (a *Application) advanceSnapshot(ctx context.Context, job corestore.SnapshotJob, phase string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, phase, packageNow(), nil)
	})
}
func (a *Application) runSnapshotJobHelper(ctx context.Context, job corestore.SnapshotJob, image, action, volume, logical string) (json.RawMessage, error) {

	return a.runSnapshotHelperSpec(ctx, job, dockerengine.SnapshotHelperSpec{ImageID: image, Action: action, VolumeName: volume, VolumeLogicalID: logical})
}

func snapshotJobWork(job corestore.SnapshotJob) string {
	if job.Kind == "import" && job.TargetWorkID != nil {
		return *job.TargetWorkID
	}
	if job.SourceWorkID != nil {
		return *job.SourceWorkID
	}
	return ""
}

func (a *Application) runSnapshotHelperSpec(ctx context.Context, job corestore.SnapshotJob, spec dockerengine.SnapshotHelperSpec) (json.RawMessage, error) {
	attempt := "attempt-" + uuid.NewString()
	key := "helper-" + attempt
	spec.WorkID = snapshotJobWork(job)
	spec.JobID = job.OperationID
	spec.AttemptID = attempt
	spec.Epoch = job.WorkerEpoch
	spec.SpoolDirectory = filepath.Join(a.options.DataDirectory, "snapshots", "jobs", job.OperationID)
	journal := snapshotHelperJournal{Spec: spec}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: job.OperationID, ArtifactKey: key, Kind: "helper", LogicalID: string(snapshotRaw(journal)), State: "planned"}, job.WorkerEpoch)
	}); err != nil {
		return nil, err
	}
	// Persist uncertainty before any create call. A lost response cannot be
	// converted into confirmed absence by cancellation or a process restart.
	journal.CreationIssued = true
	if err := a.setSnapshotHelperJournal(ctx, job, key, journal, "planned"); err != nil {
		return nil, err
	}
	ensured, createErr := a.dockerRuntime.EnsureSnapshotHelper(ctx, spec)
	if createErr != nil {
		return nil, createErr
	}
	journal.ContainerID = ensured.ID
	if err := a.setSnapshotHelperJournal(ctx, job, key, journal, "created"); err != nil {
		return nil, err
	}
	output, runErr := a.dockerRuntime.RunSnapshotHelper(ctx, spec)
	cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := a.retireSnapshotHelper(cleanup, job, key, journal); err != nil {
		return nil, err
	}
	return output, runErr
}
func (a *Application) setSnapshotHelperJournal(ctx context.Context, job corestore.SnapshotJob, key string, journal snapshotHelperJournal, state string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); err != nil {
			return err
		}
		result, err := tx.Exec(`UPDATE snapshot_artifacts SET logical_id=?,state=? WHERE operation_id=? AND artifact_key=? AND kind='helper' AND state!='cleaned'`, string(snapshotRaw(journal)), state, job.OperationID, key)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return corestore.ErrRevisionConflict
		}
		return nil
	})
}
func (a *Application) retireSnapshotHelper(ctx context.Context, job corestore.SnapshotJob, key string, journal snapshotHelperJournal) error {
	spec := journal.Spec
	if spec.JobID != job.OperationID || spec.WorkID != snapshotJobWork(job) || spec.SpoolDirectory != filepath.Join(a.options.DataDirectory, "snapshots", "jobs", job.OperationID) {
		return corestore.ErrStorage
	}
	view, err := a.dockerRuntime.InspectSnapshotHelper(ctx, spec)
	if err != nil {
		return err
	}
	if view != nil {
		if journal.ContainerID != "" && journal.ContainerID != view.ID {
			return dockerengine.ErrIdentity
		}
		journal.ContainerID = view.ID
		if err := a.setSnapshotHelperJournal(ctx, job, key, journal, "cleaning"); err != nil {
			return err
		}
		if err := a.dockerRuntime.RemoveSnapshotHelper(ctx, spec, view.ID); err != nil {
			return err
		}
	} else if journal.ContainerID != "" {
		if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, journal.ContainerID, dockerengine.SnapshotHelperName(a.Store.InstallationID(), spec.JobID, spec.AttemptID)); err != nil {
			return err
		}
	} else if journal.CreationIssued {
		return dockerengine.ErrStateUnknown
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.UpdateSnapshotArtifact(tx, job.OperationID, job.WorkerEpoch, key, "cleaned"); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM resource_bindings WHERE installation_id=? AND resource_kind='snapshot-helper' AND logical_id=?`, a.Store.InstallationID(), spec.WorkID+"/"+dockerengine.SnapshotHelperIdentity(spec).LogicalID)
		return err
	})
}
