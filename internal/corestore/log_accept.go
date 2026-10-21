package corestore

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"path"
	"strconv"
	"strings"
	"time"
)

// NewLogObjectID returns an opaque low-entropy-free identity for an export,
// source or reference. The fixed prefix keeps control_metadata keys inside the
// existing [a-z][a-z0-9_]{0,127} namespace after hyphens are removed.
func NewLogObjectID(kind string) (string, bool) {
	if kind == "" || len(kind) > 16 {
		return "", false
	}
	for _, r := range kind {
		if r < 'a' || r > 'z' {
			return "", false
		}
	}
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		return "", false
	}
	return "log-" + kind + "-" + hex.EncodeToString(data[:]), true
}

type LogSourceRegistration struct {
	SourceID       string
	OwnerUserID    string
	WorkID         string
	Kind           string
	ServiceID      string
	Generation     int64
	ConfigRevision int64
	InstanceID     string
	PolicyVersion  int64
	CreatedAt      string
}

func validLogSourceKind(kind, serviceID string) bool {
	switch kind {
	case "agent":
		return serviceID == ""
	case "service":
		return serviceID != ""
	default:
		return false
	}
}

func validLogTime(value string) bool {
	_, err := time.Parse(time.RFC3339Nano, value)
	return err == nil
}

// RegisterLogSource persists ownership and the intended instance before the
// container can emit output. Re-registering the same identity is idempotent;
// any differing immutable field is a conflict. Deleted Works may not gain new
// sources, but their already registered sources keep their original owner.
func (s *Store) RegisterLogSource(ctx context.Context, register LogSourceRegistration) (LogSource, error) {
	var result LogSource
	if !logObjectID.MatchString(register.SourceID) || register.OwnerUserID == "" || !identityPattern.MatchString(register.WorkID) ||
		!validLogSourceKind(register.Kind, register.ServiceID) || register.Generation < 0 || register.PolicyVersion < 0 ||
		register.InstanceID == "" || len(register.InstanceID) > 128 || !validLogTime(register.CreatedAt) {
		return result, ErrStorage
	}
	err := s.Write(ctx, func(tx *sql.Tx) error {
		work, err := ReadWork(tx, register.WorkID, false)
		if err != nil {
			return err
		}
		if work.OwnerUserID != register.OwnerUserID {
			return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
		}
		key, _ := LogSourceKey(register.SourceID)
		if existing, found, err := GetLogRecordTx[LogSource](tx, key); err != nil {
			return err
		} else if found {
			if existing.InstallationID != s.installationID || existing.OwnerUserID != register.OwnerUserID ||
				existing.WorkID != register.WorkID || existing.Kind != register.Kind || existing.ServiceID != register.ServiceID ||
				existing.Generation != register.Generation || existing.ConfigRevision != register.ConfigRevision || existing.InstanceID != register.InstanceID {
				return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
			}
			result = existing
			return nil
		}
		result = LogSource{
			Version: logRecordVersion, SourceID: register.SourceID, InstallationID: s.installationID,
			OwnerUserID: register.OwnerUserID, WorkID: register.WorkID, Kind: register.Kind, ServiceID: register.ServiceID,
			Generation: register.Generation, ConfigRevision: register.ConfigRevision, InstanceID: register.InstanceID, PolicyVersion: register.PolicyVersion,
			State: "registered", CreatedAt: register.CreatedAt,
		}
		return PutLogRecordTx(tx, key, result)
	})
	return result, err
}

// BindLogSource attaches the Engine-confirmed container. A different container
// for the same registered identity is never accepted; the old record is kept
// as a gap rather than being overwritten by a same-name replacement.
func (s *Store) BindLogSource(ctx context.Context, sourceID, containerID string, policyVersion int64, boundAt string) (LogSource, error) {
	var result LogSource
	if !logObjectID.MatchString(sourceID) || containerID == "" || len(containerID) > 128 || policyVersion < 0 || !validLogTime(boundAt) {
		return result, ErrStorage
	}
	err := s.Write(ctx, func(tx *sql.Tx) error {
		key, _ := LogSourceKey(sourceID)
		source, found, err := GetLogRecordTx[LogSource](tx, key)
		if err != nil {
			return err
		}
		if !found || source.InstallationID != s.installationID {
			return ErrNotFound
		}
		if source.State == "bound" && source.ContainerID == containerID && source.PolicyVersion == policyVersion {
			result = source
			return nil
		}
		if source.State != "registered" {
			return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
		}
		source.State, source.ContainerID, source.PolicyVersion, source.BoundAt = "bound", containerID, policyVersion, boundAt
		if err := PutLogRecordTx(tx, key, source); err != nil {
			return err
		}
		result = source
		return nil
	})
	return result, err
}

func logTaskBusyTx(tx *sql.Tx) (bool, error) {
	rows, err := tx.Query(`SELECT value_json FROM control_metadata WHERE key>=? AND key<?`, "log_task_", "log_task_\xff")
	if err != nil {
		return false, err
	}
	defer rows.Close()
	busy := false
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			return false, err
		}
		var task LogExportTask
		if decodeLogRecord([]byte(raw), &task) != nil {
			return false, ErrStorage
		}
		if task.State == "collecting" || task.State == "packing" {
			busy = true
		}
	}
	return busy, rows.Err()
}

func (s *Store) LogSource(ctx context.Context, sourceID string) (LogSource, bool, error) {
	key, ok := LogSourceKey(sourceID)
	if !ok {
		return LogSource{}, false, ErrStorage
	}
	return GetLogRecord[LogSource](ctx, s, key)
}

func (s *Store) LogExportTask(ctx context.Context, exportID string) (LogExportTask, bool, error) {
	key, ok := LogTaskKey(exportID)
	if !ok {
		return LogExportTask{}, false, ErrStorage
	}
	return GetLogRecord[LogExportTask](ctx, s, key)
}

type LogExportAcceptRequest struct {
	ExportID       string
	OwnerUserID    string
	CorrelationID  string
	CutoffTime     string
	IdempotencyKey string
	Scope          LogScope
	CreatedAt      string
	Sources        []LogTaskSource
	// Capacity is evaluated after idempotency replay and the single-task gate,
	// so an existing result remains replayable when new-task capacity fails.
	Capacity func() error
}

func validLogEntryName(entry string) bool {
	return entry != "" && len(entry) <= 512 && !strings.HasPrefix(entry, "/") && !strings.ContainsAny(entry, "\\\x00") &&
		path.Clean(entry) == entry && entry != "." && !strings.HasPrefix(entry, "../")
}

// AcceptLogExport commits the task, its idempotency mapping and every bounded
// source item in one transaction. A same-owner/same-key replay returns the
// original task before any new-task admission is considered. Nothing is
// returned as accepted until the transaction commits.
func (s *Store) AcceptLogExport(ctx context.Context, request LogExportAcceptRequest) (LogExportTask, bool, error) {
	var accepted LogExportTask
	var reused bool
	if !logObjectID.MatchString(request.ExportID) || request.OwnerUserID == "" || request.CorrelationID == "" ||
		!validLogTime(request.CutoffTime) || !validLogTime(request.CreatedAt) || request.IdempotencyKey == "" ||
		len(request.IdempotencyKey) > 256 || !request.Scope.IncludeCoreLogs || request.Scope.OwnedWorkCount < 0 ||
		len(request.Sources) > 4096 {
		return accepted, false, ErrStorage
	}
	idempotencyKey, ok := LogIdempotencyKey(request.OwnerUserID, request.IdempotencyKey)
	if !ok {
		return accepted, false, ErrStorage
	}
	err := s.Write(ctx, func(tx *sql.Tx) error {
		if existing, found, err := GetLogRecordTx[LogIdempotency](tx, idempotencyKey); err != nil {
			return err
		} else if found {
			if existing.OwnerUserID != request.OwnerUserID {
				return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
			}
			taskKey, ok := LogTaskKey(existing.ExportID)
			if !ok {
				return ErrStorage
			}
			task, found, err := GetLogRecordTx[LogExportTask](tx, taskKey)
			if err != nil {
				return err
			}
			if !found || task.OwnerUserID != request.OwnerUserID {
				return ErrStorage
			}
			accepted, reused = task, true
			return nil
		}
		busy, err := logTaskBusyTx(tx)
		if err != nil {
			return err
		}
		if busy {
			return repositoryFailure("LOG_EXPORT_BUSY")
		}
		if request.Capacity != nil {
			if err := request.Capacity(); err != nil {
				return err
			}
		}
		taskKey, _ := LogTaskKey(request.ExportID)
		if _, found, err := GetLogRecordTx[LogExportTask](tx, taskKey); err != nil {
			return err
		} else if found {
			return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
		}
		workIDs := map[string]bool{}
		items := make([]LogTaskSource, 0, len(request.Sources))
		for index, item := range request.Sources {
			if item.Sequence != int64(index) || !logObjectID.MatchString(item.SourceID) || item.ExportID != request.ExportID ||
				item.OwnerUserID != request.OwnerUserID || !validLogSourceKind(item.Kind, item.ServiceID) || item.Bytes < 0 ||
				len(item.Entries) > 4096 || len(item.Reason) > 2048 {
				return ErrStorage
			}
			for _, entry := range item.Entries {
				if !validLogEntryName(entry) {
					return ErrStorage
				}
			}
			sourceKey, _ := LogSourceKey(item.SourceID)
			source, found, err := GetLogRecordTx[LogSource](tx, sourceKey)
			if err != nil {
				return err
			}
			if !found || source.InstallationID != s.installationID || source.OwnerUserID != request.OwnerUserID ||
				source.WorkID != item.WorkID || source.Kind != item.Kind || source.ServiceID != item.ServiceID {
				return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
			}
			workIDs[item.WorkID] = true
			items = append(items, item)
		}
		scope := request.Scope
		scope.SourceCount = int64(len(items))
		if scope.OwnedWorkCount < int64(len(workIDs)) {
			return repositoryFailure("LOG_EXPORT_RECORD_CONFLICT")
		}
		now := request.CreatedAt
		accepted = LogExportTask{
			Version: logRecordVersion, ExportID: request.ExportID, OwnerUserID: request.OwnerUserID,
			CorrelationID: request.CorrelationID, CutoffTime: request.CutoffTime, State: "collecting",
			Scope: scope, CreatedAt: now, UpdatedAt: now, WorkerEpoch: 1,
			Progress: LogProgress{ProcessedSources: 0, TotalSources: int64(len(items)), CollectedBytes: 0},
			Warnings: []LogWarning{},
		}
		if err := PutLogRecordTx(tx, taskKey, accepted); err != nil {
			return err
		}
		idempotency := LogIdempotency{Version: logRecordVersion, OwnerUserID: request.OwnerUserID, ExportID: request.ExportID, CreatedAt: now}
		if err := PutLogRecordTx(tx, idempotencyKey, idempotency); err != nil {
			return err
		}
		for _, item := range items {
			itemKey, _ := LogTaskSourceKey(request.ExportID, item.Sequence)
			if err := PutLogRecordTx(tx, itemKey, item); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return LogExportTask{}, false, err
	}
	return accepted, reused, nil
}

// LogSourceID derives a stable opaque source identity from the exact runtime
// instance. Re-registration after a crash therefore targets the same record.
func LogSourceID(installationID, workID, kind, logicalID string, generation int64, instanceID string) (string, bool) {
	if installationID == "" || workID == "" || logicalID == "" || instanceID == "" {
		return "", false
	}
	sum := sha256.Sum256([]byte("log-source\x00" + installationID + "\x00" + workID + "\x00" + kind + "\x00" + logicalID + "\x00" + strconv.FormatInt(generation, 10) + "\x00" + instanceID))
	return "log-source-" + hex.EncodeToString(sum[:16]), true
}

// LogSourceByContainer finds the bound source for an exact Engine instance.
// It never matches by name or labels alone.
func (s *Store) LogSourceByContainer(ctx context.Context, containerID string) (LogSource, bool, error) {
	if containerID == "" {
		return LogSource{}, false, ErrStorage
	}
	keys, err := s.ListLogRecordKeys(ctx, "log_source_")
	if err != nil {
		return LogSource{}, false, err
	}
	for _, key := range keys {
		source, found, err := GetLogRecord[LogSource](ctx, s, key)
		if err != nil {
			return LogSource{}, false, err
		}
		if found && source.InstallationID == s.installationID && source.ContainerID == containerID {
			return source, true, nil
		}
	}
	return LogSource{}, false, nil
}
