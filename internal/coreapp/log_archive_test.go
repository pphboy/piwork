package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

type fakeFullLogReader struct {
	stdout, stderr [][]byte
	err            error
	calls          int
}

func (f *fakeFullLogReader) FullLogs(ctx context.Context, identity dockerengine.ContainerIdentity, request dockerengine.FullLogRequest, stdout, stderr io.Writer) (dockerengine.FullLogResult, error) {
	f.calls++
	var result dockerengine.FullLogResult
	remaining := request.MaxBytes
	write := func(target io.Writer, chunk []byte) (bool, error) {
		if remaining <= 0 {
			return true, dockerengine.ErrStreamLimit
		}
		if int64(len(chunk)) > remaining {
			chunk = chunk[:remaining]
			n, err := target.Write(chunk)
			remaining -= int64(n)
			return true, errors.Join(err, dockerengine.ErrStreamLimit)
		}
		n, err := target.Write(chunk)
		remaining -= int64(n)
		return false, err
	}
	for _, chunk := range f.stdout {
		limited, err := write(stdout, chunk)
		result.StdoutBytes += int64(len(chunk))
		if err != nil {
			return result, err
		}
		if limited {
			break
		}
	}
	for _, chunk := range f.stderr {
		limited, err := write(stderr, chunk)
		result.StderrBytes += int64(len(chunk))
		if err != nil {
			return result, err
		}
		if limited {
			break
		}
	}
	if f.err != nil {
		return result, f.err
	}
	return result, nil
}

func archiveFixture(t *testing.T) (*Application, corestore.LogSource, dockerengine.ContainerIdentity, string) {
	t.Helper()
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		_ = a.Close(ctx)
	})
	ctx := context.Background()
	now := "2026-10-21T00:00:00Z"
	owner, workID, serviceID := "user-000000000000001", "work-000000000000001", "service-000000000000001"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO users(id,account,password_digest,role,enabled,created_at,updated_at) VALUES(?,?,?,?,1,?,?)`, owner, "archive-owner", "digest", "admin", now, now); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO works(id,owner_user_id,name,desired_state,observed_state,desired_revision,control_version,created_at,updated_at) VALUES(?,?,?,?,?,0,0,?,?)`, workID, owner, "archive-work", "stopped", "stopped", now, now); err != nil {
			return err
		}
		definition, err := json.Marshal(contracts.ServiceDefinition{
			ServiceId: contracts.ResourceId(serviceID), Revision: 1, Name: "svc",
			Environment: map[string]json.RawMessage{"API_KEY": json.RawMessage(`"super-secret-value"`)},
		})
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO service_revisions(work_id,service_id,revision,definition_json,resolved_image_digest,created_at) VALUES(?,?,?,?,NULL,?)`, workID, serviceID, 1, string(definition), now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	source, err := a.Store.RegisterLogSource(ctx, corestore.LogSourceRegistration{
		SourceID: "log-source-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", OwnerUserID: owner, WorkID: workID,
		Kind: "service", ServiceID: serviceID, Generation: 1, InstanceID: "instance-1", PolicyVersion: 1, CreatedAt: now,
	})
	if err != nil {
		t.Fatal(err)
	}
	source, err = a.Store.BindLogSource(ctx, source.SourceID, "container-exact", 1, now)
	if err != nil {
		t.Fatal(err)
	}
	return a, source, serviceContainerIdentity(workID, serviceID, 1), directory
}

func TestArchiveLogSourceRedactsCrossChunkSecretsAndPublishes(t *testing.T) {
	a, source, identity, directory := archiveFixture(t)
	a.fullLogReaderForTest = &fakeFullLogReader{
		stdout: [][]byte{
			[]byte("2026-10-21T00:00:01Z password=super-sec"),
			[]byte("ret-value\n"),
		},
		stderr: [][]byte{{0xff, '\n'}},
	}
	archive, err := a.archiveLogSource(context.Background(), source, identity, time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if archive.State != "archived" || archive.StdoutBytes == 0 || archive.StartTime != "2026-10-21T00:00:01Z" {
		t.Fatalf("unexpected archive: %#v", archive)
	}
	final := filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID)
	stdout, err := os.ReadFile(filepath.Join(final, "stdout.log"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(stdout), "super-secret-value") || !strings.Contains(string(stdout), "[redacted]") || !strings.HasSuffix(string(stdout), "\n") {
		t.Fatalf("stdout was not redacted: %q", stdout)
	}
	stderr, err := os.ReadFile(filepath.Join(final, "stderr.log"))
	if err != nil || !strings.Contains(string(stderr), "�") {
		t.Fatalf("stderr invalid UTF-8 was not replaced: %q %v", stderr, err)
	}
	rawMetadata, err := os.ReadFile(filepath.Join(final, "metadata.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(rawMetadata), "super-secret-value") {
		t.Fatal("metadata contains a secret")
	}
	var metadata archiveMetadata
	if err := json.Unmarshal(rawMetadata, &metadata); err != nil || metadata.State != "archived" || metadata.SourceID != source.SourceID || metadata.StdoutDigest != archive.StdoutDigest {
		t.Fatalf("metadata mismatch: %#v %v", metadata, err)
	}
	if _, err := os.Stat(filepath.Join(directory, "logs", "works", source.WorkID, ".staging-"+source.SourceID)); !os.IsNotExist(err) {
		t.Fatal("staging directory was retained")
	}
	stored, found, err := a.Store.LogSource(context.Background(), source.SourceID)
	if err != nil || !found || stored.State != "archived" || stored.ArchivedAt == "" {
		t.Fatalf("source state not committed: %#v %v %v", stored, found, err)
	}
	for _, record := range readCoreLogRecords(t, directory) {
		if strings.Contains(mustJSON(t, record), "super-secret-value") {
			t.Fatal("global log contains archived content")
		}
	}
}

func TestArchiveLogSourceRecordsMissingAndPartialWithoutFakeSuccess(t *testing.T) {
	a, source, identity, directory := archiveFixture(t)
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
	archive, _ := a.archiveLogSource(context.Background(), source, identity, time.Second)
	if archive.State != "missing" {
		t.Fatalf("missing source not recorded: %#v", archive)
	}
	if _, err := os.Stat(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID)); !os.IsNotExist(err) {
		t.Fatal("missing source published an archive directory")
	}
	stored, _, _ := a.Store.LogSource(context.Background(), source.SourceID)
	if stored.State != "missing" {
		t.Fatalf("source state not missing: %#v", stored)
	}

	a.fullLogReaderForTest = &fakeFullLogReader{
		stdout: [][]byte{[]byte("2026-10-21T00:00:01Z partial\n")},
		err:    dockerengine.ErrStreamLimit,
	}
	archive, _ = a.archiveLogSource(context.Background(), source, identity, time.Second)
	if archive.State != "partial" || archive.Reason == "" {
		t.Fatalf("partial source not recorded: %#v", archive)
	}
	rawMetadata, err := os.ReadFile(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "metadata.json"))
	if err != nil || !strings.Contains(string(rawMetadata), `"state":"partial"`) {
		t.Fatalf("partial metadata missing: %s %v", rawMetadata, err)
	}
	stored, _, _ = a.Store.LogSource(context.Background(), source.SourceID)
	if stored.State != "partial" {
		t.Fatalf("source state not partial: %#v", stored)
	}
}

func TestArchiveBeforeRemovalUsesBoundSourceAndFailureStillReturns(t *testing.T) {
	a, source, identity, directory := archiveFixture(t)
	reader := &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:01Z captured\n")}}
	a.fullLogReaderForTest = reader
	a.archiveBeforeRemoval(context.Background(), identity, source.ContainerID)
	if _, err := os.Stat(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "stdout.log")); err != nil {
		t.Fatalf("removal hook did not archive the exact source: %v", err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrStream}
	started := time.Now()
	a.archiveBeforeRemoval(context.Background(), identity, source.ContainerID)
	if time.Since(started) > 2*time.Second {
		t.Fatal("archive failure stalled the removal hook")
	}
	a.archiveBeforeRemoval(context.Background(), identity, "container-unrelated")
}

func TestRecoverPublishedLogArchivesCommitsOrRejectsAfterPublishWindow(t *testing.T) {
	a, source, identity, directory := archiveFixture(t)
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:01Z recover me\n")}}
	if _, err := a.archiveLogSource(context.Background(), source, identity, time.Second); err != nil {
		t.Fatal(err)
	}
	reset := func() {
		if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
			key, _ := corestore.LogSourceKey(source.SourceID)
			stored, found, err := corestore.GetLogRecordTx[corestore.LogSource](tx, key)
			if err != nil || !found {
				return err
			}
			stored.State, stored.ArchivedAt = "bound", ""
			if err := corestore.PutLogRecordTx(tx, key, stored); err != nil {
				return err
			}
			archiveKey, _ := corestore.LogArchiveKey(source.SourceID)
			return corestore.DeleteLogRecordTx(tx, archiveKey)
		}); err != nil {
			t.Fatal(err)
		}
	}
	reset()
	a.recoverPublishedLogArchives(context.Background())
	stored, found, err := a.Store.LogSource(context.Background(), source.SourceID)
	if err != nil || !found || stored.State != "archived" {
		t.Fatalf("published archive was not recovered: %#v %v %v", stored, found, err)
	}

	reset()
	path := filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "stdout.log")
	if err := os.WriteFile(path, []byte("tampered\n"), 0600); err != nil {
		t.Fatal(err)
	}
	a.recoverPublishedLogArchives(context.Background())
	stored, _, _ = a.Store.LogSource(context.Background(), source.SourceID)
	if stored.State != "failed" || stored.Reason == "" {
		t.Fatalf("tampered archive was accepted: %#v", stored)
	}
}

func TestMarkMissingLogSourcesRecordsInterruptedBinding(t *testing.T) {
	a, _, _, _ := archiveFixture(t)
	owner, workID := "user-000000000000001", "work-000000000000001"
	source, err := a.Store.RegisterLogSource(context.Background(), corestore.LogSourceRegistration{
		SourceID: "log-source-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", OwnerUserID: owner, WorkID: workID, Kind: "agent",
		Generation: 2, InstanceID: "instance-2", CreatedAt: "2026-10-21T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	a.markMissingLogSources(context.Background())
	stored, _, _ := a.Store.LogSource(context.Background(), source.SourceID)
	if stored.State != "missing" || stored.Reason == "" {
		t.Fatalf("interrupted binding not recorded as a gap: %#v", stored)
	}
}

func TestArchiveUsesOriginalAgentConfigRevisionSecrets(t *testing.T) {
	a, service, _, directory := archiveFixture(t)
	ctx := context.Background()
	oldRef := "model-11111111-1111-4111-8111-111111111111.secret"
	newRef := "model-22222222-2222-4222-8222-222222222222.secret"
	const oldValue = "ORIGINAL_INSTANCE_SECRET"
	if err := a.files.WriteSecret(oldRef, []byte(oldValue)); err != nil {
		t.Fatal(err)
	}
	if err := a.files.WriteSecret(newRef, []byte("NEW_INSTANCE_SECRET")); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for revision, ref := range map[int]string{1: oldRef, 2: newRef} {
			profile := `{"model":{"credentialRef":"` + ref + `"}}`
			if _, err := tx.Exec(`INSERT INTO work_config_revisions(work_id,revision,config_json,created_by_user_id,created_at,runtime_profile_json) VALUES(?,?,?,?,'2026-10-21T00:00:00Z',?)`, service.WorkID, revision, "{}", service.OwnerUserID, profile); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`UPDATE works SET active_revision=2,desired_revision=2 WHERE id=?`, service.WorkID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	source, err := a.Store.RegisterLogSource(ctx, corestore.LogSourceRegistration{
		SourceID: "log-source-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", OwnerUserID: service.OwnerUserID, WorkID: service.WorkID,
		Kind: "agent", Generation: 7, ConfigRevision: 1, InstanceID: "old-agent-instance", CreatedAt: "2026-10-21T00:00:00Z",
	})
	if err != nil {
		t.Fatal(err)
	}
	source, err = a.Store.BindLogSource(ctx, source.SourceID, "old-agent-container", 0, "2026-10-21T00:00:00Z")
	if err != nil {
		t.Fatal(err)
	}
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:01Z " + oldValue + "\n")}}
	archived, _ := a.archiveLogSource(ctx, source, dockerengine.ContainerIdentity{WorkID: source.WorkID, Kind: "agent", LogicalID: "agentd"}, time.Second)
	if archived.State != "archived" {
		t.Fatalf("archive failed: %#v", archived)
	}
	raw, err := os.ReadFile(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "stdout.log"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), oldValue) || !strings.Contains(string(raw), "[redacted]") {
		t.Fatalf("original Agent credential was not redacted from the archive: %q", raw)
	}
}
