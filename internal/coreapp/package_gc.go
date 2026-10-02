package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"piwork/internal/corestore"
)

var packageArtifactDirectory = regexp.MustCompile(`^[a-f0-9]{64}$`)
var packageArtifactStage = regexp.MustCompile(`^\.package-stage-[a-f0-9]{32}$`)
var packageJobDirectory = regexp.MustCompile(`^operation-[a-f0-9]{32}$`)

// Artifact collection runs before admission/queued workers. No filesystem
// deletion occurs inside a SQLite transaction; shared paths remain protected
// by all remaining rows, even after one old artifact identity is retired.
func (a *Application) collectPackageArtifactGarbage(ctx context.Context, now time.Time) error {
	a.packageStorageMu.Lock()
	defer a.packageStorageMu.Unlock()
	references := map[string]bool{}
	var live bool
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM pi_package_jobs WHERE phase IN ('queued','source','prepare','validate','publish','cleanup-pending'))`).Scan(&live); err != nil {
			return err
		}
		if live {
			return nil
		}
		old, err := corestore.CollectiblePackageArtifacts(tx, now.Add(-24*time.Hour).UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		for _, artifact := range old {
			if _, err := tx.Exec(`DELETE FROM pi_package_artifacts WHERE id=? AND lease_count=0 AND id NOT IN (SELECT head_artifact_id FROM pi_package_catalog)`, artifact.ID); err != nil {
				return err
			}
		}
		rows, err := tx.Query(`SELECT DISTINCT storage_path FROM pi_package_artifacts`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var path string
			if err := rows.Scan(&path); err != nil {
				return err
			}
			references[filepath.Clean(path)] = true
		}
		return rows.Err()
	}); err != nil {
		return err
	}
	if live {
		return nil
	}
	area, err := a.Store.OpenPackageArea("artifacts")
	if err != nil {
		return err
	}
	defer area.Close()
	path, err := area.Path("unused")
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	names, err := area.Entries()
	if err != nil {
		return err
	}
	cutoff := now.Add(-24 * time.Hour)
	for _, name := range names {
		if !packageArtifactDirectory.MatchString(name) && !packageArtifactStage.MatchString(name) {
			continue
		}
		if references[filepath.Join("pi-packages", "artifacts", name)] {
			continue
		}
		info, err := root.Lstat(name)
		if err != nil {
			return err
		}
		if info.ModTime().After(cutoff) {
			continue
		}
		if err := area.RemoveTree(name); err != nil {
			return err
		}
	}
	return nil
}

// Terminal jobs no longer own a writable helper mount. Recovery has confirmed
// those helpers absent before calling this collector. Unknown names remain.
func (a *Application) collectPackageJobGarbage(ctx context.Context, now time.Time) error {
	a.packageStorageMu.Lock()
	defer a.packageStorageMu.Unlock()
	retain := map[string]bool{}
	known := map[string]bool{}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		jobs, err := corestore.PackageJobs(tx, false)
		if err != nil {
			return err
		}
		for _, job := range jobs {
			known[job.OperationID] = true
			retain[job.OperationID] = !job.LeasesReleased || job.Phase == "cleanup-pending"
		}
		return nil
	}); err != nil {
		return err
	}
	area, err := a.Store.OpenPackageArea("jobs")
	if err != nil {
		return err
	}
	defer area.Close()
	path, err := area.Path("unused")
	if err != nil {
		return err
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer root.Close()
	names, err := area.Entries()
	if err != nil {
		return err
	}
	for _, name := range names {
		if !packageJobDirectory.MatchString(name) || retain[name] {
			continue
		}
		info, err := root.Lstat(name)
		if err != nil {
			return err
		}
		if !known[name] && info.ModTime().After(now.Add(-24*time.Hour)) {
			continue
		}
		if err := area.RemoveTree(name); err != nil {
			return err
		}
	}
	return nil
}

func (a *Application) collectExpiredPackageUploads(ctx context.Context, now time.Time) error {
	var ids []string
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := corestore.ExpirePackageUploads(tx, now.UTC().Format(time.RFC3339Nano)); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT id FROM pi_package_uploads WHERE state='expired' AND lease_count=0`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	}); err != nil {
		return err
	}
	if len(ids) == 0 {
		return nil
	}
	// Active upload handlers have their own private directory lock. Avoid
	// disrupting those transfers; the expired tombstones are retried later.
	if a.packageUploads.Load() > 0 {
		return nil
	}
	root, err := a.Store.OpenPackageUploadsRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	for _, id := range ids {
		if !packageUploadFile.MatchString(id + ".zip") {
			return corestore.ErrStorage
		}
		if err := root.Remove(id + ".zip"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (a *Application) startPackageUploadCollector() {
	a.packageWG.Add(1)
	go func() {
		defer a.packageWG.Done()
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-a.ctx.Done():
				return
			case now := <-ticker.C:
				query, cancel := context.WithTimeout(a.ctx, 10*time.Second)
				_ = a.collectExpiredPackageUploads(query, now)
				_ = a.recoverSnapshotJobs(query, true)
				cancel()
			}
		}
	}()
}
