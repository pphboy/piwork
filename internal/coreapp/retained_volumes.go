package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"sync"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
)

// PurgeRetainedVolume is the internal retained-storage control service. It
// preserves the existing API surface: no new public HTTP route is introduced.
// Acceptance is durable before the Engine side effect, and pending records
// continue to count against storage policy until absence is confirmed.
func (a *Application) PurgeRetainedVolume(ctx context.Context, actor identity.Principal, id string) (corestore.VolumeRecord, error) {
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return corestore.VolumeRecord{}, context.Canceled
	}
	a.refreshWG.Add(1)
	a.mu.Unlock()
	defer a.refreshWG.Done()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(a.ctx, cancel)
	defer stop()
	var volume corestore.VolumeRecord
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return err
		}
		var err error
		volume, err = corestore.ReadVolume(tx, id)
		if err != nil {
			return err
		}
		work, err := corestore.ReadWork(tx, volume.WorkID, true)
		if err != nil {
			return err
		}
		if work.OwnerUserID != actor.UserID && actor.Role != "admin" {
			return contracts.NewError("NOT_FOUND", "")
		}
		if _, err := a.retainedVolumeLogicalID(volume); err != nil {
			return err
		}
		return corestore.RequestVolumePurge(tx, id)
	})
	if err != nil {
		return corestore.VolumeRecord{}, err
	}
	return a.finishRetainedVolumePurge(ctx, volume)
}

func (a *Application) retainedVolumeLogicalID(v corestore.VolumeRecord) (string, error) {
	logical := ""
	switch v.Role {
	case "agent-private":
		logical = "work-private"
	case "workspace":
		logical = "work-workspace"
	}
	if logical == "" || v.InstallationID != a.Store.InstallationID() || v.ServiceID != nil || v.RuntimeName != dockerengine.ManagedVolumeName(v.InstallationID, v.WorkID, logical) {
		return "", corestore.ErrVolumeState
	}
	return logical, nil
}

func (a *Application) finishRetainedVolumePurge(ctx context.Context, v corestore.VolumeRecord) (corestore.VolumeRecord, error) {
	value, _ := a.workLocks.LoadOrStore(v.WorkID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return corestore.VolumeRecord{}, err
	}
	defer lock.Unlock()
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		v, err = corestore.ReadVolume(tx, v.ID)
		return err
	})
	if err != nil || v.State == "purged" {
		return v, err
	}
	if v.State != "purge_pending" {
		return v, corestore.ErrVolumeState
	}
	logical, err := a.retainedVolumeLogicalID(v)
	if err != nil {
		return v, err
	}
	if a.dockerRuntime == nil {
		return v, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	if err := a.dockerRuntime.RemoveVolume(ctx, v.RuntimeName, v.WorkID, logical); err != nil {
		return v, err
	}
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.CompleteVolumePurge(tx, v.ID, true); err != nil {
			return err
		}
		var err error
		v, err = corestore.ReadVolume(tx, v.ID)
		return err
	})
	return v, err
}

func (a *Application) resumeRetainedVolumePurges(ctx context.Context) error {
	var records []corestore.VolumeRecord
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM volume_records WHERE state='purge_pending' AND installation_id=? ORDER BY id`, a.Store.InstallationID())
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			v, err := corestore.ReadVolume(tx, id)
			if err != nil {
				return err
			}
			records = append(records, v)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	var failures []error
	for _, v := range records {
		if _, err := a.finishRetainedVolumePurge(ctx, v); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
