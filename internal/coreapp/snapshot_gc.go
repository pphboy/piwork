package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"time"

	"piwork/internal/corestore"
)

// GC first closes durable package admission. A transfer/import lease prevents
// expiration or byte deletion; expired rows remain for 410 and same-key replay.
func (a *Application) collectSnapshotGarbage(ctx context.Context, now time.Time) error {
	a.snapshotStorageMu.Lock()
	defer a.snapshotStorageMu.Unlock()
	candidates := []string{}
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT id FROM snapshot_packages WHERE state='ready' AND expires_at<=?`, now.UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		expired := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			expired = append(expired, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, id := range expired {
			if _, err := corestore.ExpireSnapshotPackage(tx, id, now.UTC().Format(time.RFC3339Nano)); err != nil {
				return err
			}
		}
		rows, err = tx.Query(`SELECT id FROM snapshot_packages WHERE state IN ('expired','deleting')`)
		if err != nil {
			return err
		}
		ids := []string{}
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, id := range ids {
			busy, err := corestore.SnapshotPackageInUse(tx, id)
			if err != nil {
				return err
			}
			if busy {
				continue
			}
			if _, err := tx.Exec(`UPDATE snapshot_packages SET state='deleting' WHERE id=? AND state IN ('expired','deleting')`, id); err != nil {
				return err
			}
			candidates = append(candidates, id)
		}
		return nil
	})
	if err != nil {
		return err
	}
	root, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		return err
	}
	defer root.Close()
	for _, id := range candidates {
		if !validResourceID(id) {
			return corestore.ErrStorage
		}
		if err := root.Remove(id + ".work"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err := root.Sync(); err != nil {
			return err
		}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE snapshot_packages SET state='expired' WHERE id=? AND state='deleting'`, id)
			return err
		}); err != nil {
			return err
		}
	}
	return nil
}
