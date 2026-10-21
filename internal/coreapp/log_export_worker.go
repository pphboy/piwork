package coreapp

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/corelogs"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
)

const (
	logExportTotalBudget     = 10 * time.Minute
	logExportPerSourceTime   = 30 * time.Second
	logExportPerSourceBytes  = int64(512 << 20)
	logExportTotalBytes      = int64(1 << 30)
	logExportReadyTTL        = 24 * time.Hour
	logExportManifestVersion = 1
)

type logExportCoreFile struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Digest  string `json:"digest"`
	Start   string `json:"startTime,omitempty"`
	End     string `json:"endTime,omitempty"`
	Partial bool   `json:"partial,omitempty"`
	Reason  string `json:"reason,omitempty"`
}

type logManifest struct {
	Version      int                `json:"version"`
	ExportID     string             `json:"exportId"`
	CutoffTime   string             `json:"cutoffTime"`
	GeneratedAt  string             `json:"generatedAt"`
	Scope        logManifestScope   `json:"scope"`
	Retention    logManifestRetain  `json:"retention"`
	Complete     bool               `json:"complete"`
	WarningCount int                `json:"warningCount"`
	Core         logManifestCore    `json:"core"`
	Sources      []logManifestEntry `json:"sources"`
}

type logManifestScope struct {
	IncludeCoreLogs bool  `json:"includeCoreLogs"`
	OwnedWorkCount  int64 `json:"ownedWorkCount"`
	SourceCount     int64 `json:"sourceCount"`
}

type logManifestRetain struct {
	CoreMaxSegmentBytes  int64 `json:"coreMaxSegmentBytes"`
	CoreMaxTotalBytes    int64 `json:"coreMaxTotalBytes"`
	CoreMaxAgeHours      int   `json:"coreMaxAgeHours"`
	ArchiveMaxAgeHours   int   `json:"archiveMaxAgeHours"`
	ArchivePerWorkBytes  int64 `json:"archivePerWorkBytes"`
	ArchiveInstallBytes  int64 `json:"archiveInstallBytes"`
	ExportReadyValidFor  int   `json:"exportReadyHours"`
	PerSourceByteMaximum int64 `json:"perSourceByteMaximum"`
	TotalByteMaximum     int64 `json:"totalByteMaximum"`
}

type logManifestCore struct {
	IncludeCoreLogs bool                `json:"includeCoreLogs"`
	CoverageStart   string              `json:"coverageStart,omitempty"`
	CoverageEnd     string              `json:"coverageEnd,omitempty"`
	Partial         bool                `json:"partial"`
	Reason          string              `json:"reason,omitempty"`
	Files           []logExportCoreFile `json:"files"`
}

type logManifestEntry struct {
	SourceID  string   `json:"sourceId"`
	WorkID    string   `json:"workId"`
	Kind      string   `json:"kind"`
	ServiceID string   `json:"serviceId,omitempty"`
	State     string   `json:"state"`
	Start     string   `json:"startTime,omitempty"`
	End       string   `json:"endTime,omitempty"`
	Bytes     int64    `json:"bytes"`
	Entries   []string `json:"entries"`
	Reason    string   `json:"reason,omitempty"`
}

type logExportRun struct {
	app           *Application
	ctx           context.Context
	task          corestore.LogExportTask
	sources       *safefs.Root
	boundary      *corelogs.Boundary
	coreFiles     []logExportCoreFile
	items         []corestore.LogTaskSource
	total         int64
	processed     int64
	collected     int64
	coreReason    string
	areaRemaining int64
}

func (a *Application) startLogExportWorker(exportID string) {
	a.logExportWG.Add(1)
	go func() {
		defer a.logExportWG.Done()
		a.runLogExport(exportID)
	}()
}

func (a *Application) runLogExport(exportID string) {
	ctx, cancel := context.WithTimeout(a.ctx, a.logLimits().totalBudget)
	defer cancel()
	a.logDownloadMu.Lock()
	boundary, accepted := a.logBoundaries[exportID]
	delete(a.logBoundaries, exportID)
	a.logDownloadMu.Unlock()
	defer boundary.Release()
	defer func() {
		a.logDownloadMu.Lock()
		defer a.logDownloadMu.Unlock()
		task, found, err := a.Store.LogExportTask(context.Background(), exportID)
		if err != nil || !found {
			return
		}
		if task.State == "ready" {
			a.cleanupReadyLogExport(context.Background(), task)
		} else {
			a.cleanupPendingLogExport(context.Background(), task)
		}
	}()
	task, found, err := a.Store.LogExportTask(ctx, exportID)
	if err != nil || !found || task.State != "collecting" {
		return
	}
	run := &logExportRun{app: a, ctx: ctx, task: task, boundary: boundary}
	// Direct store acceptance is used by internal recovery/test callers only.
	if !accepted && a.logs != nil {
		run.boundary, _ = a.logs.Boundary()
		defer run.boundary.Release()
	}
	if a.logExportFaultForTest != nil {
		if err := a.logExportFaultForTest("collect"); err != nil {
			run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export collection failed")
			return
		}
	}
	used, safe := logExportAreaUsed(a.options.DataDirectory)
	if !safe || used >= a.logLimits().areaLimit {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export storage budget is unavailable")
		return
	}
	run.areaRemaining = a.logLimits().areaLimit - used
	var eligible bool
	ownerErr := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND enabled=1 AND role='admin')`, task.OwnerUserID).Scan(&eligible)
	})
	if ownerErr != nil || !eligible {
		run.fail("PERMISSION_DENIED", "The export owner is no longer an enabled administrator")
		return
	}
	if a.logs == nil {
		run.coreReason = "Core process logs are unavailable"
	}
	sources, err := a.Store.OpenLogExportSourcesDir(exportID)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export staging is unavailable")
		return
	}
	defer sources.Close()
	run.sources = sources
	items, err := a.Store.LogTaskSources(ctx, exportID)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export source records are unreadable")
		return
	}
	run.items = items
	run.collectCoreLogs()
	run.total = int64(len(run.coreFiles) + len(run.items))
	_ = run.updateTask(func(task *corestore.LogExportTask) error {
		task.Progress.TotalSources = run.total
		return nil
	})
	for index, item := range run.items {
		if ctx.Err() != nil {
			for _, remaining := range run.items[index:] {
				run.recordItem(remaining, "omitted", "export time budget was exhausted", nil, "", "", 0, 0)
			}
			break
		}
		run.collectSource(item)
	}
	if ctx.Err() != nil {
		run.fail("LOG_EXPORT_TIMEOUT", "export time budget was exhausted")
		return
	}
	run.pack()
}

func (run *logExportRun) updateTask(mutate func(*corestore.LogExportTask) error) error {
	return run.app.Store.Write(run.ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(run.task.ExportID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil {
			return err
		}
		if !found || task.WorkerEpoch != run.task.WorkerEpoch || (task.State != "collecting" && task.State != "packing") {
			return corestore.ErrStorage
		}
		if err := mutate(&task); err != nil {
			return err
		}
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := corestore.PutLogRecordTx(tx, key, task); err != nil {
			return err
		}
		run.task = task
		return nil
	})
}

func (run *logExportRun) fail(code, reason string) {
	persist, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = run.app.Store.Write(persist, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(run.task.ExportID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found || task.State == "ready" || task.State == "expired" {
			return err
		}
		task.State = "failed"
		task.CleanupPending = true
		task.Error = &corestore.LogTaskError{Code: code, Message: reason, CorrelationID: task.CorrelationID}
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		return corestore.PutLogRecordTx(tx, key, task)
	})
}

func (run *logExportRun) collectCoreLogs() {
	if run.app.logs == nil {
		return
	}
	boundary := run.boundary
	if boundary == nil {
		run.coreReason = "Core log boundary is unavailable"
		return
	}
	entries := boundary.Entries()
	if len(entries) == 0 {
		return
	}
	if err := run.sources.EnsureDirectory("core"); err != nil {
		run.coreReason = "Core log staging is unavailable"
		return
	}
	coreDir, err := run.sources.OpenPrivateDirectory("core")
	if err != nil {
		run.coreReason = "Core log staging is unavailable"
		return
	}
	defer coreDir.Close()
	cutoff, err := time.Parse(time.RFC3339Nano, run.task.CutoffTime)
	if err != nil {
		run.coreReason = "Core log cutoff is invalid"
		return
	}
	remaining := run.app.logLimits().totalBytes - run.collected
	for _, entry := range entries {
		if remaining <= 0 {
			run.coreFiles = append(run.coreFiles, logExportCoreFile{Name: entry.Name, Partial: true, Reason: "total byte budget was exhausted"})
			continue
		}
		reader, size, err := boundary.OpenSection(entry.Name)
		if err != nil {
			run.coreFiles = append(run.coreFiles, logExportCoreFile{Name: entry.Name, Partial: true, Reason: "Core shard is unavailable"})
			continue
		}
		file, err := coreDir.OpenFile(entry.Name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
		if err != nil {
			reader.Close()
			run.coreFiles = append(run.coreFiles, logExportCoreFile{Name: entry.Name, Partial: true, Reason: "Core shard staging failed"})
			continue
		}
		hash := sha256.New()
		scanner := &jsonLogTimeScanner{}
		limit := size
		if limit > remaining {
			limit = remaining
		}
		buffered := bufio.NewReaderSize(reader, 64<<10)
		var written int64
		partialReason := ""
		unknownTime := false
		for {
			line, readErr := buffered.ReadBytes('\n')
			if len(line) > 0 {
				if stamp, ok := coreLogLineTime(line); ok {
					if stamp.After(cutoff) {
						if readErr == io.EOF {
							break
						}
						if readErr != nil {
							partialReason = "Core shard was only partially collected"
							break
						}
						continue
					}
				} else {
					unknownTime = true
				}
				if written+int64(len(line)) > limit {
					partialReason = "Core shard exceeded the byte budget"
					break
				}
				n, writeErr := run.logWriter(file, nil).Write(line)
				if n > 0 {
					hash.Write(line[:n])
					_, _ = scanner.Write(line[:n])
					written += int64(n)
				}
				if writeErr != nil {
					partialReason = "Core shard was only partially collected"
					break
				}
			}
			if readErr == io.EOF {
				break
			}
			if readErr != nil {
				partialReason = "Core shard was only partially collected"
				break
			}
		}
		reader.Close()
		syncErr := file.Sync()
		closeErr := file.Close()
		coreFile := logExportCoreFile{Name: entry.Name, Size: written, Digest: hex.EncodeToString(hash.Sum(nil))}
		coreFile.Start, coreFile.End = scanner.rangeStrings()
		if partialReason != "" || syncErr != nil || closeErr != nil {
			coreFile.Partial = true
			coreFile.Reason = partialReason
			if coreFile.Reason == "" {
				coreFile.Reason = "Core shard staging failed"
			}
		} else if unknownTime {
			coreFile.Partial = true
			coreFile.Reason = "some Core records could not be time-filtered"
		}
		run.coreFiles = append(run.coreFiles, coreFile)
		run.collected += written
		remaining -= written
		run.processed++
		_ = run.updateTask(func(task *corestore.LogExportTask) error {
			task.Progress.ProcessedSources = run.processed
			task.Progress.CollectedBytes = run.collected
			return nil
		})
	}
}

func (run *logExportRun) collectSource(item corestore.LogTaskSource) {
	remaining := run.app.logLimits().totalBytes - run.collected
	if remaining <= 0 {
		run.recordItem(item, "omitted", "total byte budget was exhausted", nil, "", "", 0, 0)
		return
	}
	source, found, err := run.app.Store.LogSource(run.ctx, item.SourceID)
	if err != nil || !found {
		run.recordItem(item, "unavailable", "source record is unavailable", nil, "", "", 0, 0)
		return
	}
	archiveRoot, hasArchive, err := run.app.Store.OpenExistingLogSourceDir(source.WorkID, source.SourceID)
	if err != nil {
		run.recordItem(item, "unavailable", "source archive is unsafe", nil, "", "", 0, 0)
		return
	}
	if archiveRoot != nil {
		defer archiveRoot.Close()
	}
	limit := run.app.logLimits().perSourceBytes
	if remaining < limit {
		limit = remaining
	}
	liveState, reason := "unavailable", "source instance is unavailable"
	if source.ContainerID != "" && run.app.logReader() != nil {
		dir, dirErr := run.openSourceDir(item)
		if dirErr == nil {
			state, start, end, bytes, entries, readErr := run.copyLiveSource(source, dir, limit)
			dir.Close()
			if readErr == nil {
				run.recordItem(item, state, "", entries, start, end, bytes, 0)
				return
			}
			liveState, reason = state, classifyLiveReason(readErr)
			if !hasArchive {
				if state == "partial" && bytes > 0 {
					run.recordItem(item, state, reason, entries, start, end, bytes, 0)
					return
				}
				run.recordItem(item, "unavailable", reason, nil, "", "", 0, 0)
				return
			}
			_ = run.removeSourceDir(item)
		}
	}
	if hasArchive {
		dir, dirErr := run.openSourceDir(item)
		if dirErr != nil {
			run.recordItem(item, "unavailable", "archive staging is unavailable", nil, "", "", 0, 0)
			return
		}
		state, start, end, bytes, entries, err := run.copyArchivedSource(item, archiveRoot, dir, limit)
		dir.Close()
		if err != nil {
			reason := "archive could not be read"
			if state == "partial" || bytes > 0 {
				state = "partial"
				reason = "archive was only partially collected"
			}
			run.recordItem(item, state, reason, entries, start, end, bytes, 0)
			return
		}
		reason := ""
		archiveKey, _ := corestore.LogArchiveKey(source.SourceID)
		persisted, found, archiveErr := corestore.GetLogRecord[corestore.LogArchive](run.ctx, run.app.Store, archiveKey)
		metadataState, metadataReason, metadataOK := readArchiveMetadataState(archiveRoot, source, persisted)
		if !metadataOK || metadataState != "archived" || archiveErr != nil || !found || persisted.State != "archived" || source.State == "partial" || source.State == "failed" || source.State == "missing" {
			if state == "available" || state == "empty" {
				state = "partial"
			}
			reason = metadataReason
			if reason == "" {
				reason = "source archive was already incomplete"
			}
		}
		if state == "partial" && reason == "" {
			reason = "archive coverage could not be confirmed"
		}
		run.recordItem(item, state, reason, entries, start, end, bytes, 0)
		return
	}
	run.recordItem(item, liveState, reason, nil, "", "", 0, 0)
}

func classifyLiveReason(err error) string {
	switch {
	case errors.Is(err, dockerengine.ErrResourceMissing):
		return "source instance is unavailable"
	case errors.Is(err, dockerengine.ErrLogDriverUnsupported):
		return "log driver does not support complete reads"
	case errors.Is(err, dockerengine.ErrStreamLimit):
		return "source output exceeded the byte budget"
	case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
		return "source collection deadline was exceeded"
	default:
		return "source log collection failed"
	}
}

func (run *logExportRun) openSourceDir(item corestore.LogTaskSource) (*safefs.Root, error) {
	if err := run.sources.EnsureDirectory("works"); err != nil {
		return nil, err
	}
	works, err := run.sources.OpenPrivateDirectory("works")
	if err != nil {
		return nil, err
	}
	defer works.Close()
	if err := works.EnsureDirectory(item.WorkID); err != nil {
		return nil, err
	}
	work, err := works.OpenPrivateDirectory(item.WorkID)
	if err != nil {
		return nil, err
	}
	defer work.Close()
	if err := work.EnsureDirectory(item.SourceID); err != nil {
		return nil, err
	}
	return work.OpenPrivateDirectory(item.SourceID)
}

func (run *logExportRun) removeSourceDir(item corestore.LogTaskSource) error {
	if err := run.sources.EnsureDirectory("works"); err != nil {
		return err
	}
	works, err := run.sources.OpenPrivateDirectory("works")
	if err != nil {
		return err
	}
	defer works.Close()
	work, err := works.OpenPrivateDirectory(item.WorkID)
	if err != nil {
		return err
	}
	defer work.Close()
	if work.CheckEntry(item.SourceID, true) != nil {
		return nil
	}
	return work.RemoveTree(item.SourceID)
}

func (run *logExportRun) copyLiveSource(source corestore.LogSource, dir *safefs.Root, limit int64) (string, string, string, int64, []string, error) {
	stdoutFile, err := dir.OpenFile("stdout.log", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		return "unavailable", "", "", 0, nil, err
	}
	stderrFile, err := dir.OpenFile("stderr.log", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		stdoutFile.Close()
		return "unavailable", "", "", 0, nil, err
	}
	remaining := limit
	stdoutHash := &hashingWriter{writer: run.logWriter(stdoutFile, &remaining), hash: sha256.New()}
	stderrHash := &hashingWriter{writer: run.logWriter(stderrFile, &remaining), hash: sha256.New()}
	stdoutScanner, stderrScanner := &dockerTimestampScanner{}, &dockerTimestampScanner{}
	secrets, secretErr := run.app.logArchiveSecrets(run.ctx, source)
	if secretErr != nil {
		stdoutFile.Close()
		stderrFile.Close()
		return "unavailable", "", "", 0, nil, corestore.ErrStorage
	}
	stdoutRedactor := newSecretRedactor(stdoutHash, secrets)
	stderrRedactor := newSecretRedactor(stderrHash, secrets)
	cutoff, err := time.Parse(time.RFC3339Nano, run.task.CutoffTime)
	if err != nil {
		stdoutFile.Close()
		stderrFile.Close()
		return "unavailable", "", "", 0, nil, err
	}
	sourceCtx, cancel := context.WithTimeout(run.ctx, run.app.logLimits().perSourceTime)
	defer cancel()
	_, logErr := run.app.logReader().FullLogs(sourceCtx, logSourceIdentity(source), dockerengine.FullLogRequest{
		ExpectedContainerID: source.ContainerID, Until: cutoff, MaxBytes: limit,
	}, &archiveSink{redactor: stdoutRedactor, scanner: stdoutScanner}, &archiveSink{redactor: stderrRedactor, scanner: stderrScanner})
	flushErr := errors.Join(stdoutRedactor.Flush(), stderrRedactor.Flush())
	syncErr := errors.Join(stdoutFile.Sync(), stderrFile.Sync())
	closeErr := errors.Join(stdoutFile.Close(), stderrFile.Close())
	stdoutStart, stdoutEnd := stdoutScanner.rangeStrings()
	stderrStart, stderrEnd := stderrScanner.rangeStrings()
	start, end := combineArchiveRange(stdoutStart, stdoutEnd, stderrStart, stderrEnd)
	bytes := stdoutHash.size + stderrHash.size
	entries := []string{
		"works/" + source.WorkID + "/" + source.SourceID + "/stdout.log",
		"works/" + source.WorkID + "/" + source.SourceID + "/stderr.log",
	}
	if flushErr != nil || syncErr != nil || closeErr != nil {
		return "partial", start, end, bytes, entries, flushErr
	}
	if logErr != nil {
		if errors.Is(logErr, dockerengine.ErrStreamLimit) || bytes > 0 {
			return "partial", start, end, bytes, entries, logErr
		}
		return "unavailable", start, end, bytes, entries, logErr
	}
	if bytes == 0 {
		return "empty", start, end, 0, entries, nil
	}
	return "available", start, end, bytes, entries, nil
}

func (run *logExportRun) copyArchivedSource(item corestore.LogTaskSource, archive *safefs.Root, dir *safefs.Root, limit int64) (string, string, string, int64, []string, error) {
	cutoff, err := time.Parse(time.RFC3339Nano, run.task.CutoffTime)
	if err != nil {
		return "unavailable", "", "", 0, nil, err
	}
	var total int64
	var ranges [][2]string
	entries := []string{}
	unknown := false
	for _, name := range []string{"stdout.log", "stderr.log"} {
		target, err := dir.OpenFile(name, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
		if err != nil {
			return "unavailable", "", "", total, entries, err
		}
		written, start, end, hasUnknown, readErr := copyArchiveFile(archive, name, run.logWriter(target, nil), cutoff, limit-total)
		unknown = unknown || hasUnknown
		syncErr := target.Sync()
		closeErr := target.Close()
		if readErr != nil {
			return "partial", start, end, total + written, entries, readErr
		}
		if syncErr != nil || closeErr != nil {
			return "partial", start, end, total + written, entries, syncErr
		}
		total += written
		ranges = append(ranges, [2]string{start, end})
		entries = append(entries, "works/"+item.WorkID+"/"+item.SourceID+"/"+name)
	}
	start, end := combineArchiveRange(ranges[0][0], ranges[0][1], ranges[1][0], ranges[1][1])
	if unknown {
		return "partial", start, end, total, entries, nil
	}
	if total == 0 {
		return "empty", start, end, 0, entries, nil
	}
	return "available", start, end, total, entries, nil
}

func readArchiveMetadataState(root *safefs.Root, source corestore.LogSource, record corestore.LogArchive) (string, string, bool) {
	raw, err := root.ReadFile(archiveMetadataFileName, 1<<20)
	if err != nil {
		return "", "", false
	}
	var metadata archiveMetadata
	if json.Unmarshal(raw, &metadata) != nil || metadata.Version != 1 || metadata.SourceID != source.SourceID || metadata.WorkID != source.WorkID || metadata.ContainerID != source.ContainerID || metadata.StdoutBytes != record.StdoutBytes || metadata.StderrBytes != record.StderrBytes || metadata.StdoutDigest != record.StdoutDigest || metadata.StderrDigest != record.StderrDigest || metadata.State == "" {
		return "", "", false
	}
	return metadata.State, metadata.Reason, true
}

func copyArchiveFile(root *safefs.Root, name string, target io.Writer, cutoff time.Time, limit int64) (int64, string, string, bool, error) {
	file, err := root.OpenFile(name, unix.O_RDONLY)
	if err != nil {
		return 0, "", "", false, err
	}
	defer file.Close()
	reader := bufio.NewReaderSize(file, 64<<10)
	scanner := &dockerTimestampScanner{}
	var written int64
	unknown, first, include := false, true, true
	for {
		fragment, readErr := reader.ReadSlice('\n')
		if len(fragment) > 0 {
			if first {
				var known bool
				include, _, _, known = filterArchiveLine(fragment, cutoff)
				unknown = unknown || !known
				include = include || !known
			}
			if include {
				if int64(len(fragment)) > limit-written {
					return written, "", "", unknown, dockerengine.ErrStreamLimit
				}
				n, writeErr := target.Write(fragment)
				written += int64(n)
				scanner.Write(fragment[:n])
				if writeErr != nil {
					return written, "", "", unknown, writeErr
				}
			}
		}
		first = readErr != bufio.ErrBufferFull
		if readErr == io.EOF {
			break
		}
		if readErr != nil && readErr != bufio.ErrBufferFull {
			return written, "", "", unknown, readErr
		}
	}
	start, end := scanner.rangeStrings()
	return written, start, end, unknown, nil
}

func filterArchiveLine(line []byte, cutoff time.Time) (bool, string, string, bool) {
	tokenEnd := -1
	for index, value := range line {
		if value == ' ' {
			tokenEnd = index
			break
		}
		if index >= 64 {
			break
		}
	}
	if tokenEnd <= 0 {
		return true, "", "", false
	}
	stamp, err := time.Parse(time.RFC3339Nano, string(line[:tokenEnd]))
	if err != nil {
		return true, "", "", false
	}
	return !stamp.After(cutoff), stamp.UTC().Format(time.RFC3339Nano), stamp.UTC().Format(time.RFC3339Nano), true
}

func logSourceIdentity(source corestore.LogSource) dockerengine.ContainerIdentity {
	logicalID := "agentd"
	if source.Kind == "service" {
		logicalID = source.ServiceID
	}
	return dockerengine.ContainerIdentity{WorkID: source.WorkID, Kind: source.Kind, LogicalID: logicalID}
}

func (run *logExportRun) recordItem(item corestore.LogTaskSource, state, reason string, entries []string, start, end string, bytes int64, _ int) {
	run.processed++
	run.collected += bytes
	item.State, item.Reason, item.Entries, item.StartTime, item.EndTime, item.Bytes = state, reason, entries, start, end, bytes
	_ = run.app.Store.Write(run.ctx, func(tx *sql.Tx) error {
		taskKey, _ := corestore.LogTaskKey(run.task.ExportID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, taskKey)
		if err != nil {
			return err
		}
		if !found || task.WorkerEpoch != run.task.WorkerEpoch || (task.State != "collecting" && task.State != "packing") {
			return corestore.ErrStorage
		}
		itemKey, _ := corestore.LogTaskSourceKey(run.task.ExportID, item.Sequence)
		if err := corestore.PutLogRecordTx(tx, itemKey, item); err != nil {
			return err
		}
		task.Progress.ProcessedSources = run.processed
		task.Progress.CollectedBytes = run.collected
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := corestore.PutLogRecordTx(tx, taskKey, task); err != nil {
			return err
		}
		run.task = task
		return nil
	})
}

type logSeal struct {
	Version      int    `json:"version"`
	ExportID     string `json:"exportId"`
	OwnerUserID  string `json:"ownerUserId"`
	CutoffTime   string `json:"cutoffTime"`
	WorkerEpoch  int64  `json:"workerEpoch"`
	Size         int64  `json:"size"`
	Digest       string `json:"digest"`
	ReadyAt      string `json:"readyAt"`
	ExpiresAt    string `json:"expiresAt"`
	ManifestHash string `json:"manifestHash"`
}

func (run *logExportRun) pack() {
	if err := run.updateTask(func(task *corestore.LogExportTask) error { task.State = "packing"; return nil }); err != nil {
		return
	}
	items, err := run.app.Store.LogTaskSources(run.ctx, run.task.ExportID)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export source records are unreadable")
		return
	}
	manifest, complete, warningCount, warnings := run.buildManifest(items)
	raw, err := json.Marshal(manifest)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export manifest is invalid")
		return
	}
	export, err := run.app.Store.OpenLogExportDir(run.task.ExportID)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export staging is unavailable")
		return
	}
	defer export.Close()
	manifestFile, err := export.OpenFile("manifest.json", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export manifest is unavailable")
		return
	}
	_, writeErr := run.logWriter(manifestFile, nil).Write(raw)
	if writeErr == nil {
		writeErr = manifestFile.Sync()
	}
	closeErr := manifestFile.Close()
	if writeErr != nil || closeErr != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export manifest could not be stored")
		return
	}
	if run.app.logExportFaultForTest != nil {
		if err := run.app.logExportFaultForTest("zip"); err != nil {
			run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export archive could not be written")
			return
		}
	}
	part, err := export.OpenFile("bundle.zip.part", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export archive is unavailable")
		return
	}
	zipRemaining := run.app.logLimits().zipBytes
	hasher := &hashingWriter{writer: run.logWriter(part, &zipRemaining), hash: sha256.New()}
	zw := zip.NewWriter(hasher)
	zipErr := run.writeZip(zw, export, items)
	if zipErr == nil {
		zipErr = zw.Close()
	} else {
		_ = zw.Close()
	}
	if zipErr == nil {
		zipErr = part.Sync()
	}
	closeErr = part.Close()
	if zipErr != nil || closeErr != nil {
		_ = export.Remove("bundle.zip.part")
		if run.ctx.Err() != nil {
			run.fail("LOG_EXPORT_TIMEOUT", "export time budget was exhausted")
		} else {
			run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export archive could not be written")
		}
		return
	}
	size := hasher.size
	if used, ok := logExportAreaUsed(run.app.options.DataDirectory); !ok || used > run.app.logLimits().areaLimit {
		_ = export.Remove("bundle.zip.part")
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export storage area exceeded its quota")
		return
	}
	digest := hex.EncodeToString(hasher.hash.Sum(nil))
	readyAt := time.Now().UTC()
	expiresAt := readyAt.Add(run.app.logLimits().readyTTL)
	readyText, expiresText := readyAt.Format(time.RFC3339Nano), expiresAt.Format(time.RFC3339Nano)
	filename := "piwork-logs-" + run.task.ExportID + ".zip"
	seal := logSeal{
		Version: 1, ExportID: run.task.ExportID, OwnerUserID: run.task.OwnerUserID, CutoffTime: run.task.CutoffTime,
		WorkerEpoch: run.task.WorkerEpoch, Size: size, Digest: digest, ReadyAt: readyText, ExpiresAt: expiresText,
		ManifestHash: sha256Hex(raw),
	}
	sealRaw, _ := json.Marshal(seal)
	if err := export.RenameNoReplace("bundle.zip.part", "bundle.zip"); err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export archive publication failed")
		return
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export seal is unavailable")
		return
	}
	temp := "seal-" + hex.EncodeToString(nonce[:]) + ".tmp"
	sealFile, err := export.OpenFile(temp, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export seal is unavailable")
		return
	}
	_, sealErr := run.logWriter(sealFile, nil).Write(sealRaw)
	if sealErr == nil {
		sealErr = sealFile.Sync()
	}
	sealClose := sealFile.Close()
	if sealErr != nil || sealClose != nil || export.Rename(temp, "seal.json") != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export seal could not be published")
		return
	}
	result := corestore.LogResult{Filename: filename, Size: size, Digest: digest, ReadyAt: readyText, ExpiresAt: expiresText}
	if err := run.finishReady(result, complete, warningCount, warnings, seal); err != nil {
		run.fail("LOG_EXPORT_STORAGE_UNAVAILABLE", "export result could not be committed")
	}
}

type jsonLogTimeScanner struct {
	buffer []byte
	start  time.Time
	end    time.Time
	count  int64
}

func (s *jsonLogTimeScanner) Write(data []byte) (int, error) {
	s.buffer = append(s.buffer, data...)
	for {
		index := -1
		for position, value := range s.buffer {
			if value == '\n' {
				index = position
				break
			}
		}
		if index < 0 {
			if len(s.buffer) > 1<<20 {
				s.buffer = s.buffer[:0]
			}
			return len(data), nil
		}
		line := s.buffer[:index]
		s.buffer = append([]byte(nil), s.buffer[index+1:]...)
		if marker := bytes.Index(line, []byte(`"time":"`)); marker >= 0 {
			rest := line[marker+8:]
			if end := bytes.IndexByte(rest, '"'); end > 0 {
				if parsed, err := time.Parse(time.RFC3339Nano, string(rest[:end])); err == nil {
					if s.start.IsZero() || parsed.Before(s.start) {
						s.start = parsed
					}
					if s.end.IsZero() || parsed.After(s.end) {
						s.end = parsed
					}
					s.count++
				}
			}
		}
	}
}

func (s *jsonLogTimeScanner) rangeStrings() (string, string) {
	if s.start.IsZero() {
		return "", ""
	}
	return s.start.UTC().Format(time.RFC3339Nano), s.end.UTC().Format(time.RFC3339Nano)
}

func coreLogLineTime(line []byte) (time.Time, bool) {
	marker := bytes.Index(line, []byte(`"time":"`))
	if marker < 0 {
		return time.Time{}, false
	}
	rest := line[marker+8:]
	end := bytes.IndexByte(rest, '"')
	if end <= 0 {
		return time.Time{}, false
	}
	stamp, err := time.Parse(time.RFC3339Nano, string(rest[:end]))
	return stamp, err == nil
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func (run *logExportRun) writeZip(zw *zip.Writer, export *safefs.Root, items []corestore.LogTaskSource) error {
	if err := addZipFromRoot(zw, export, "manifest.json", "manifest.json"); err != nil {
		return err
	}
	for _, file := range run.coreFiles {
		if file.Partial && file.Size == 0 {
			continue
		}
		source, err := run.sources.OpenPrivateDirectory("core")
		if err != nil {
			return err
		}
		err = addZipFromRoot(zw, source, file.Name, "core/"+file.Name)
		source.Close()
		if err != nil {
			return err
		}
	}
	for _, item := range items {
		for _, entry := range item.Entries {
			file, err := run.openEntry(entry)
			if err != nil {
				return err
			}
			err = addZipEntry(zw, entry, file)
			file.Close()
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (run *logExportRun) openEntry(entry string) (*os.File, error) {
	parts := strings.Split(entry, "/")
	if len(parts) != 4 || parts[0] != "works" {
		return nil, corestore.ErrStorage
	}
	works, err := run.sources.OpenPrivateDirectory("works")
	if err != nil {
		return nil, err
	}
	defer works.Close()
	work, err := works.OpenPrivateDirectory(parts[1])
	if err != nil {
		return nil, err
	}
	defer work.Close()
	source, err := work.OpenPrivateDirectory(parts[2])
	if err != nil {
		return nil, err
	}
	defer source.Close()
	return source.OpenFile(parts[3], unix.O_RDONLY)
}

func addZipFromRoot(zw *zip.Writer, root *safefs.Root, name, entry string) error {
	file, err := root.OpenFile(name, unix.O_RDONLY)
	if err != nil {
		return err
	}
	defer file.Close()
	return addZipEntry(zw, entry, file)
}

func addZipEntry(zw *zip.Writer, name string, file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	header := &zip.FileHeader{Name: name, Method: zip.Deflate, Modified: info.ModTime()}
	writer, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.CopyBuffer(writer, file, make([]byte, 64<<10))
	return err
}

func (run *logExportRun) buildManifest(items []corestore.LogTaskSource) (logManifest, bool, int, []corestore.LogWarning) {
	complete := len(run.coreFiles) > 0 || run.coreReason == ""
	manifest := logManifest{
		Version: logExportManifestVersion, ExportID: run.task.ExportID, CutoffTime: run.task.CutoffTime,
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Scope:       logManifestScope{IncludeCoreLogs: run.task.Scope.IncludeCoreLogs, OwnedWorkCount: run.task.Scope.OwnedWorkCount, SourceCount: run.task.Scope.SourceCount},
		Retention: logManifestRetain{
			CoreMaxSegmentBytes: corelogs.DefaultMaxSegmentBytes, CoreMaxTotalBytes: corelogs.DefaultMaxTotalBytes,
			CoreMaxAgeHours: int(corelogs.DefaultMaxAge / time.Hour), ArchiveMaxAgeHours: int(logArchiveMaxAge / time.Hour), ArchivePerWorkBytes: run.app.logLimits().archivePerWork,
			ArchiveInstallBytes: run.app.logLimits().archiveInstall, ExportReadyValidFor: int(run.app.logLimits().readyTTL / time.Hour), PerSourceByteMaximum: run.app.logLimits().perSourceBytes, TotalByteMaximum: run.app.logLimits().totalBytes,
		},
		Core: logManifestCore{IncludeCoreLogs: true, Files: append([]logExportCoreFile{}, run.coreFiles...), Reason: run.coreReason},
	}
	manifest.Sources = []logManifestEntry{}
	warnings := []corestore.LogWarning{}
	corePartial := run.coreReason != ""
	for _, file := range run.coreFiles {
		if file.Partial {
			corePartial = true
			warnings = append(warnings, corestore.LogWarning{Code: "CORE_LOG_PARTIAL", Message: "A Core log shard was only partially collected"})
		}
		if manifest.Core.CoverageStart == "" || file.Start != "" && file.Start < manifest.Core.CoverageStart {
			manifest.Core.CoverageStart = file.Start
		}
		if file.End > manifest.Core.CoverageEnd {
			manifest.Core.CoverageEnd = file.End
		}
	}
	manifest.Core.Partial = corePartial
	complete = !corePartial
	for _, item := range items {
		entry := logManifestEntry{
			SourceID: item.SourceID, WorkID: item.WorkID, Kind: item.Kind, ServiceID: item.ServiceID, State: item.State,
			Start: item.StartTime, End: item.EndTime, Bytes: item.Bytes, Entries: append([]string{}, item.Entries...), Reason: item.Reason,
		}
		if item.State != "available" && item.State != "empty" {
			complete = false
			reason := item.Reason
			if reason == "" {
				reason = "source logs are unavailable"
			}
			warnings = append(warnings, corestore.LogWarning{Code: "SOURCE_" + strings.ToUpper(item.State), Message: reason})
		}
		manifest.Sources = append(manifest.Sources, entry)
	}
	manifest.Complete = complete
	manifest.WarningCount = len(warnings)
	if len(warnings) > 20 {
		warnings = warnings[:20]
	}
	return manifest, complete, manifest.WarningCount, warnings
}

func (run *logExportRun) finishReady(result corestore.LogResult, complete bool, warningCount int, warnings []corestore.LogWarning, seal logSeal) error {
	return run.app.Store.Write(run.ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(run.task.ExportID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found || task.WorkerEpoch != run.task.WorkerEpoch || task.State != "packing" {
			return corestore.ErrStorage
		}
		// Role loss while collecting must not publish a fresh content permit.
		var eligible bool
		if err := tx.QueryRowContext(run.ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=? AND enabled=1 AND role='admin')`, task.OwnerUserID).Scan(&eligible); err != nil {
			return err
		}
		if !eligible {
			task.State, task.Result = "failed", nil
			task.Error = &corestore.LogTaskError{Code: "PERMISSION_DENIED", Message: "The export owner is no longer an enabled administrator", CorrelationID: task.CorrelationID}
			task.CleanupPending = true
			task.UpdatedAt = packageNow()
			return corestore.PutLogRecordTx(tx, key, task)
		}
		task.State = "ready"
		task.Complete = &complete
		task.WarningCount = int64(warningCount)
		task.Warnings = warnings
		task.WarningsTruncated = warningCount > len(warnings)
		task.Result = &result
		task.Error = nil
		task.Progress.ProcessedSources = run.processed
		task.Progress.TotalSources = run.total
		task.Progress.CollectedBytes = run.collected
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := corestore.PutLogRecordTx(tx, key, task); err != nil {
			return err
		}
		resultKey, _ := corestore.LogResultKey(run.task.ExportID)
		return corestore.PutLogRecordTx(tx, resultKey, corestore.LogResultRecord{
			Version: 1, ExportID: run.task.ExportID, OwnerUserID: task.OwnerUserID, WorkerEpoch: task.WorkerEpoch,
			CutoffTime: task.CutoffTime, Filename: result.Filename, Size: result.Size, Digest: result.Digest,
			ReadyAt: result.ReadyAt, ExpiresAt: result.ExpiresAt, ManifestHash: seal.ManifestHash,
		})
	})
}

// recoverLogExports finalizes tasks after a process restart without changing
// their cutoff, sources or idempotency identity. Unsealed work becomes
// interrupted; a sealed result is reused only when its bytes verify.
func (a *Application) recoverLogExports(ctx context.Context) {
	tasks, err := a.Store.LogExportTasks(ctx)
	if err != nil {
		return
	}
	for _, task := range tasks {
		switch task.State {
		case "collecting", "packing":
			if recovered, corrupt := a.recoverSealedLogExport(ctx, task); recovered {
				continue
			} else if corrupt {
				_ = a.failLogExportContent(task.ExportID)
				continue
			}
			cleanupPending := a.cleanupLogExportStaging(task.ExportID)
			_ = a.Store.Write(ctx, func(tx *sql.Tx) error {
				key, _ := corestore.LogTaskKey(task.ExportID)
				current, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
				if err != nil || !found || current.State != "collecting" && current.State != "packing" {
					return err
				}
				current.State = "interrupted"
				current.Error = &corestore.LogTaskError{Code: "LOG_EXPORT_INTERRUPTED", Message: "Core restarted before the export result was sealed", CorrelationID: current.CorrelationID}
				current.CleanupPending = cleanupPending
				current.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
				return corestore.PutLogRecordTx(tx, key, current)
			})
		case "ready":
			if !a.verifyLogExportResult(ctx, task) {
				_ = a.failLogExportContent(task.ExportID)
			}
		}
	}
}

// recoverSealedLogExport reconciles a crash after seal publication but before
// the ready metadata transaction. The original cutoff, epoch and bytes are
// reused; no collection or packing is restarted.
func (a *Application) recoverSealedLogExport(ctx context.Context, task corestore.LogExportTask) (recovered, corrupt bool) {
	export, err := a.Store.OpenLogExportDir(task.ExportID)
	if err != nil {
		return false, false
	}
	defer export.Close()
	sealRaw, err := export.ReadFile("seal.json", 64<<10)
	if err != nil {
		return false, false
	}
	var seal logSeal
	if json.Unmarshal(sealRaw, &seal) != nil || seal.ExportID != task.ExportID || seal.OwnerUserID != task.OwnerUserID ||
		seal.CutoffTime != task.CutoffTime || seal.WorkerEpoch != task.WorkerEpoch {
		return false, true
	}
	manifestRaw, err := export.ReadFile("manifest.json", 4<<20)
	if err != nil {
		return false, true
	}
	if seal.ManifestHash != "" && sha256Hex(manifestRaw) != seal.ManifestHash {
		return false, true
	}
	var manifest logManifest
	if json.Unmarshal(manifestRaw, &manifest) != nil || manifest.ExportID != task.ExportID || manifest.CutoffTime != task.CutoffTime {
		return false, true
	}
	file, err := export.OpenFile("bundle.zip", unix.O_RDONLY)
	if err != nil {
		return false, true
	}
	hash := sha256.New()
	size, err := io.CopyBuffer(hash, io.LimitReader(file, seal.Size+1), make([]byte, 64<<10))
	file.Close()
	if err != nil || size != seal.Size || hex.EncodeToString(hash.Sum(nil)) != seal.Digest {
		return false, true
	}
	complete := manifest.Complete
	warnings := make([]corestore.LogWarning, 0, len(manifest.Sources))
	for _, source := range manifest.Sources {
		if source.State == "available" || source.State == "empty" {
			continue
		}
		reason := source.Reason
		if reason == "" {
			reason = "source logs are unavailable"
		}
		warnings = append(warnings, corestore.LogWarning{Code: "SOURCE_" + strings.ToUpper(source.State), Message: reason})
	}
	warningCount := int64(manifest.WarningCount)
	if warningCount < int64(len(warnings)) {
		warningCount = int64(len(warnings))
	}
	if len(warnings) > 20 {
		warnings = warnings[:20]
	}
	result := corestore.LogResult{Filename: "piwork-logs-" + task.ExportID + ".zip", Size: seal.Size, Digest: seal.Digest, ReadyAt: seal.ReadyAt, ExpiresAt: seal.ExpiresAt}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(task.ExportID)
		current, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil {
			return err
		}
		if !found || current.State != "collecting" && current.State != "packing" {
			return nil
		}
		current.State = "ready"
		current.Complete = &complete
		current.WarningCount = warningCount
		current.Warnings = warnings
		current.WarningsTruncated = warningCount > int64(len(warnings))
		current.Result = &result
		current.Error = nil
		current.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := corestore.PutLogRecordTx(tx, key, current); err != nil {
			return err
		}
		resultKey, _ := corestore.LogResultKey(task.ExportID)
		return corestore.PutLogRecordTx(tx, resultKey, corestore.LogResultRecord{Version: 1, ExportID: task.ExportID, OwnerUserID: task.OwnerUserID,
			WorkerEpoch: task.WorkerEpoch, CutoffTime: task.CutoffTime, Filename: result.Filename, Size: result.Size, Digest: result.Digest,
			ReadyAt: result.ReadyAt, ExpiresAt: result.ExpiresAt, ManifestHash: seal.ManifestHash})
	}); err != nil {
		return false, true
	}
	return true, false
}

func (a *Application) cleanupLogExportStaging(exportID string) bool {
	export, err := a.Store.OpenLogExportDir(exportID)
	if err != nil {
		return true
	}
	defer export.Close()
	if export.CheckEntry("sources", true) == nil {
		if err := export.RemoveTree("sources"); err != nil {
			return true
		}
	}
	return false
}

func (a *Application) verifyLogExportResult(ctx context.Context, task corestore.LogExportTask) bool {
	if task.Result == nil {
		return false
	}
	resultKey, ok := corestore.LogResultKey(task.ExportID)
	if !ok {
		return false
	}
	if _, found, err := corestore.GetLogRecord[corestore.LogResultRecord](ctx, a.Store, resultKey); err != nil || !found {
		return false
	}
	export, err := a.Store.OpenLogExportDir(task.ExportID)
	if err != nil {
		return false
	}
	defer export.Close()
	sealRaw, err := export.ReadFile("seal.json", 64<<10)
	if err != nil {
		return false
	}
	var seal logSeal
	if json.Unmarshal(sealRaw, &seal) != nil || seal.ExportID != task.ExportID || seal.OwnerUserID != task.OwnerUserID ||
		seal.CutoffTime != task.CutoffTime || seal.WorkerEpoch != task.WorkerEpoch || seal.Size != task.Result.Size ||
		seal.Digest != task.Result.Digest || seal.ExpiresAt != task.Result.ExpiresAt {
		return false
	}
	file, err := export.OpenFile("bundle.zip", unix.O_RDONLY)
	if err != nil {
		return false
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.CopyBuffer(hash, io.LimitReader(file, task.Result.Size+1), make([]byte, 64<<10))
	if err != nil || size != task.Result.Size || hex.EncodeToString(hash.Sum(nil)) != task.Result.Digest {
		return false
	}
	return true
}

// A task has one sequential writer and an admission reservation. Account every
// byte before writing raw data, ZIP or metadata, rather than checking afterwards.
type logExportWriter struct {
	run       *logExportRun
	writer    io.Writer
	remaining *int64
}

func (run *logExportRun) logWriter(writer io.Writer, remaining *int64) io.Writer {
	return &logExportWriter{run: run, writer: writer, remaining: remaining}
}
func (w *logExportWriter) Write(data []byte) (int, error) {
	if err := w.run.ctx.Err(); err != nil {
		return 0, err
	}
	size := int64(len(data))
	if size > w.run.areaRemaining || w.remaining != nil && size > *w.remaining {
		return 0, dockerengine.ErrStreamLimit
	}
	n, err := w.writer.Write(data)
	w.run.areaRemaining -= int64(n)
	if w.remaining != nil {
		*w.remaining -= int64(n)
	}
	return n, err
}
