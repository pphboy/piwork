package coreapp

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"time"

	"piwork/internal/corestore"
)

var packageUploadFile = regexp.MustCompile(`^upload-[a-f0-9-]{36}\.(staging|zip|inspection)$`)

// recoverPackageUploadFiles is deliberately conservative: only a ready row
// may retain an immutable ZIP. A crash before the row commit leaves a file
// without an accepted reference, which is removed before Core serves traffic.
func (a *Application) recoverPackageUploadFiles(ctx context.Context) error {
	root, err := a.Store.OpenPackageUploadsRoot()
	if err != nil {
		return corestore.ErrStorage
	}
	defer root.Close()
	ready := make(map[string]struct{})
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE pi_package_uploads SET state='expired' WHERE state='ready' AND lease_count=0 AND expires_at<=?`, time.Now().UTC().Format(time.RFC3339Nano))
		return err
	})
	if err != nil {
		return err
	}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM pi_package_uploads WHERE state='ready'`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ready[id+".zip"] = struct{}{}
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	entries, err := root.Entries()
	if err != nil {
		return corestore.ErrStorage
	}
	for _, name := range entries {
		if !packageUploadFile.MatchString(name) {
			return corestore.ErrStorage
		}
		switch {
		case strings.HasSuffix(name, ".inspection"):
			if err := root.RemoveTree(name); err != nil {
				return corestore.ErrStorage
			}
		case strings.HasSuffix(name, ".staging"):
			if root.CheckEntry(name, false) != nil || root.Remove(name) != nil {
				return corestore.ErrStorage
			}
		default:
			if root.CheckEntry(name, false) != nil {
				return corestore.ErrStorage
			}
			if _, keep := ready[name]; keep {
				delete(ready, name)
			} else if err := root.Remove(name); err != nil {
				return corestore.ErrStorage
			}
		}
	}
	if len(ready) != 0 {
		// A ready upload with missing bytes must never be consumed by a job.
		return corestore.ErrStorage
	}
	return nil
}
