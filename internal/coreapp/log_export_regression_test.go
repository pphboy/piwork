package coreapp

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"piwork/internal/corelogs"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"strings"
	"testing"
	"time"
)

func acceptLogRegressionSource(t *testing.T, a *Application, source corestore.LogSource, id, key string) {
	t.Helper()
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{ExportID: id, OwnerUserID: source.OwnerUserID, CorrelationID: key, CutoffTime: now, IdempotencyKey: key, CreatedAt: now, Scope: corestore.LogScope{IncludeCoreLogs: true, OwnedWorkCount: 1, SourceCount: 1}, Sources: []corestore.LogTaskSource{{Version: 1, ExportID: id, SourceID: source.SourceID, OwnerUserID: source.OwnerUserID, WorkID: source.WorkID, Kind: source.Kind, ServiceID: source.ServiceID, State: "pending"}}})
	if err != nil {
		t.Fatal(err)
	}
}

func TestLogRegressionMissingMetadataCannotEraseKnownArchiveGap(t *testing.T) {
	for _, variant := range []string{"missing", "corrupt", "foreign", "live"} {
		t.Run(variant, func(t *testing.T) {
			a, source, identity, directory := archiveFixture(t)
			a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:00Z retained prefix\n")}, err: io.ErrUnexpectedEOF}
			archived, _ := a.archiveLogSource(context.Background(), source, identity, time.Second)
			if archived.State != "partial" {
				t.Fatal("fixture did not create partial archive")
			}
			if err := os.Remove(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "metadata.json")); err != nil {
				t.Fatal(err)
			}
			if variant != "missing" && variant != "live" {
				raw := []byte("{invalid")
				if variant == "foreign" {
					raw = []byte(`{"version":1,"state":"archived","sourceId":"wrong-source"}`)
				}
				if err := os.WriteFile(filepath.Join(directory, "logs", "works", source.WorkID, source.SourceID, "metadata.json"), raw, 0600); err != nil {
					t.Fatal(err)
				}
			}
			a.fullLogReaderForTest = &fakeFullLogReader{err: dockerengine.ErrResourceMissing}
			if variant == "live" {
				a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte("2026-10-21T00:00:00Z retained prefix\n")}}
			}
			id := "log-export-dddddddddddddddddddddddddddddddd"
			acceptLogRegressionSource(t, a, source, id, "regression-missing-metadata")
			a.runLogExport(id)
			task, _, err := a.Store.LogExportTask(context.Background(), id)
			if err != nil {
				t.Fatal(err)
			}
			if task.Complete == nil || *task.Complete || task.WarningCount == 0 {
				t.Fatalf("known partial source became complete after metadata loss: state=%s complete=%v warnings=%d", task.State, task.Complete != nil && *task.Complete, task.WarningCount)
			}
		})
	}
}

func TestLogRegressionAreaQuotaMustBoundRawStagingBeforePacking(t *testing.T) {
	a, source, _, directory := archiveFixture(t)
	limits := defaultLogExportLimits()
	limits.areaLimit = 4096
	a.logLimitsForTest = limits
	a.fullLogReaderForTest = &fakeFullLogReader{stdout: [][]byte{[]byte(strings.Repeat("2026-10-21T00:00:00Z retained line\n", 4096))}}
	var usedBeforeZIP int64
	a.logExportFaultForTest = func(stage string) error {
		if stage == "zip" {
			usedBeforeZIP, _ = logExportAreaUsed(directory)
			return errors.New("stop before ZIP for measurement")
		}
		return nil
	}
	id := "log-export-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	acceptLogRegressionSource(t, a, source, id, "regression-staging-quota")
	a.runLogExport(id)
	if usedBeforeZIP > limits.areaLimit {
		t.Fatalf("raw staging already exceeded quota before ZIP: bytes=%d cap=%d", usedBeforeZIP, limits.areaLimit)
	}
}

func TestLogRegressionAcceptedCoreBoundarySurvivesRotation(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	if err := a.logs.Close(); err != nil {
		t.Fatal(err)
	}
	root, err := a.Store.OpenCoreLogDir()
	if err != nil {
		t.Fatal(err)
	}
	a.logs, err = corelogs.Open(root, corelogs.Options{Stdout: io.Discard, Stderr: io.Discard, MaxSegmentBytes: 1024, MaxTotalBytes: 2048})
	if err != nil {
		t.Fatal(err)
	}
	const marker = "ACCEPTED_CORE_SHARD_MUST_REMAIN_PINNED"
	const after = "POST_CUTOFF_MUST_BE_EXCLUDED"
	a.RecordAppEvent("test.freeze", "info", map[string]string{"marker": marker})
	entered, release := make(chan struct{}), make(chan struct{})
	a.logExportFaultForTest = func(stage string) error {
		if stage == "collect" {
			close(entered)
			<-release
		}
		return nil
	}
	defer func() {
		select {
		case <-release:
		default:
			close(release)
		}
	}()
	code, accepted := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, map[string]string{"idempotencyKey": "accepted-rotation"})
	if code != 202 {
		t.Fatal(code, accepted)
	}
	<-entered
	for i := 0; i < 100; i++ {
		a.RecordAppEvent("test.rotate", "info", map[string]string{"marker": after + strings.Repeat("x", 300)})
	}
	close(release)
	id := accepted["exportId"].(string)
	waitLogExportReady(t, base, admin.Token, id)
	found := false
	for name, content := range verifyBundle(t, a, id) {
		if strings.HasPrefix(name, "core/") {
			found = found || strings.Contains(content, marker)
			if strings.Contains(content, after) {
				t.Fatal("included post-cutoff content")
			}
		}
	}
	if !found {
		t.Fatal("accepted Core content disappeared during rotation")
	}
	// Replay retains the original boundary, ID and cutoff rather than collecting again.
	code, replay := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, map[string]string{"idempotencyKey": "accepted-rotation"})
	if code != 202 || replay["exportId"] != id || replay["cutoffTime"] != accepted["cutoffTime"] {
		t.Fatal(code, replay)
	}
}

func TestLogRegressionCorruptDownloadMustFailOriginalTask(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	code, accepted := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, map[string]string{"idempotencyKey": "regression-corrupt-state"})
	if code != 202 {
		t.Fatal(code, accepted)
	}
	id := accepted["exportId"].(string)
	waitLogExportReady(t, base, admin.Token, id)
	file := filepath.Join(a.options.DataDirectory, "runtime", "log-exports", id, "bundle.zip")
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)/2] ^= 0xff
	if err := os.WriteFile(file, raw, 0600); err != nil {
		t.Fatal(err)
	}
	code, _ = httpCall(t, base, "/api/v1/log-exports/"+id+"/content", "GET", "Bearer "+admin.Token, nil)
	if code != 503 {
		t.Fatalf("corrupt content not rejected: %d", code)
	}
	task, _, err := a.Store.LogExportTask(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	if task.State != "failed" || task.Error == nil || task.Error.Code != "LOG_EXPORT_CONTENT_UNAVAILABLE" || task.Result != nil {
		t.Fatalf("confirmed corrupt result still advertised as downloadable: state=%s resultPresent=%t errorPresent=%t", task.State, task.Result != nil, task.Error != nil)
	}
	code, view := httpCall(t, base, "/api/v1/log-exports/"+id, "GET", "Bearer "+admin.Token, nil)
	if code != 200 || view["state"] != "failed" || view["result"] != nil {
		t.Fatal(code, view)
	}
	code, replay := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, map[string]string{"idempotencyKey": "regression-corrupt-state"})
	if code != 202 || replay["exportId"] != id || replay["cutoffTime"] != accepted["cutoffTime"] || replay["state"] != "failed" {
		t.Fatal(code, replay)
	}
	directory := a.options.DataDirectory
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: io.Discard})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(context.Background())
	persisted, found, err := reopened.Store.LogExportTask(context.Background(), id)
	if err != nil || !found || persisted.State != "failed" || persisted.Result != nil || persisted.CutoffTime != accepted["cutoffTime"] {
		t.Fatal("failure not persisted", persisted, err)
	}

}

func TestLogRegressionUnresolvedAgentContextDoesNotReadPlaintext(t *testing.T) {
	a, service, _, _ := archiveFixture(t)
	source, err := a.Store.RegisterLogSource(context.Background(), corestore.LogSourceRegistration{SourceID: "log-source-91919191919191919191919191919191", OwnerUserID: service.OwnerUserID, WorkID: service.WorkID, Kind: "agent", Generation: 7, InstanceID: "unknown-context", CreatedAt: packageNow()})
	if err != nil {
		t.Fatal(err)
	}
	source, err = a.Store.BindLogSource(context.Background(), source.SourceID, "unknown-agent", 0, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	reader := &fakeFullLogReader{stdout: [][]byte{[]byte("must never be read")}}
	a.fullLogReaderForTest = reader
	archive, _ := a.archiveLogSource(context.Background(), source, logSourceIdentity(source), time.Second)
	if archive.State != "failed" || reader.calls != 0 {
		t.Fatalf("unresolved redaction context exposed plaintext: %s calls=%d", archive.State, reader.calls)
	}
}

func TestLogRegressionZIPWriterChecksIndependentCapBeforeWriting(t *testing.T) {
	a, _, _, _ := archiveFixture(t)
	file, err := os.CreateTemp(t.TempDir(), "bounded-zip")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	run := &logExportRun{app: a, ctx: context.Background(), areaRemaining: 4096}
	zipRemaining := int64(64)
	writer := run.logWriter(file, &zipRemaining)
	if n, err := writer.Write(make([]byte, 32)); n != 32 || err != nil {
		t.Fatal(n, err)
	}
	if n, err := writer.Write(make([]byte, 33)); n != 0 || err == nil {
		t.Fatal("ZIP cap exceeded", n, err)
	}
	info, _ := file.Stat()
	if info.Size() != 32 || zipRemaining != 32 || run.areaRemaining != 4064 {
		t.Fatal("budget/file accounting diverged")
	}
}

func verifyBundle(t *testing.T, a *Application, id string) map[string]string {
	t.Helper()
	root, err := a.Store.OpenLogExportDir(id)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile("bundle.zip", 20<<20)
	if err != nil {
		t.Fatal(err)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	for _, f := range reader.File {
		r, err := f.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(r)
		r.Close()
		if err != nil {
			t.Fatal(err)
		}
		out[f.Name] = string(content)
	}
	return out
}

func TestLogRegressionRevocationDuringVerificationPreservesReady(t *testing.T) {
	for _, mode := range []string{"logout", "role", "disabled"} {
		t.Run(mode, func(t *testing.T) {
			a, base, admin, _, _ := logExportHTTPFixture(t)
			id := "log-export-92929292929292929292929292929292"
			installReadyExport(t, a, string(admin.User.ID), id, []byte("known immutable content"))
			entered := make(chan struct{})
			a.logVerifyForTest = func(ctx context.Context) error { close(entered); <-ctx.Done(); return ctx.Err() }
			result := make(chan int, 1)
			go func() {
				req, _ := http.NewRequest("GET", base+"/api/v1/log-exports/"+id+"/content", nil)
				req.Header.Set("Authorization", "Bearer "+admin.Token)
				resp, err := http.DefaultClient.Do(req)
				if err != nil {
					result <- 0
					return
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				result <- resp.StatusCode
			}()
			<-entered
			start := time.Now()
			if mode == "logout" {
				if err := a.Identity.Logout(context.Background(), admin.Token); err != nil {
					t.Fatal(err)
				}
			} else {
				query := "UPDATE users SET role='user' WHERE id=?"
				if mode == "disabled" {
					query = "UPDATE users SET enabled=0 WHERE id=?"
				}
				if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error { _, err := tx.Exec(query, string(admin.User.ID)); return err }); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case code := <-result:
				if code != 403 {
					t.Fatal("revocation response", code)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("verification outlived revocation bound")
			}
			if time.Since(start) > 2*time.Second {
				t.Fatal("late revocation")
			}
			task, _, _ := a.Store.LogExportTask(context.Background(), id)
			if task.State != "ready" || task.Result == nil || task.Error != nil {
				t.Fatal("cancellation marked healthy file corrupt", task)
			}
			a.logDownloadMu.Lock()
			active := a.logDownloads
			a.logDownloadMu.Unlock()
			if active != 0 {
				t.Fatal("leaked download slot", active)
			}
		})
	}
}

func TestLogRegressionVerificationPinsResultAgainstGC(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	id := "log-export-93939393939393939393939393939393"
	installReadyExport(t, a, string(admin.User.ID), id, []byte("original result"))
	entered, release := make(chan struct{}), make(chan struct{})
	a.logVerifyForTest = func(ctx context.Context) error {
		close(entered)
		select {
		case <-release:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	done := make(chan int, 1)
	go func() {
		req, _ := http.NewRequest("GET", base+"/api/v1/log-exports/"+id+"/content", nil)
		req.Header.Set("Authorization", "Bearer "+admin.Token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			done <- 0
			return
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		done <- resp.StatusCode
	}()
	<-entered
	a.collectLogExportGarbage(context.Background())
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "runtime", "log-exports", id, "bundle.zip")); err != nil {
		t.Fatal("GC removed pinned file", err)
	}
	close(release)
	if code := <-done; code != 200 {
		t.Fatal(code)
	}
}

func TestLogRegressionExpiredCleanupFailureRemainsTracked(t *testing.T) {
	a, _, admin, _, _ := logExportHTTPFixture(t)
	id := "log-export-95959595959595959595959595959595"
	installReadyExport(t, a, string(admin.User.ID), id, []byte("ready"))
	root := filepath.Join(a.options.DataDirectory, "runtime", "log-exports")
	original, parked := filepath.Join(root, id), filepath.Join(root, id+"-parked")
	if err := os.Rename(original, parked); err != nil {
		t.Fatal(err)
	}
	// Unsafe replacement cannot be silently treated as a cleaned directory.
	if err := os.Symlink(parked, original); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(id)
		task, _, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil {
			return err
		}
		task.Result.ExpiresAt = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
		return corestore.PutLogRecordTx(tx, key, task)
	}); err != nil {
		t.Fatal(err)
	}
	a.collectLogExportGarbage(context.Background())
	task, found, _ := a.Store.LogExportTask(context.Background(), id)
	if !found || task.State != "expired" || !task.CleanupPending {
		t.Fatal("cleanup failure lost", task)
	}
	if err := os.Remove(original); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(parked, original); err != nil {
		t.Fatal(err)
	}
	a.collectLogExportGarbage(context.Background())
	task, found, _ = a.Store.LogExportTask(context.Background(), id)
	if !found || task.CleanupPending {
		t.Fatal("cleanup retry did not settle", task)
	}
	if _, err := os.Stat(original); !os.IsNotExist(err) {
		t.Fatal("expired content retained", err)
	}
}

func TestLogRegressionZIPCapFailsActualPacking(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	limits := defaultLogExportLimits()
	limits.zipBytes = 128
	a.logLimitsForTest = limits
	id := "log-export-96969696969696969696969696969696"
	acceptLogRegressionSource(t, a, source, id, "small-zip-cap")
	a.runLogExport(id)
	task, found, err := a.Store.LogExportTask(context.Background(), id)
	if err != nil || !found || task.State != "failed" || task.Result != nil {
		t.Fatal("ZIP cap did not reject actual packing", task, err)
	}
}

func TestLogRegressionRoleLossBeforePublicationDoesNotPublish(t *testing.T) {
	a, source, _, _ := archiveFixture(t)
	id := "log-export-97979797979797979797979797979797"
	acceptLogRegressionSource(t, a, source, id, "role-loss-before-ready")
	a.logExportFaultForTest = func(stage string) error {
		if stage == "zip" {
			return a.Store.Write(context.Background(), func(tx *sql.Tx) error {
				_, err := tx.Exec(`UPDATE users SET role='user' WHERE id=?`, source.OwnerUserID)
				return err
			})
		}
		return nil
	}
	a.runLogExport(id)
	task, found, err := a.Store.LogExportTask(context.Background(), id)
	if err != nil || !found || task.State != "failed" || task.Result != nil || task.Error == nil || task.Error.Code != "PERMISSION_DENIED" {
		t.Fatal("role loss published content", task, err)
	}
}
