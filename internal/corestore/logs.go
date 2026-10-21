package corestore

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/safefs"
)

// Log export state is stored in compact versioned control_metadata records so
// the business schema and its version stay unchanged. Log bodies never enter
// SQLite; only identities, state and small bounded summaries do.
const logRecordVersion = 1

var (
	logObjectID    = regexp.MustCompile(`^log-[a-z]+-[a-f0-9]{32}$`)
	logRecordKey   = regexp.MustCompile(`^log_[a-z0-9_]{1,120}$`)
	logRecordScope = regexp.MustCompile(`^log_[a-z0-9_]{0,120}$`)
	logTempName    = regexp.MustCompile(`^(?:bundle\.zip\.part|seal-[a-f0-9]{32}\.tmp|publish-[a-f0-9]{32}\.tmp)$`)
	logStagingName = regexp.MustCompile(`^\.staging-[a-z0-9-]{1,80}$`)
)

type LogRecord interface {
	logRecordVersion() int
}

type LogScope struct {
	IncludeCoreLogs bool  `json:"includeCoreLogs"`
	OwnedWorkCount  int64 `json:"ownedWorkCount"`
	SourceCount     int64 `json:"sourceCount"`
}

func (v LogScope) logRecordVersion() int { return logRecordVersion }

type LogProgress struct {
	ProcessedSources int64 `json:"processedSources"`
	TotalSources     int64 `json:"totalSources"`
	CollectedBytes   int64 `json:"collectedBytes"`
}

func (v LogProgress) logRecordVersion() int { return logRecordVersion }

type LogWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (v LogWarning) logRecordVersion() int { return logRecordVersion }

type LogResult struct {
	Filename  string `json:"filename"`
	Size      int64  `json:"size"`
	Digest    string `json:"digest"`
	ReadyAt   string `json:"readyAt"`
	ExpiresAt string `json:"expiresAt"`
}

func (v LogResult) logRecordVersion() int { return logRecordVersion }

type LogTaskError struct {
	Code          string `json:"code"`
	Message       string `json:"message"`
	CorrelationID string `json:"correlationId"`
	RetryAfterMs  int64  `json:"retryAfterMs,omitempty"`
}

func (v LogTaskError) logRecordVersion() int { return logRecordVersion }

// LogExportTask is the authoritative task identity. OwnerUserID is immutable
// so a tombstoned Work's retained archive cannot be reassigned by account text.
type LogExportTask struct {
	Version           int           `json:"version"`
	ExportID          string        `json:"exportId"`
	OwnerUserID       string        `json:"ownerUserId"`
	CorrelationID     string        `json:"correlationId"`
	CutoffTime        string        `json:"cutoffTime"`
	State             string        `json:"state"`
	Scope             LogScope      `json:"scope"`
	CreatedAt         string        `json:"createdAt"`
	UpdatedAt         string        `json:"updatedAt"`
	WorkerEpoch       int64         `json:"workerEpoch"`
	Progress          LogProgress   `json:"progress"`
	Complete          *bool         `json:"complete"`
	WarningCount      int64         `json:"warningCount"`
	Warnings          []LogWarning  `json:"warnings"`
	WarningsTruncated bool          `json:"warningsTruncated"`
	Result            *LogResult    `json:"result"`
	Error             *LogTaskError `json:"error"`
	CleanupPending    bool          `json:"cleanupPending"`
}

func (v LogExportTask) logRecordVersion() int { return v.Version }

type LogIdempotency struct {
	Version     int    `json:"version"`
	OwnerUserID string `json:"ownerUserId"`
	ExportID    string `json:"exportId"`
	CreatedAt   string `json:"createdAt"`
}

func (v LogIdempotency) logRecordVersion() int { return v.Version }

// LogSource records the exact runtime instance that produced output. Binding is
// only valid after the Engine confirms the container identity; SourceID stays
// opaque to clients and manifests.
type LogSource struct {
	Version        int    `json:"version"`
	SourceID       string `json:"sourceId"`
	InstallationID string `json:"installationId"`
	OwnerUserID    string `json:"ownerUserId"`
	WorkID         string `json:"workId"`
	Kind           string `json:"kind"`
	ServiceID      string `json:"serviceId,omitempty"`
	Generation     int64  `json:"generation"`
	ConfigRevision int64  `json:"configRevision,omitempty"`
	InstanceID     string `json:"instanceId"`
	ContainerID    string `json:"containerId"`
	PolicyVersion  int64  `json:"policyVersion"`
	State          string `json:"state"`
	CreatedAt      string `json:"createdAt"`
	BoundAt        string `json:"boundAt,omitempty"`
	ArchivedAt     string `json:"archivedAt,omitempty"`
	Reason         string `json:"reason,omitempty"`
}

func (v LogSource) logRecordVersion() int { return v.Version }

// LogArchive is published only after the complete source directory is durable.
type LogArchive struct {
	Version      int    `json:"version"`
	SourceID     string `json:"sourceId"`
	State        string `json:"state"`
	StartTime    string `json:"startTime,omitempty"`
	EndTime      string `json:"endTime,omitempty"`
	StdoutBytes  int64  `json:"stdoutBytes"`
	StderrBytes  int64  `json:"stderrBytes"`
	StdoutDigest string `json:"stdoutDigest,omitempty"`
	StderrDigest string `json:"stderrDigest,omitempty"`
	PublishedAt  string `json:"publishedAt,omitempty"`
	Reason       string `json:"reason,omitempty"`
}

func (v LogArchive) logRecordVersion() int { return v.Version }

// LogTaskSource is one bounded per-task source summary. Sequence orders the
// stable manifest without embedding a full source array in the task record.
type LogTaskSource struct {
	Version     int      `json:"version"`
	ExportID    string   `json:"exportId"`
	SourceID    string   `json:"sourceId"`
	Sequence    int64    `json:"sequence"`
	OwnerUserID string   `json:"ownerUserId"`
	WorkID      string   `json:"workId"`
	Kind        string   `json:"kind"`
	ServiceID   string   `json:"serviceId,omitempty"`
	State       string   `json:"state"`
	Bytes       int64    `json:"bytes"`
	Entries     []string `json:"entries"`
	StartTime   string   `json:"startTime,omitempty"`
	EndTime     string   `json:"endTime,omitempty"`
	Reason      string   `json:"reason,omitempty"`
}

func (v LogTaskSource) logRecordVersion() int { return v.Version }

// LogResultRecord is the sealed delivery identity. A ready file may only be
// served when this record and seal.json agree on length, digest and expiry.
type LogResultRecord struct {
	Version      int    `json:"version"`
	ExportID     string `json:"exportId"`
	OwnerUserID  string `json:"ownerUserId"`
	WorkerEpoch  int64  `json:"workerEpoch"`
	CutoffTime   string `json:"cutoffTime"`
	Filename     string `json:"filename"`
	Size         int64  `json:"size"`
	Digest       string `json:"digest"`
	ReadyAt      string `json:"readyAt"`
	ExpiresAt    string `json:"expiresAt"`
	ManifestHash string `json:"manifestHash"`
}

func (v LogResultRecord) logRecordVersion() int { return v.Version }

func LogTaskKey(exportID string) (string, bool) {
	if !logObjectID.MatchString(exportID) {
		return "", false
	}
	return "log_task_" + strings.ReplaceAll(exportID, "-", ""), true
}

func LogIdempotencyKey(ownerUserID, idempotencyKey string) (string, bool) {
	if ownerUserID == "" || idempotencyKey == "" || len(idempotencyKey) > 256 {
		return "", false
	}
	owner := sha256.Sum256([]byte("owner\x00" + ownerUserID))
	key := sha256.Sum256([]byte("key\x00" + idempotencyKey))
	return "log_idem_" + hex.EncodeToString(owner[:8]) + "_" + hex.EncodeToString(key[:]), true
}

func LogSourceKey(sourceID string) (string, bool) {
	if !logObjectID.MatchString(sourceID) {
		return "", false
	}
	return "log_source_" + strings.ReplaceAll(sourceID, "-", ""), true
}

func LogArchiveKey(sourceID string) (string, bool) {
	if !logObjectID.MatchString(sourceID) {
		return "", false
	}
	return "log_archive_" + strings.ReplaceAll(sourceID, "-", ""), true
}

func LogTaskSourceKey(exportID string, sequence int64) (string, bool) {
	if !logObjectID.MatchString(exportID) || sequence < 0 || sequence > 99_999_999 {
		return "", false
	}
	return "log_item_" + strings.ReplaceAll(exportID, "-", "") + "_" + formatLogSequence(sequence), true
}

func LogResultKey(exportID string) (string, bool) {
	if !logObjectID.MatchString(exportID) {
		return "", false
	}
	return "log_result_" + strings.ReplaceAll(exportID, "-", ""), true
}

func formatLogSequence(sequence int64) string {
	return fmt.Sprintf("%08d", sequence)
}

func marshalLogRecord(value LogRecord) ([]byte, error) {
	if value == nil || value.logRecordVersion() != logRecordVersion {
		return nil, ErrStorage
	}
	data, err := json.Marshal(value)
	if err != nil || len(data) > 2<<20 {
		return nil, ErrStorage
	}
	return data, nil
}

func decodeLogRecord(data []byte, target LogRecord) error {
	if _, err := contracts.ParseJSON(strings.NewReader(string(data)), 2<<20); err != nil {
		return ErrStorage
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return ErrStorage
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return ErrStorage
	}
	if target.logRecordVersion() != logRecordVersion {
		return ErrStorage
	}
	return nil
}

func checkLogRecordKey(key string) error {
	if !logRecordKey.MatchString(key) {
		return ErrStorage
	}
	return nil
}

func PutLogRecordTx(tx *sql.Tx, key string, value LogRecord) error {
	if err := checkLogRecordKey(key); err != nil {
		return err
	}
	data, err := marshalLogRecord(value)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, key, string(data), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

func GetLogRecordTx[T LogRecord](tx *sql.Tx, key string) (T, bool, error) {
	var target T
	if err := checkLogRecordKey(key); err != nil {
		return target, false, err
	}
	var raw string
	err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key=?`, key).Scan(&raw)
	if err == sql.ErrNoRows {
		return target, false, nil
	}
	if err != nil {
		return target, false, err
	}
	if err := decodeLogRecord([]byte(raw), any(&target).(LogRecord)); err != nil {
		return target, false, err
	}
	return target, true, nil
}

func DeleteLogRecordTx(tx *sql.Tx, key string) error {
	if err := checkLogRecordKey(key); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, key)
	return err
}

func (s *Store) PutLogRecord(ctx context.Context, key string, value LogRecord) error {
	return s.Write(ctx, func(tx *sql.Tx) error { return PutLogRecordTx(tx, key, value) })
}

func GetLogRecord[T LogRecord](ctx context.Context, s *Store, key string) (T, bool, error) {
	var target T
	var found bool
	err := s.Read(ctx, func(tx *sql.Tx) error {
		value, ok, err := GetLogRecordTx[T](tx, key)
		if err != nil {
			return err
		}
		target, found = value, ok
		return nil
	})
	return target, found, err
}

func (s *Store) ListLogRecordKeys(ctx context.Context, prefix string) ([]string, error) {
	if !logRecordScope.MatchString(prefix) {
		return nil, ErrStorage
	}
	keys := []string{}
	err := s.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT key FROM control_metadata WHERE key>=? AND key<? ORDER BY key`, prefix, prefix+"\xff")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				return err
			}
			keys = append(keys, key)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return keys, nil
}

func (s *Store) OpenLogsRoot() (*safefs.Root, error) {
	if err := s.root.EnsureDirectory("logs"); err != nil {
		return nil, ErrStorage
	}
	return s.root.OpenPrivateDirectory("logs")
}

func (s *Store) OpenCoreLogDir() (*safefs.Root, error) {
	logs, err := s.OpenLogsRoot()
	if err != nil {
		return nil, err
	}
	defer logs.Close()
	if err := logs.EnsureDirectory("core"); err != nil {
		return nil, ErrStorage
	}
	return logs.OpenPrivateDirectory("core")
}

func (s *Store) OpenWorkLogsRoot() (*safefs.Root, error) {
	logs, err := s.OpenLogsRoot()
	if err != nil {
		return nil, err
	}
	defer logs.Close()
	if err := logs.EnsureDirectory("works"); err != nil {
		return nil, ErrStorage
	}
	return logs.OpenPrivateDirectory("works")
}

func (s *Store) OpenWorkLogsDir(workID string) (*safefs.Root, error) {
	if !identityPattern.MatchString(workID) {
		return nil, ErrStorage
	}
	works, err := s.OpenWorkLogsRoot()
	if err != nil {
		return nil, err
	}
	defer works.Close()
	if err := works.EnsureDirectory(workID); err != nil {
		return nil, ErrStorage
	}
	return works.OpenPrivateDirectory(workID)
}

func (s *Store) OpenLogSourceDir(workID, sourceID string) (*safefs.Root, error) {
	if !logObjectID.MatchString(sourceID) {
		return nil, ErrStorage
	}
	work, err := s.OpenWorkLogsDir(workID)
	if err != nil {
		return nil, err
	}
	defer work.Close()
	if err := work.EnsureDirectory(sourceID); err != nil {
		return nil, ErrStorage
	}
	return work.OpenPrivateDirectory(sourceID)
}

func (s *Store) OpenLogExportsRoot() (*safefs.Root, error) {
	runtimeDir, err := s.root.OpenPrivateDirectory("runtime")
	if err != nil {
		return nil, ErrStorage
	}
	defer runtimeDir.Close()
	if err := runtimeDir.EnsureDirectory("log-exports"); err != nil {
		return nil, ErrStorage
	}
	return runtimeDir.OpenPrivateDirectory("log-exports")
}

func (s *Store) OpenLogExportDir(exportID string) (*safefs.Root, error) {
	if !logObjectID.MatchString(exportID) {
		return nil, ErrStorage
	}
	area, err := s.OpenLogExportsRoot()
	if err != nil {
		return nil, err
	}
	defer area.Close()
	if err := area.EnsureDirectory(exportID); err != nil {
		return nil, ErrStorage
	}
	return area.OpenPrivateDirectory(exportID)
}

// RecoverLogStorage removes only this feature's unfinished staging names. It
// must run while the installation lock is held and before any new task starts;
// a complete published archive/result is never modified.
func (s *Store) RecoverLogStorage() error {
	works, err := s.OpenWorkLogsRoot()
	if err != nil {
		return err
	}
	defer works.Close()
	workNames, err := works.Entries()
	if err != nil {
		return ErrStorage
	}
	for _, workName := range workNames {
		if !identityPattern.MatchString(workName) || works.CheckEntry(workName, true) != nil {
			return ErrStorage
		}
		work, err := works.OpenPrivateDirectory(workName)
		if err != nil {
			return ErrStorage
		}
		names, err := work.Entries()
		if err != nil {
			work.Close()
			return ErrStorage
		}
		for _, name := range names {
			switch {
			case logStagingName.MatchString(name):
				if work.CheckEntry(name, true) == nil {
					err = work.RemoveTree(name)
				} else if work.CheckEntry(name, false) == nil {
					err = work.Remove(name)
				} else {
					err = safefs.ErrUnsafePath
				}
				if err != nil {
					work.Close()
					return ErrStorage
				}
			case logObjectID.MatchString(name):
				if work.CheckEntry(name, true) != nil {
					work.Close()
					return ErrStorage
				}
			default:
				work.Close()
				return ErrStorage
			}
		}
		work.Close()
	}
	exports, err := s.OpenLogExportsRoot()
	if err != nil {
		return err
	}
	defer exports.Close()
	exportNames, err := exports.Entries()
	if err != nil {
		return ErrStorage
	}
	for _, exportName := range exportNames {
		if !logObjectID.MatchString(exportName) || exports.CheckEntry(exportName, true) != nil {
			return ErrStorage
		}
		export, err := exports.OpenPrivateDirectory(exportName)
		if err != nil {
			return ErrStorage
		}
		names, err := export.Entries()
		if err != nil {
			export.Close()
			return ErrStorage
		}
		for _, name := range names {
			if !logTempName.MatchString(name) {
				continue
			}
			if export.CheckEntry(name, false) != nil {
				export.Close()
				return ErrStorage
			}
			if err := export.Remove(name); err != nil {
				export.Close()
				return ErrStorage
			}
		}
		export.Close()
	}
	return nil
}

// OpenLogSourceStaging creates or replaces the private staging directory for a
// source archive. Publication uses an atomic no-replace directory rename.
func (s *Store) OpenLogSourceStaging(workID, sourceID string) (*safefs.Root, error) {
	if !logObjectID.MatchString(sourceID) {
		return nil, ErrStorage
	}
	work, err := s.OpenWorkLogsDir(workID)
	if err != nil {
		return nil, err
	}
	defer work.Close()
	name := ".staging-" + sourceID
	if work.CheckEntry(name, true) == nil {
		if err := work.RemoveTree(name); err != nil {
			return nil, ErrStorage
		}
	} else if work.CheckEntry(name, false) == nil {
		if err := work.Remove(name); err != nil {
			return nil, ErrStorage
		}
	}
	if err := work.EnsureDirectory(name); err != nil {
		return nil, ErrStorage
	}
	return work.OpenPrivateDirectory(name)
}

func (s *Store) RemoveLogSourceStaging(workID, sourceID string) error {
	if !logObjectID.MatchString(sourceID) {
		return ErrStorage
	}
	work, err := s.OpenWorkLogsDir(workID)
	if err != nil {
		return err
	}
	defer work.Close()
	name := ".staging-" + sourceID
	if work.CheckEntry(name, true) == nil {
		return work.RemoveTree(name)
	}
	if work.CheckEntry(name, false) == nil {
		return work.Remove(name)
	}
	return nil
}

// PublishLogSourceStaging publishes a complete directory without replacing an
// existing archive. The parent directory is synced by RenameNoReplace.
func (s *Store) PublishLogSourceStaging(workID, sourceID string) error {
	if !logObjectID.MatchString(sourceID) {
		return ErrStorage
	}
	work, err := s.OpenWorkLogsDir(workID)
	if err != nil {
		return err
	}
	defer work.Close()
	name := ".staging-" + sourceID
	if work.CheckEntry(name, true) != nil {
		return ErrStorage
	}
	if work.CheckEntry(sourceID, true) == nil {
		return ErrStorage
	}
	if err := work.RenameNoReplace(name, sourceID); err != nil {
		return ErrStorage
	}
	return nil
}

// RecordLogArchive commits the archive result and the source state in one
// transaction. Publication must already be durable; a failed commit leaves the
// directory visible only for recovery verification, never as archived.
func (s *Store) RecordLogArchive(ctx context.Context, sourceID string, archive LogArchive, state, at string) error {
	if !logObjectID.MatchString(sourceID) || archive.SourceID != sourceID || archive.Version != logRecordVersion {
		return ErrStorage
	}
	switch state {
	case "archived", "partial", "failed", "missing", "expired":
	default:
		return ErrStorage
	}
	sourceKey, _ := LogSourceKey(sourceID)
	archiveKey, _ := LogArchiveKey(sourceID)
	return s.Write(ctx, func(tx *sql.Tx) error {
		source, found, err := GetLogRecordTx[LogSource](tx, sourceKey)
		if err != nil {
			return err
		}
		if !found || source.InstallationID != s.installationID {
			return ErrNotFound
		}
		archive.State = state
		if err := PutLogRecordTx(tx, archiveKey, archive); err != nil {
			return err
		}
		source.State = state
		if state == "archived" || state == "partial" {
			source.ArchivedAt = at
		}
		if archive.Reason != "" {
			source.Reason = archive.Reason
		}
		return PutLogRecordTx(tx, sourceKey, source)
	})
}

func (s *Store) OpenExistingLogSourceDir(workID, sourceID string) (*safefs.Root, bool, error) {
	if !logObjectID.MatchString(sourceID) {
		return nil, false, ErrStorage
	}
	work, err := s.OpenWorkLogsDir(workID)
	if err != nil {
		return nil, false, err
	}
	defer work.Close()
	if work.CheckEntry(sourceID, true) != nil {
		return nil, false, nil
	}
	root, err := work.OpenPrivateDirectory(sourceID)
	if err != nil {
		return nil, false, ErrStorage
	}
	return root, true, nil
}

func (s *Store) LogSources(ctx context.Context) ([]LogSource, error) {
	keys, err := s.ListLogRecordKeys(ctx, "log_source_")
	if err != nil {
		return nil, err
	}
	sources := make([]LogSource, 0, len(keys))
	for _, key := range keys {
		source, found, err := GetLogRecord[LogSource](ctx, s, key)
		if err != nil {
			return nil, err
		}
		if found {
			sources = append(sources, source)
		}
	}
	return sources, nil
}

func (s *Store) LogTaskSources(ctx context.Context, exportID string) ([]LogTaskSource, error) {
	if !logObjectID.MatchString(exportID) {
		return nil, ErrStorage
	}
	prefix := "log_item_" + strings.ReplaceAll(exportID, "-", "") + "_"
	keys, err := s.ListLogRecordKeys(ctx, prefix)
	if err != nil {
		return nil, err
	}
	items := make([]LogTaskSource, 0, len(keys))
	for _, key := range keys {
		item, found, err := GetLogRecord[LogTaskSource](ctx, s, key)
		if err != nil {
			return nil, err
		}
		if found {
			items = append(items, item)
		}
	}
	return items, nil
}

func (s *Store) RemoveLogExportDir(exportID string) error {
	if !logObjectID.MatchString(exportID) {
		return ErrStorage
	}
	area, err := s.OpenLogExportsRoot()
	if err != nil {
		return err
	}
	defer area.Close()
	entries, err := area.Entries()
	if err != nil {
		return err
	}
	for _, name := range entries {
		if name == exportID {
			if err := area.CheckEntry(exportID, true); err != nil {
				return ErrStorage
			}
			return area.RemoveTree(exportID)
		}
	}
	return nil
}

func (s *Store) OpenLogExportSourcesDir(exportID string) (*safefs.Root, error) {
	export, err := s.OpenLogExportDir(exportID)
	if err != nil {
		return nil, err
	}
	defer export.Close()
	if err := export.EnsureDirectory("sources"); err != nil {
		return nil, ErrStorage
	}
	return export.OpenPrivateDirectory("sources")
}

func (s *Store) LogExportTasks(ctx context.Context) ([]LogExportTask, error) {
	keys, err := s.ListLogRecordKeys(ctx, "log_task_")
	if err != nil {
		return nil, err
	}
	tasks := make([]LogExportTask, 0, len(keys))
	for _, key := range keys {
		task, found, err := GetLogRecord[LogExportTask](ctx, s, key)
		if err != nil {
			return nil, err
		}
		if found {
			tasks = append(tasks, task)
		}
	}
	return tasks, nil
}
