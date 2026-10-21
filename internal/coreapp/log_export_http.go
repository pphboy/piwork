package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corelogs"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/safefs"
)

const (
	logExportAreaLimit   = int64(4 << 30)
	logExportFreeReserve = int64(512 << 20)
)

type logExportLimits struct {
	sourceCount    int
	perSourceBytes int64
	totalBytes     int64
	totalBudget    time.Duration
	perSourceTime  time.Duration
	readyTTL       time.Duration
	areaLimit      int64
	freeReserve    int64
	archivePerWork int64
	archiveInstall int64
	zipBytes       int64
}

func defaultLogExportLimits() *logExportLimits {
	return &logExportLimits{
		sourceCount: 4096, perSourceBytes: logExportPerSourceBytes, totalBytes: logExportTotalBytes,
		totalBudget: logExportTotalBudget, perSourceTime: logExportPerSourceTime, readyTTL: logExportReadyTTL,
		areaLimit: logExportAreaLimit, freeReserve: logExportFreeReserve,
		archivePerWork: logArchivePerWorkBytes, archiveInstall: logArchiveInstallBytes, zipBytes: 1 << 30,
	}
}

func (a *Application) logLimits() *logExportLimits {
	if a.logLimitsForTest != nil {
		return a.logLimitsForTest
	}
	return defaultLogExportLimits()
}

func (a *Application) logExportHTTP(w http.ResponseWriter, r *http.Request, session identity.Session, token string) (bool, error) {
	path := r.URL.Path
	if path != "/api/v1/log-exports" && !strings.HasPrefix(path, "/api/v1/log-exports/") {
		return false, nil
	}
	// Role admission happens before body parsing, source enumeration or staging
	// allocation. Ordinary users never learn whether an ID exists.
	if session.User.Role != "admin" {
		return true, contracts.NewError("PERMISSION_DENIED", "")
	}
	if path == "/api/v1/log-exports" {
		if r.Method != http.MethodPost {
			w.Header().Set("Allow", "POST")
			return true, contracts.NewError("METHOD_NOT_ALLOWED", "")
		}
		return true, a.createLogExport(w, r, session)
	}
	relative := strings.TrimPrefix(path, "/api/v1/log-exports/")
	parts := strings.Split(relative, "/")
	if len(parts) == 0 || parts[0] == "" || len(parts) > 2 {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if len(parts) == 2 {
		if parts[1] != "content" {
			return true, contracts.NewError("NOT_FOUND", "")
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", "GET")
			return true, contracts.NewError("METHOD_NOT_ALLOWED", "")
		}
		return true, a.downloadLogExport(w, r, session, token, parts[0])
	}
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", "GET")
		return true, contracts.NewError("METHOD_NOT_ALLOWED", "")
	}
	task, found, err := a.Store.LogExportTask(r.Context(), parts[0])
	if err != nil {
		return true, projectLogExportError(err)
	}
	if !found {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if task.OwnerUserID != string(session.User.ID) {
		return true, contracts.NewError("PERMISSION_DENIED", "")
	}
	send(w, 200, logExportView(task))
	return true, nil
}

func (a *Application) createLogExport(w http.ResponseWriter, r *http.Request, session identity.Session) error {
	input, err := readControlJSON[contracts.LogExportCreateInput](r, "LogExportCreateInputSchema", true)
	if err != nil {
		return err
	}
	if input.IdempotencyKey == "" {
		return contracts.NewError("INVALID_REQUEST", "idempotencyKey")
	}
	ctx := r.Context()
	owner := string(session.User.ID)
	a.logDownloadMu.Lock()
	defer a.logDownloadMu.Unlock()
	now := time.Now().UTC()
	exportID, ok := corestore.NewLogObjectID("export")
	if !ok {
		return contracts.NewError("INTERNAL_ERROR", "")
	}
	if idempotencyKey, ok := corestore.LogIdempotencyKey(owner, input.IdempotencyKey); ok {
		if mapping, found, readErr := corestore.GetLogRecord[corestore.LogIdempotency](ctx, a.Store, idempotencyKey); readErr != nil {
			return projectLogExportError(readErr)
		} else if found {
			existing, found, readErr := a.Store.LogExportTask(ctx, mapping.ExportID)
			if readErr != nil || !found || existing.OwnerUserID != owner {
				return projectLogExportError(corestore.ErrStorage)
			}
			sendLogExportAccepted(w, existing, true)
			return nil
		}
	}
	var boundary *corelogs.Boundary
	if a.logs != nil {
		boundary, err = a.logs.Boundary()
		if err == nil {
			now = boundary.Cutoff
		}
	}
	defer func() {
		if boundary != nil {
			boundary.Release()
		}
	}()
	scope, items, err := a.logExportScope(ctx, owner, exportID, now)
	if err != nil {
		return projectLogExportError(err)
	}
	task, reused, err := a.Store.AcceptLogExport(ctx, corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: owner, CorrelationID: string(requestCorrelation()),
		CutoffTime: now.Format(time.RFC3339Nano), IdempotencyKey: input.IdempotencyKey,
		Scope: scope, CreatedAt: now.Format(time.RFC3339Nano), Sources: items, Capacity: a.checkLogExportCapacity,
	})
	if err != nil {
		return projectLogExportError(err)
	}
	if !reused {
		if a.logBoundaries == nil {
			a.logBoundaries = map[string]*corelogs.Boundary{}
		}
		a.logBoundaries[task.ExportID] = boundary
		boundary = nil
		a.startLogExportWorker(task.ExportID)
	}
	sendLogExportAccepted(w, task, reused)
	return nil
}

func sendLogExportAccepted(w http.ResponseWriter, task corestore.LogExportTask, reused bool) {
	send(w, 202, contracts.LogExportAccepted{
		ExportId: contracts.ResourceId(task.ExportID), CorrelationId: contracts.Identifier(task.CorrelationID),
		CutoffTime: contracts.Timestamp(task.CutoffTime), State: contracts.LogExportState(task.State),
		Scope:  contracts.LogExportScope{IncludeCoreLogs: task.Scope.IncludeCoreLogs, OwnedWorkCount: task.Scope.OwnedWorkCount, SourceCount: task.Scope.SourceCount},
		Reused: reused,
	})
}

// logExportScope freezes the owner's eligible sources at T. Deleted Works keep
// their already registered sources and original owner.
func (a *Application) logExportScope(ctx context.Context, owner, exportID string, cutoff time.Time) (corestore.LogScope, []corestore.LogTaskSource, error) {
	var ownedWorkCount int64
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT count(*) FROM works WHERE owner_user_id=?`, owner).Scan(&ownedWorkCount)
	}); err != nil {
		return corestore.LogScope{}, nil, err
	}
	sources, err := a.Store.LogSources(ctx)
	if err != nil {
		return corestore.LogScope{}, nil, err
	}
	eligible := make([]corestore.LogSource, 0, len(sources))
	for _, source := range sources {
		if source.OwnerUserID != owner {
			continue
		}
		created, err := time.Parse(time.RFC3339Nano, source.CreatedAt)
		if err != nil || created.After(cutoff) {
			continue
		}
		eligible = append(eligible, source)
	}
	if len(eligible) > a.logLimits().sourceCount {
		return corestore.LogScope{}, nil, contracts.NewError("LOG_EXPORT_SOURCE_LIMIT", "")
	}
	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].WorkID != eligible[j].WorkID {
			return eligible[i].WorkID < eligible[j].WorkID
		}
		if eligible[i].CreatedAt != eligible[j].CreatedAt {
			return eligible[i].CreatedAt > eligible[j].CreatedAt
		}
		return eligible[i].SourceID < eligible[j].SourceID
	})
	items := make([]corestore.LogTaskSource, 0, len(eligible))
	for index, source := range eligible {
		items = append(items, corestore.LogTaskSource{
			Version: 1, ExportID: exportID, SourceID: source.SourceID, Sequence: int64(index), OwnerUserID: owner,
			WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending",
		})
	}
	return corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: ownedWorkCount, SourceCount: int64(len(items))}, items, nil
}

func logExportAreaUsed(directory string) (int64, bool) {
	root := filepath.Join(directory, "runtime", "log-exports")
	used := int64(0)
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.Type().IsRegular() {
			if info, err := entry.Info(); err == nil {
				used += info.Size()
			}
		}
		return nil
	}); err != nil && !errors.Is(err, os.ErrNotExist) {
		return 0, false
	}
	return used, true
}

func (a *Application) checkLogExportCapacity() error {
	if a.Store == nil {
		return contracts.NewError("LOG_EXPORT_STORAGE_UNAVAILABLE", "")
	}
	used, ok := logExportAreaUsed(a.options.DataDirectory)
	if !ok {
		return contracts.NewError("LOG_EXPORT_STORAGE_UNAVAILABLE", "")
	}
	// Only one task can collect/pack: reserve its raw, ZIP and bounded metadata
	// space at admission without evicting any unexpired ready result.
	reserve := a.logLimits().totalBytes + a.logLimits().zipBytes + (4 << 20)
	if used > a.logLimits().areaLimit || reserve > a.logLimits().areaLimit-used {
		return contracts.NewError("LOG_EXPORT_STORAGE_UNAVAILABLE", "")
	}
	var stat unix.Statfs_t
	if unix.Statfs(a.options.DataDirectory, &stat) != nil {
		return contracts.NewError("LOG_EXPORT_STORAGE_UNAVAILABLE", "")
	}
	available := int64(stat.Bavail) * int64(stat.Bsize)
	if available < a.logLimits().freeReserve || reserve > available-a.logLimits().freeReserve {
		return contracts.NewError("LOG_EXPORT_STORAGE_UNAVAILABLE", "")
	}
	return nil
}

func logExportView(task corestore.LogExportTask) contracts.LogExportView {
	complete := json.RawMessage("null")
	if task.Complete != nil {
		complete, _ = json.Marshal(*task.Complete)
	}
	var result json.RawMessage = json.RawMessage("null")
	if task.State == "ready" && task.Result != nil {
		raw, _ := json.Marshal(contracts.LogExportResult{
			Filename: task.Result.Filename, Size: task.Result.Size, Digest: contracts.WorkBlobDigest(task.Result.Digest),
			ReadyAt: contracts.Timestamp(task.Result.ReadyAt), ExpiresAt: contracts.Timestamp(task.Result.ExpiresAt),
		})
		result = raw
	}
	var taskError json.RawMessage = json.RawMessage("null")
	if task.Error != nil {
		view := contracts.LogExportTaskError{Code: task.Error.Code, Message: task.Error.Message, CorrelationId: contracts.Identifier(task.Error.CorrelationID)}
		if task.Error.RetryAfterMs > 0 {
			view.RetryAfterMs = contracts.Supplied(task.Error.RetryAfterMs)
		}
		raw, _ := json.Marshal(view)
		taskError = raw
	}
	warnings := make([]contracts.LogExportWarning, 0, len(task.Warnings))
	for _, warning := range task.Warnings {
		warnings = append(warnings, contracts.LogExportWarning{Code: warning.Code, Message: warning.Message})
	}
	return contracts.LogExportView{
		ExportId: contracts.ResourceId(task.ExportID), CorrelationId: contracts.Identifier(task.CorrelationID),
		CutoffTime: contracts.Timestamp(task.CutoffTime), State: contracts.LogExportState(task.State),
		Scope:     contracts.LogExportScope{IncludeCoreLogs: task.Scope.IncludeCoreLogs, OwnedWorkCount: task.Scope.OwnedWorkCount, SourceCount: task.Scope.SourceCount},
		CreatedAt: contracts.Timestamp(task.CreatedAt), UpdatedAt: contracts.Timestamp(task.UpdatedAt),
		Progress: contracts.LogExportProgress{ProcessedSources: task.Progress.ProcessedSources, TotalSources: task.Progress.TotalSources, CollectedBytes: task.Progress.CollectedBytes},
		Complete: complete, WarningCount: task.WarningCount, Warnings: warnings, WarningsTruncated: task.WarningsTruncated,
		Result: result, Error: taskError, CleanupPending: task.CleanupPending,
	}
}

func projectLogExportError(err error) error {
	var repository *corestore.RepositoryError
	if errors.As(err, &repository) {
		switch repository.Code() {
		case "LOG_EXPORT_BUSY", "LOG_EXPORT_SOURCE_LIMIT", "LOG_EXPORT_RECORD_CONFLICT", "LOG_EXPORT_NOT_READY", "LOG_EXPORT_EXPIRED", "LOG_EXPORT_STORAGE_UNAVAILABLE":
			return contracts.NewError(repository.Code(), "")
		}
	}
	if errors.Is(err, corestore.ErrNotFound) {
		return contracts.NewError("NOT_FOUND", "")
	}
	if errors.Is(err, corestore.ErrStorage) {
		return contracts.NewError("LOG_EXPORT_STORAGE_UNAVAILABLE", "")
	}
	return err
}

// downloadLogExport serves an immutable ready archive with integrity metadata.
// Its bounded lease covers integrity verification and transmission; current
// identity and role are checked throughout both stages.
func (a *Application) downloadLogExport(w http.ResponseWriter, r *http.Request, session identity.Session, token, exportID string) error {
	owner := string(session.User.ID)
	// The same short mutex protects admission and GC. Pin before opening or hashing.
	a.logDownloadMu.Lock()
	task, found, err := a.Store.LogExportTask(r.Context(), exportID)
	if err == nil {
		switch {
		case !found:
			err = contracts.NewError("NOT_FOUND", "")
		case task.OwnerUserID != owner:
			err = contracts.NewError("PERMISSION_DENIED", "")
		case task.State == "expired":
			err = contracts.NewError("LOG_EXPORT_EXPIRED", "")
		case task.State != "ready" || task.Result == nil:
			err = contracts.NewError("LOG_EXPORT_NOT_READY", "")
		default:
			expires, parseErr := time.Parse(time.RFC3339Nano, task.Result.ExpiresAt)
			if parseErr != nil || !time.Now().Before(expires) {
				err = contracts.NewError("LOG_EXPORT_EXPIRED", "")
			} else if !a.acquireLogDownloadLocked(owner, exportID) {
				err = contracts.NewError("LOG_EXPORT_BUSY", "")
			}
		}
	}
	a.logDownloadMu.Unlock()
	if err != nil {
		return projectLogExportError(err)
	}
	defer a.releaseLogDownload(owner, exportID)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Minute)
	defer cancel()
	controller := http.NewResponseController(w)
	var deadlineMu sync.Mutex
	sending := false
	stopAuth := make(chan struct{})
	authDone := make(chan struct{})
	go func() {
		defer close(authDone)
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-stopAuth:
				return
			case <-ctx.Done():
				deadlineMu.Lock()
				if sending {
					_ = controller.SetWriteDeadline(time.Now())
				}
				deadlineMu.Unlock()
				return
			case <-ticker.C:
				if !a.reauthorizeLogDownload(ctx, token, owner, exportID) {
					cancel()
				}
			}
		}
	}()
	defer func() { close(stopAuth); <-authDone; cancel() }()
	if !a.reauthorizeLogDownload(ctx, token, owner, exportID) {
		return contracts.NewError("PERMISSION_DENIED", "")
	}
	unavailable := func() error {
		if ctx.Err() != nil {
			return contracts.NewError("PERMISSION_DENIED", "")
		}
		if err := a.failLogExportContent(exportID); err != nil {
			return projectLogExportError(err)
		}
		return contracts.NewError("LOG_EXPORT_CONTENT_UNAVAILABLE", "")
	}
	export, err := a.Store.OpenLogExportDir(exportID)
	if err != nil {
		return unavailable()
	}
	defer export.Close()
	file, err := export.OpenFile("bundle.zip", unix.O_RDONLY)
	if err != nil {
		return unavailable()
	}
	defer file.Close()
	if a.logVerifyForTest != nil {
		if err := a.logVerifyForTest(ctx); err != nil {
			return contracts.NewError("PERMISSION_DENIED", "")
		}
	}
	if err := a.verifySealedLogExport(ctx, export, file, task); err != nil {
		return unavailable()
	}
	if ctx.Err() != nil || !a.reauthorizeLogDownload(ctx, token, owner, exportID) {
		return contracts.NewError("PERMISSION_DENIED", "")
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", contentDisposition(task.Result.Filename))
	w.Header().Set("Content-Length", strconv.FormatInt(task.Result.Size, 10))
	w.Header().Set("X-Piwork-SHA256", task.Result.Digest)
	w.Header().Set("Cache-Control", "no-store")
	deadlineMu.Lock()
	if ctx.Err() != nil {
		deadlineMu.Unlock()
		return contracts.NewError("PERMISSION_DENIED", "")
	}
	sending = true
	deadlineMu.Unlock()
	w.WriteHeader(200)
	buffer := make([]byte, 64<<10)
	for {
		deadlineMu.Lock()
		if ctx.Err() != nil {
			deadlineMu.Unlock()
			return nil
		}
		_ = controller.SetWriteDeadline(time.Now().Add(60 * time.Second))
		deadlineMu.Unlock()
		n, readErr := file.Read(buffer)
		if n > 0 {
			if _, err := w.Write(buffer[:n]); err != nil {
				return nil
			}
			_ = controller.Flush()
		}
		if readErr != nil {
			return nil
		}
	}
}

// Persist the conclusion before reporting content failure. The seal record is
// retained as private evidence; a new GET/replay never recollects this ID.
func (a *Application) failLogExportContent(exportID string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(exportID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found {
			return corestore.ErrStorage
		}
		if task.State != "ready" && task.State != "collecting" && task.State != "packing" {
			return nil
		}
		task.State, task.Result = "failed", nil
		task.Error = &corestore.LogTaskError{Code: "LOG_EXPORT_CONTENT_UNAVAILABLE", Message: "The sealed export content is missing or corrupt", CorrelationID: task.CorrelationID}
		task.CleanupPending = true
		task.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		return corestore.PutLogRecordTx(tx, key, task)
	})
}

func (a *Application) acquireLogDownloadLocked(owner, exportID string) bool {
	if a.logDownloads >= 2 || a.logUserDownloads[owner] >= 1 {
		return false
	}
	a.logDownloads++
	if a.logUserDownloads == nil {
		a.logUserDownloads = map[string]int{}
	}
	if a.logExportsDownloading == nil {
		a.logExportsDownloading = map[string]int{}
	}
	a.logUserDownloads[owner]++
	a.logExportsDownloading[exportID]++
	return true
}

func (a *Application) releaseLogDownload(owner, exportID string) {
	a.logDownloadMu.Lock()
	defer a.logDownloadMu.Unlock()
	if a.logDownloads > 0 {
		a.logDownloads--
	}
	if a.logUserDownloads[owner] > 1 {
		a.logUserDownloads[owner]--
	} else {
		delete(a.logUserDownloads, owner)
	}
	if a.logExportsDownloading[exportID] > 1 {
		a.logExportsDownloading[exportID]--
	} else {
		delete(a.logExportsDownloading, exportID)
	}
}

// reauthorizeLogDownload bounds a single identity check to 750 ms each 500 ms.
// Revocation, disablement or role loss stops the stream within roughly 2 s.
func (a *Application) reauthorizeLogDownload(ctx context.Context, token, owner, exportID string) bool {
	check, cancel := context.WithTimeout(ctx, 750*time.Millisecond)
	defer cancel()
	session, err := a.Identity.Authenticate(check, token)
	if err != nil || session.User.Role != "admin" || string(session.User.ID) != owner {
		return false
	}
	task, found, err := a.Store.LogExportTask(check, exportID)
	return err == nil && found && task.OwnerUserID == owner
}

// verifySealedLogExport rejects a ready file whose sealed identity, length or
// digest no longer matches before any response bytes are sent.
func (a *Application) verifySealedLogExport(ctx context.Context, export *safefs.Root, file *os.File, task corestore.LogExportTask) error {
	resultKey, ok := corestore.LogResultKey(task.ExportID)
	if !ok {
		return corestore.ErrStorage
	}
	record, found, err := corestore.GetLogRecord[corestore.LogResultRecord](ctx, a.Store, resultKey)
	if err != nil || !found || record.ExportID != task.ExportID || record.OwnerUserID != task.OwnerUserID ||
		record.CutoffTime != task.CutoffTime || record.WorkerEpoch != task.WorkerEpoch || record.Filename != task.Result.Filename || record.Size != task.Result.Size || record.Digest != task.Result.Digest ||
		record.ReadyAt != task.Result.ReadyAt || record.ExpiresAt != task.Result.ExpiresAt {
		return corestore.ErrStorage
	}
	sealRaw, err := export.ReadFile("seal.json", 64<<10)
	if err != nil {
		return corestore.ErrStorage
	}
	var seal logSeal
	if json.Unmarshal(sealRaw, &seal) != nil || seal.ExportID != task.ExportID || seal.OwnerUserID != task.OwnerUserID ||
		seal.Version != 1 || seal.ReadyAt != task.Result.ReadyAt || seal.ManifestHash != record.ManifestHash || seal.CutoffTime != task.CutoffTime || seal.WorkerEpoch != task.WorkerEpoch || seal.Size != task.Result.Size ||
		seal.Digest != task.Result.Digest || seal.ExpiresAt != task.Result.ExpiresAt {
		return corestore.ErrStorage
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != task.Result.Size {
		return corestore.ErrStorage
	}
	hash := sha256.New()
	size, err := io.CopyBuffer(hash, io.LimitReader(logContextReader{ctx: ctx, reader: file}, task.Result.Size+1), make([]byte, 64<<10))
	if err != nil || size != task.Result.Size || hex.EncodeToString(hash.Sum(nil)) != task.Result.Digest {
		return corestore.ErrStorage
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return corestore.ErrStorage
	}
	return nil
}

func contentDisposition(filename string) string {
	name := strings.TrimSpace(filename)
	if name == "" || strings.ContainsAny(name, "\"/\\\x00\r\n") {
		name = "piwork-logs.zip"
	}
	return fmt.Sprintf("attachment; filename=%q", name)
}

// Regular files are read in bounded chunks; cancellation covers verification.
type logContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r logContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
