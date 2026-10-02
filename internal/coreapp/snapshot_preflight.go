package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func (a *Application) captureSnapshotHelper(ctx context.Context) {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()
	if a.snapshotImageCaptured {
		return
	}
	a.snapshotImageCaptured = true
	if strings.TrimSpace(a.options.SnapshotHelperImage) == "" || a.engine == nil || a.inspector == nil {
		return
	}
	bounded, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	image, err := a.engine.PrepareImage(bounded, a.options.SnapshotHelperImage)
	if err != nil {
		return
	}
	capabilities, err := a.inspector.InspectNativeSnapshotHelper(bounded, image.ID)
	if err == nil && capabilities.SnapshotHelper {
		a.snapshotImageID = image.ID
	}
}
func (a *Application) requireSnapshotImage() (string, error) {
	a.snapshotMu.Lock()
	defer a.snapshotMu.Unlock()
	if a.snapshotImageID == "" {
		return "", contracts.NewError("SNAPSHOT_HELPER_UNAVAILABLE", "")
	}
	return a.snapshotImageID, nil
}
func (a *Application) snapshotPreflight(ctx context.Context, workID, current string) (snapshotMetadata, error) {
	var zero snapshotMetadata
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		return zero, err
	}
	if work.DesiredState != "stopped" || work.ObservedState != "stopped" {
		return zero, contracts.NewError("SNAPSHOT_REQUIRES_STOPPED", "")
	}
	if a.dockerRuntime == nil || a.engine == nil {
		return zero, contracts.NewError("SNAPSHOT_RUNTIME_UNAVAILABLE", "")
	}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		pending, err := corestore.PendingFileJobs(tx, &workID)
		if err != nil {
			return err
		}
		if len(pending) != 0 {
			return contracts.NewError("WORK_BUSY", "")
		}
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM operations WHERE work_id=? AND id!=? AND state IN ('pending','running')`, workID, current).Scan(&count); err != nil {
			return err
		}
		if count != 0 {
			return contracts.NewError("WORK_BUSY", "")
		}
		return nil
	})
	if err != nil {
		return zero, err
	}
	for _, kind := range []string{"agent", "service", "file-helper"} {
		containers, err := a.dockerRuntime.ListContainers(ctx, kind)
		if err != nil {
			return zero, contracts.NewError("SNAPSHOT_RUNTIME_UNAVAILABLE", "")
		}
		for _, item := range containers {
			if item.Config == nil {
				return zero, contracts.NewError("SNAPSHOT_RUNTIME_UNAVAILABLE", "")
			}
			if item.Config.Labels[dockerengine.WorkLabel] != workID {
				continue
			}
			if item.State == nil || item.State.Running || (item.State.Status != "exited" && (kind == "file-helper" || item.State.Status != "created")) {
				return zero, contracts.NewError("SNAPSHOT_REQUIRES_STOPPED", "")
			}
			if kind == "file-helper" {
				return zero, contracts.NewError("WORK_BUSY", "")
			}
		}
	}
	result, err := a.collectSnapshotMetadata(ctx, workID, current)
	if err != nil {
		return zero, err
	}
	for _, volume := range result.Volumes {
		logical := "work-private"
		if volume.Record.Role == "workspace" {
			logical = "work-workspace"
		}
		if _, err := a.dockerRuntime.InspectVolume(ctx, volume.Record.RuntimeName, workID, logical); err != nil {
			return zero, contracts.NewError("SNAPSHOT_STORAGE_UNREADABLE", "")
		}
	}
	for _, image := range result.Images {
		actual, err := a.engine.InspectImage(ctx, image.ID)
		if err != nil {
			if errors.Is(err, dockerengine.ErrResourceMissing) {
				return zero, contracts.NewError("SNAPSHOT_IMAGE_MISSING", "")
			}
			return zero, contracts.NewError("SNAPSHOT_RUNTIME_UNAVAILABLE", "")
		}
		if actual.ID != image.ID {
			return zero, contracts.NewError("SNAPSHOT_IMAGE_MISSING", "")
		}
	}
	return result, nil
}
