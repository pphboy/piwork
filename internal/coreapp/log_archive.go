package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"hash"
	"io"
	"strconv"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

const (
	defaultArchiveBudget    = 5 * time.Second
	maxArchiveSourceBytes   = int64(512 << 20)
	archiveMetadataVersion  = 1
	archiveMetadataFileName = "metadata.json"
)

// fullLogReader is the narrow Engine capability used by lifecycle archiving.
type fullLogReader interface {
	FullLogs(ctx context.Context, identity dockerengine.ContainerIdentity, request dockerengine.FullLogRequest, stdout, stderr io.Writer) (dockerengine.FullLogResult, error)
}

// archiveBeforeRemoval bounds one archive attempt by the operation's remaining
// budget and the installation-wide two-slot archive concurrency. Any failure is
// deliberately ignored so the original removal/stop still proceeds.
func (a *Application) archiveBeforeRemoval(ctx context.Context, identity dockerengine.ContainerIdentity, containerID string) {
	if a.Store == nil || containerID == "" {
		return
	}
	budget := defaultArchiveBudget
	if deadline, ok := ctx.Deadline(); ok {
		if remaining := time.Until(deadline); remaining < budget {
			budget = remaining
		}
	}
	if budget <= 0 {
		return
	}
	archiveCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	if a.archiveSlots != nil {
		select {
		case a.archiveSlots <- struct{}{}:
			defer func() { <-a.archiveSlots }()
		case <-archiveCtx.Done():
			return
		}
	}
	source, found, err := a.Store.LogSourceByContainer(archiveCtx, containerID)
	if err != nil || !found {
		return
	}
	_, _ = a.archiveLogSource(archiveCtx, source, identity, budget)
}

func (a *Application) logReader() fullLogReader {
	if a.fullLogReaderForTest != nil {
		return a.fullLogReaderForTest
	}
	if a.dockerRuntime == nil {
		return nil
	}
	return a.dockerRuntime
}

type archiveMetadata struct {
	Version        int    `json:"version"`
	SourceID       string `json:"sourceId"`
	WorkID         string `json:"workId"`
	Kind           string `json:"kind"`
	ServiceID      string `json:"serviceId,omitempty"`
	Generation     int64  `json:"generation"`
	InstanceID     string `json:"instanceId"`
	ContainerID    string `json:"containerId"`
	PolicyVersion  int64  `json:"policyVersion"`
	State          string `json:"state"`
	StartTime      string `json:"startTime,omitempty"`
	EndTime        string `json:"endTime,omitempty"`
	StdoutBytes    int64  `json:"stdoutBytes"`
	StderrBytes    int64  `json:"stderrBytes"`
	StdoutDigest   string `json:"stdoutDigest"`
	StderrDigest   string `json:"stderrDigest"`
	RedactedValues int    `json:"redactedValueCount"`
	Reason         string `json:"reason,omitempty"`
	ArchivedAt     string `json:"archivedAt"`
}

type hashingWriter struct {
	writer io.Writer
	hash   hash.Hash
	size   int64
}

func (w *hashingWriter) Write(data []byte) (int, error) {
	n, err := w.writer.Write(data)
	if n > 0 {
		_, _ = w.hash.Write(data[:n])
		w.size += int64(n)
	}
	return n, err
}

type archiveSink struct {
	redactor *secretRedactor
	scanner  *dockerTimestampScanner
}

func (s *archiveSink) Write(data []byte) (int, error) {
	_, _ = s.scanner.Write(data)
	return s.redactor.Write(data)
}

// archiveLogSource bounds one exact instance archive to the caller's remaining
// budget (at most five seconds). It publishes a complete directory before the
// archived state is committed; any earlier failure leaves only a gap record.
func (a *Application) archiveLogSource(ctx context.Context, source corestore.LogSource, identity dockerengine.ContainerIdentity, budget time.Duration) (corestore.LogArchive, error) {
	if budget <= 0 || budget > defaultArchiveBudget {
		budget = defaultArchiveBudget
	}
	archiveCtx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	now := time.Now().UTC()
	archive := corestore.LogArchive{Version: 1, SourceID: source.SourceID}
	if source.ContainerID == "" || a.logReader() == nil {
		archive.State = "missing"
		archive.Reason = "source instance was not bound"
		archive.PublishedAt = now.Format(time.RFC3339Nano)
		return archive, a.recordArchiveGap(ctx, source, archive, "missing", archive.Reason)
	}
	staging, err := a.Store.OpenLogSourceStaging(source.WorkID, source.SourceID)
	if err != nil {
		archive.State = "failed"
		archive.Reason = "archive staging is unavailable"
		return archive, a.recordArchiveGap(ctx, source, archive, "failed", archive.Reason)
	}
	published := false
	defer func() {
		staging.Close()
		if !published {
			_ = a.Store.RemoveLogSourceStaging(source.WorkID, source.SourceID)
		}
	}()
	stdoutFile, err := staging.OpenFile("stdout.log", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		return a.failArchive(ctx, source, archive, "archive staging is unsafe")
	}
	stderrFile, err := staging.OpenFile("stderr.log", unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		stdoutFile.Close()
		return a.failArchive(ctx, source, archive, "archive staging is unsafe")
	}
	secrets, secretErr := a.logArchiveSecrets(ctx, source)
	if secretErr != nil {
		stdoutFile.Close()
		stderrFile.Close()
		return a.failArchive(ctx, source, archive, "source redaction context is unavailable")
	}
	stdoutHash := &hashingWriter{writer: stdoutFile, hash: sha256.New()}
	stderrHash := &hashingWriter{writer: stderrFile, hash: sha256.New()}
	stdoutScanner, stderrScanner := &dockerTimestampScanner{}, &dockerTimestampScanner{}
	stdoutRedactor := newSecretRedactor(stdoutHash, secrets)
	stderrRedactor := newSecretRedactor(stderrHash, secrets)
	_, logErr := a.logReader().FullLogs(archiveCtx, identity, dockerengine.FullLogRequest{
		ExpectedContainerID: source.ContainerID, Until: now, MaxBytes: maxArchiveSourceBytes,
	}, &archiveSink{redactor: stdoutRedactor, scanner: stdoutScanner}, &archiveSink{redactor: stderrRedactor, scanner: stderrScanner})
	flushErr := errors.Join(stdoutRedactor.Flush(), stderrRedactor.Flush())
	syncErr := errors.Join(stdoutFile.Sync(), stderrFile.Sync())
	closeErr := errors.Join(stdoutFile.Close(), stderrFile.Close())
	if flushErr != nil || syncErr != nil || closeErr != nil {
		return a.failArchive(ctx, source, archive, "archive file write failed")
	}
	archive.StdoutBytes, archive.StderrBytes = stdoutHash.size, stderrHash.size
	archive.StdoutDigest = hex.EncodeToString(stdoutHash.hash.Sum(nil))
	archive.StderrDigest = hex.EncodeToString(stderrHash.hash.Sum(nil))
	stdoutStart, stdoutEnd := stdoutScanner.rangeStrings()
	stderrStart, stderrEnd := stderrScanner.rangeStrings()
	archive.StartTime, archive.EndTime = combineArchiveRange(stdoutStart, stdoutEnd, stderrStart, stderrEnd)
	archive.PublishedAt = now.Format(time.RFC3339Nano)
	state, reason := "archived", ""
	if logErr != nil || flushErr != nil {
		state, reason = classifyArchiveFailure(logErr, archive.StdoutBytes+archive.StderrBytes)
	}
	if logErr != nil && errors.Is(logErr, dockerengine.ErrResourceMissing) {
		archive.State, archive.Reason = "missing", "source instance is unavailable"
		return archive, a.recordArchiveGap(ctx, source, archive, "missing", archive.Reason)
	}
	if state == "failed" && archive.StdoutBytes+archive.StderrBytes == 0 {
		return a.failArchive(ctx, source, archive, reason)
	}
	archive.State, archive.Reason = state, reason
	metadata := archiveMetadata{
		Version: archiveMetadataVersion, SourceID: source.SourceID, WorkID: source.WorkID, Kind: source.Kind,
		ServiceID: source.ServiceID, Generation: source.Generation, InstanceID: source.InstanceID, ContainerID: source.ContainerID,
		PolicyVersion: source.PolicyVersion, State: state, StartTime: archive.StartTime, EndTime: archive.EndTime,
		StdoutBytes: archive.StdoutBytes, StderrBytes: archive.StderrBytes, StdoutDigest: archive.StdoutDigest,
		StderrDigest: archive.StderrDigest, RedactedValues: len(secrets), Reason: reason, ArchivedAt: archive.PublishedAt,
	}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return a.failArchive(ctx, source, archive, "archive metadata is invalid")
	}
	metadataFile, err := staging.OpenFile(archiveMetadataFileName, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY)
	if err != nil {
		return a.failArchive(ctx, source, archive, "archive metadata is unavailable")
	}
	_, writeErr := metadataFile.Write(raw)
	if writeErr == nil {
		writeErr = metadataFile.Sync()
	}
	closeMeta := metadataFile.Close()
	if writeErr != nil || closeMeta != nil || staging.Sync() != nil {
		return a.failArchive(ctx, source, archive, "archive metadata could not be stored")
	}
	staging.Close()
	if err := a.Store.PublishLogSourceStaging(source.WorkID, source.SourceID); err != nil {
		return a.failArchive(ctx, source, archive, "archive publication failed")
	}
	published = true
	if err := a.Store.RecordLogArchive(ctx, source.SourceID, archive, state, archive.PublishedAt); err != nil {
		// The complete directory stays visible for recovery verification, but
		// the source is not reported as archived until this record commits.
		a.RecordAppEvent("log.archive", "warn", map[string]string{"sourceId": source.SourceID, "state": "unrecorded"})
		return archive, err
	}
	level := "info"
	if state != "archived" {
		level = "warn"
	}
	a.RecordAppEvent("log.archive", level, map[string]string{
		"sourceId": source.SourceID, "state": state,
		"bytes": strconv.FormatInt(archive.StdoutBytes+archive.StderrBytes, 10),
	})
	return archive, logErr
}

func combineArchiveRange(firstStart, firstEnd, secondStart, secondEnd string) (string, string) {
	start, end := "", ""
	for _, current := range []struct{ start, end string }{{firstStart, firstEnd}, {secondStart, secondEnd}} {
		if current.start == "" {
			continue
		}
		startTime, startErr := time.Parse(time.RFC3339Nano, current.start)
		endTime, endErr := time.Parse(time.RFC3339Nano, current.end)
		if startErr != nil || endErr != nil {
			continue
		}
		if start == "" {
			start, end = current.start, current.end
			continue
		}
		existingStart, _ := time.Parse(time.RFC3339Nano, start)
		existingEnd, _ := time.Parse(time.RFC3339Nano, end)
		if startTime.Before(existingStart) {
			start = current.start
		}
		if endTime.After(existingEnd) {
			end = current.end
		}
	}
	return start, end
}

func classifyArchiveFailure(err error, bytes int64) (string, string) {
	switch {
	case err == nil:
		return "archived", ""
	case bytes > 0:
		switch {
		case errors.Is(err, dockerengine.ErrStreamLimit):
			return "partial", "source output exceeded the archive byte budget"
		case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
			return "partial", "archive time budget was exhausted"
		case errors.Is(err, dockerengine.ErrLogDriverUnsupported):
			return "partial", "log driver does not support complete reads"
		default:
			return "partial", "log stream was interrupted"
		}
	default:
		switch {
		case errors.Is(err, dockerengine.ErrLogDriverUnsupported):
			return "failed", "log driver does not support complete reads"
		case errors.Is(err, context.DeadlineExceeded), errors.Is(err, context.Canceled):
			return "failed", "archive time budget was exhausted"
		default:
			return "failed", "source log collection failed"
		}
	}
}

func (a *Application) failArchive(ctx context.Context, source corestore.LogSource, archive corestore.LogArchive, reason string) (corestore.LogArchive, error) {
	archive.State, archive.Reason = "failed", reason
	return archive, a.recordArchiveGap(ctx, source, archive, "failed", reason)
}

func (a *Application) recordArchiveGap(ctx context.Context, source corestore.LogSource, archive corestore.LogArchive, state, reason string) error {
	archive.State, archive.Reason = state, reason
	if archive.PublishedAt == "" {
		archive.PublishedAt = time.Now().UTC().Format(time.RFC3339Nano)
	}
	recordErr := a.Store.RecordLogArchive(ctx, source.SourceID, archive, state, archive.PublishedAt)
	a.RecordAppEvent("log.archive", "warn", map[string]string{"sourceId": source.SourceID, "state": state})
	return recordErr
}

// logContextRevision uses the immutable Context actually started, including rollback.
func (a *Application) logContextRevision(ctx context.Context, workID, contextID string) (int64, error) {
	var revision int64
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT internal_revision FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, contextID).Scan(&revision)
	})
	return revision, err
}

// logArchiveSecrets fails closed when the original sensitive context cannot be
// resolved. Never substitute desired/active or runtime generation for config.
func (a *Application) logArchiveSecrets(ctx context.Context, source corestore.LogSource) ([]string, error) {
	values := map[string]bool{}
	add := func(value string) {
		value = strings.TrimRight(value, "\r\n")
		if value != "" {
			values[value] = true
		}
	}
	if source.Kind == "service" && source.ServiceID != "" {
		var raw string
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT definition_json FROM service_revisions WHERE work_id=? AND service_id=? AND revision=?`, source.WorkID, source.ServiceID, source.Generation).Scan(&raw)
		})
		if err != nil {
			return nil, err
		}
		var definition contracts.ServiceDefinition
		if err := json.Unmarshal([]byte(raw), &definition); err != nil {
			return nil, err
		}
		for key, value := range definition.Environment {
			if regexpSecretKey.MatchString(key) {
				var text string
				if err := json.Unmarshal(value, &text); err != nil {
					return nil, err
				}
				add(text)
			}
		}
	} else if source.Kind == "agent" {
		if source.ConfigRevision <= 0 {
			return nil, corestore.ErrStorage
		}
		var configJSON string
		var profileJSON sql.NullString
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT config_json,runtime_profile_json FROM work_config_revisions WHERE work_id=? AND revision=?`, source.WorkID, source.ConfigRevision).Scan(&configJSON, &profileJSON)
		})
		if err != nil {
			return nil, err
		}
		var config contracts.WorkConfig
		if err := json.Unmarshal([]byte(configJSON), &config); err != nil {
			return nil, err
		}
		for _, server := range config.McpServers {
			if !server.SecretRefs.Present {
				continue
			}
			for _, reference := range server.SecretRefs.Value {
				var storagePath string
				err := a.Store.Read(ctx, func(tx *sql.Tx) error {
					return tx.QueryRowContext(ctx, `SELECT storage_path FROM secret_refs WHERE id=? AND owner_user_id=?`, string(reference.SecretId), source.OwnerUserID).Scan(&storagePath)
				})
				if err != nil {
					return nil, err
				}
				secret, err := a.files.ReadSecret(storagePath)
				if err != nil {
					return nil, err
				}
				add(string(secret))
			}
		}
		// An uncaptured runtime profile cannot prove which model credential ran.
		if !profileJSON.Valid {
			return nil, corestore.ErrStorage
		}
		var profile RuntimeProfile
		if err := json.Unmarshal([]byte(profileJSON.String), &profile); err != nil {
			return nil, err
		}
		if profile.Model.CredentialRef != "" {
			secret, err := a.files.ReadSecret(profile.Model.CredentialRef)
			if err != nil {
				return nil, err
			}
			add(string(secret))
		}
	} else {
		return nil, corestore.ErrStorage
	}
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	return result, nil
}
