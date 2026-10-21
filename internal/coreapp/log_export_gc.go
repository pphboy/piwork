package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/safefs"
)

const (
	logArchiveMaxAge         = 7 * 24 * time.Hour
	logArchivePerWorkBytes   = int64(512 << 20)
	logArchiveInstallBytes   = int64(2 << 30)
	logExportSummaryRetain   = 7 * 24 * time.Hour
	logExportGarbageInterval = time.Hour
)

type logArchiveGarbage struct {
	workID, sourceID string
	path             string
	size             int64
	published        time.Time
}

func (a *Application) startLogExportGC() {
	a.logExportWG.Add(1)
	go func() {
		defer a.logExportWG.Done()
		ticker := time.NewTicker(logExportGarbageInterval)
		defer ticker.Stop()
		for {
			select {
			case <-a.ctx.Done():
				return
			case <-ticker.C:
				a.runLogExportGC(a.ctx)
			}
		}
	}()
}

// runLogExportGC applies independent bounded retention to Work archives and
// export areas. It never deletes Core shards (the log manager owns them) and
// never removes other installations' resources.
func (a *Application) runLogExportGC(ctx context.Context) {
	a.collectLogExportGarbage(ctx)
	a.collectLogArchiveGarbage(ctx)
}

func (a *Application) collectLogExportGarbage(ctx context.Context) {
	a.logDownloadMu.Lock()
	defer a.logDownloadMu.Unlock()
	tasks, err := a.Store.LogExportTasks(ctx)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	for _, task := range tasks {
		switch task.State {
		case "collecting", "packing":
			continue
		case "ready":
			if task.CleanupPending {
				a.cleanupReadyLogExport(ctx, task)
			}
			expires, err := time.Parse(time.RFC3339Nano, resultExpiry(task))
			if err == nil && now.Before(expires) {
				continue
			}
			if a.logExportsDownloading[task.ExportID] > 0 {
				continue
			}
			_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
				key, _ := corestore.LogTaskKey(task.ExportID)
				current, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
				if err != nil || !found || current.State != "ready" {
					return err
				}
				current.State = "expired"
				current.CleanupPending = true
				current.UpdatedAt = now.Format(time.RFC3339Nano)
				return corestore.PutLogRecordTx(tx, key, current)
			})
			task.State = "expired"
			a.cleanupPendingLogExport(ctx, task)
		case "expired", "failed", "interrupted":
			a.cleanupPendingLogExport(ctx, task)
			if task.State == "expired" {
				expires, err := time.Parse(time.RFC3339Nano, resultExpiry(task))
				if err == nil && now.Before(expires.Add(logExportSummaryRetain)) {
					continue
				}
			} else if updated, err := time.Parse(time.RFC3339Nano, task.UpdatedAt); err == nil && now.Before(updated.Add(logExportSummaryRetain)) {
				a.cleanupPendingLogExport(ctx, task)
				continue
			}
			a.purgeLogExport(ctx, task.ExportID)
		}
	}
}

func resultExpiry(task corestore.LogExportTask) string {
	if task.Result == nil {
		return ""
	}
	return task.Result.ExpiresAt
}

func (a *Application) cleanupPendingLogExport(ctx context.Context, task corestore.LogExportTask) {
	if task.State != "failed" && task.State != "interrupted" && task.State != "expired" {
		return
	}
	if a.logExportsDownloading[task.ExportID] > 0 {
		return
	}
	pending := a.Store.RemoveLogExportDir(task.ExportID) != nil
	_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(task.ExportID)
		current, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found || current.CleanupPending == pending {
			return err
		}
		current.CleanupPending = pending
		return corestore.PutLogRecordTx(tx, key, current)
	})
}

func (a *Application) purgeLogExport(ctx context.Context, exportID string) {
	if a.logExportsDownloading[exportID] > 0 {
		return
	}
	if err := a.Store.RemoveLogExportDir(exportID); err != nil {
		return
	}
	_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, prefix := range []string{"log_task_", "log_item_", "log_result_", "log_idem_"} {
			keys, err := listLogKeysTx(tx, prefix)
			if err != nil {
				return err
			}
			for _, key := range keys {
				if prefix == "log_idem_" {
					mapping, found, err := corestore.GetLogRecordTx[corestore.LogIdempotency](tx, key)
					if err != nil {
						return err
					}
					if !found || mapping.ExportID != exportID {
						continue
					}
				} else if !strings.Contains(key, strings.ReplaceAll(exportID, "-", "")) {
					continue
				}
				if err := corestore.DeleteLogRecordTx(tx, key); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

func listLogKeysTx(tx *sql.Tx, prefix string) ([]string, error) {
	rows, err := tx.Query(`SELECT key FROM control_metadata WHERE key>=? AND key<?`, prefix, prefix+"\xff")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func (a *Application) collectLogArchiveGarbage(ctx context.Context) {
	a.logDownloadMu.Lock()
	defer a.logDownloadMu.Unlock()
	tasks, err := a.Store.LogExportTasks(ctx)
	if err != nil {
		return
	}
	active := false
	for _, task := range tasks {
		if task.State == "collecting" || task.State == "packing" {
			active = true
			break
		}
	}
	if active {
		// A running export pins every archive it may read.
		return
	}
	works, err := a.Store.OpenWorkLogsRoot()
	if err != nil {
		return
	}
	defer works.Close()
	workNames, err := works.Entries()
	if err != nil {
		return
	}
	now := time.Now().UTC()
	var all []logArchiveGarbage
	perWork := map[string][]logArchiveGarbage{}
	for _, workName := range workNames {
		work, err := works.OpenPrivateDirectory(workName)
		if err != nil {
			continue
		}
		sourceNames, _ := work.Entries()
		for _, sourceName := range sourceNames {
			if strings.HasPrefix(sourceName, ".staging-") {
				continue
			}
			source, err := work.OpenPrivateDirectory(sourceName)
			if err != nil {
				continue
			}
			raw, readErr := source.ReadFile(archiveMetadataFileName, 1<<20)
			var metadata archiveMetadata
			source.Close()
			if readErr != nil || json.Unmarshal(raw, &metadata) != nil || metadata.SourceID != sourceName {
				continue
			}
			published, err := time.Parse(time.RFC3339Nano, metadata.ArchivedAt)
			if err != nil {
				continue
			}
			size := metadata.StdoutBytes + metadata.StderrBytes
			item := logArchiveGarbage{workID: workName, sourceID: sourceName, path: filepath.Join(workName, sourceName), size: size, published: published}
			all = append(all, item)
			perWork[workName] = append(perWork[workName], item)
		}
		work.Close()
	}
	remove := map[string]bool{}
	for _, items := range perWork {
		sort.Slice(items, func(i, j int) bool { return items[i].published.Before(items[j].published) })
		total := int64(0)
		for _, item := range items {
			total += item.size
		}
		for _, item := range items {
			if total <= a.logLimits().archivePerWork && !item.published.Before(now.Add(-logArchiveMaxAge)) {
				break
			}
			remove[item.path] = true
			total -= item.size
		}
	}
	sort.Slice(all, func(i, j int) bool { return all[i].published.Before(all[j].published) })
	total := int64(0)
	for _, item := range all {
		total += item.size
	}
	for _, item := range all {
		if total <= a.logLimits().archiveInstall {
			break
		}
		if remove[item.path] {
			total -= item.size
			continue
		}
		remove[item.path] = true
		total -= item.size
	}
	for _, item := range all {
		if !remove[item.path] {
			continue
		}
		if err := removeLogArchiveDir(works, item.workID, item.sourceID); err != nil {
			continue
		}
		archive := corestore.LogArchive{Version: 1, SourceID: item.sourceID, State: "expired", Reason: "archive retention expired", PublishedAt: now.Format(time.RFC3339Nano)}
		_ = a.Store.RecordLogArchive(ctx, item.sourceID, archive, "expired", now.Format(time.RFC3339Nano))
	}
}

func removeLogArchiveDir(works *safefs.Root, workID, sourceID string) error {
	work, err := works.OpenPrivateDirectory(workID)
	if err != nil {
		return err
	}
	defer work.Close()
	if work.CheckEntry(sourceID, true) != nil {
		return nil
	}
	return work.RemoveTree(sourceID)
}

func (a *Application) cleanupReadyLogExport(ctx context.Context, task corestore.LogExportTask) {
	pending := a.cleanupLogExportStaging(task.ExportID)
	_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(task.ExportID)
		current, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found || current.State != "ready" {
			return err
		}
		current.CleanupPending = pending
		return corestore.PutLogRecordTx(tx, key, current)
	})
}
