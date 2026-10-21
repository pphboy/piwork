package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func installReadyExport(t *testing.T, a *Application, owner, exportID string, content []byte) {
	t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	if _, _, err := a.Store.AcceptLogExport(ctx, corestore.LogExportAcceptRequest{
		ExportID: exportID, OwnerUserID: owner, CorrelationID: "correlation-ready",
		CutoffTime: now.Format(time.RFC3339Nano), IdempotencyKey: "key-" + exportID,
		Scope: corestore.LogScope{IncludeCoreLogs: true}, CreatedAt: now.Format(time.RFC3339Nano),
	}); err != nil {
		t.Fatal(err)
	}
	export, err := a.Store.OpenLogExportDir(exportID)
	if err != nil {
		t.Fatal(err)
	}
	file, err := export.OpenFile("bundle.zip", 0x40|0x1)
	if err != nil {
		export.Close()
		t.Fatal(err)
	}
	if _, err := file.Write(content); err != nil {
		t.Fatal(err)
	}
	if err := file.Sync(); err != nil {
		t.Fatal(err)
	}
	file.Close()
	sum := sha256.Sum256(content)
	readyAt := now.Format(time.RFC3339Nano)
	expiresAt := now.Add(24 * time.Hour).Format(time.RFC3339Nano)
	seal := logSeal{Version: 1, ExportID: exportID, OwnerUserID: owner, CutoffTime: now.Format(time.RFC3339Nano),
		WorkerEpoch: 1, Size: int64(len(content)), Digest: hex.EncodeToString(sum[:]), ReadyAt: readyAt, ExpiresAt: expiresAt}
	sealRaw, _ := json.Marshal(seal)
	sealFile, err := export.OpenFile("seal.json", 0x40|0x1)
	if err != nil {
		export.Close()
		t.Fatal(err)
	}
	if _, err := sealFile.Write(sealRaw); err != nil {
		t.Fatal(err)
	}
	if err := sealFile.Sync(); err != nil {
		t.Fatal(err)
	}
	sealFile.Close()
	export.Close()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(exportID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found {
			return err
		}
		result := corestore.LogResult{Filename: "piwork-logs-" + exportID + ".zip", Size: int64(len(content)), Digest: hex.EncodeToString(sum[:]), ReadyAt: readyAt, ExpiresAt: expiresAt}
		task.State, task.Result, task.Complete = "ready", &result, &[]bool{true}[0]
		task.UpdatedAt = now.Format(time.RFC3339Nano)
		if err := corestore.PutLogRecordTx(tx, key, task); err != nil {
			return err
		}
		resultKey, _ := corestore.LogResultKey(exportID)
		return corestore.PutLogRecordTx(tx, resultKey, corestore.LogResultRecord{Version: 1, ExportID: exportID, OwnerUserID: owner,
			WorkerEpoch: 1, CutoffTime: now.Format(time.RFC3339Nano), Filename: result.Filename, Size: result.Size, Digest: result.Digest,
			ReadyAt: readyAt, ExpiresAt: expiresAt})
	}); err != nil {
		t.Fatal(err)
	}
}

func TestLogExportDownloadErrorsAndExpiry(t *testing.T) {
	a, base, admin, _, other := logExportHTTPFixture(t)
	owner := string(admin.User.ID)
	readyID := "log-export-dddddddddddddddddddddddddddddddd"
	installReadyExport(t, a, owner, readyID, []byte("ready-content"))
	request, _ := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+readyID+"/content", nil)
	request.Header.Set("Authorization", "Bearer "+other.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatalf("another admin downloaded the archive: %d", response.StatusCode)
	}

	pendingID := "log-export-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if _, _, err := a.Store.AcceptLogExport(context.Background(), corestore.LogExportAcceptRequest{
		ExportID: pendingID, OwnerUserID: owner, CorrelationID: "c", CutoffTime: now, IdempotencyKey: "pending-key",
		Scope: corestore.LogScope{IncludeCoreLogs: true}, CreatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]int{"/api/v1/log-exports/" + pendingID + "/content": 409, "/api/v1/log-exports/" + readyID + "/content": 200} {
		req, _ := http.NewRequest(http.MethodGet, base+path, nil)
		req.Header.Set("Authorization", "Bearer "+admin.Token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode != want {
			t.Fatalf("%s: %d", path, resp.StatusCode)
		}
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(readyID)
		task, _, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil {
			return err
		}
		task.Result.ExpiresAt = time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano)
		return corestore.PutLogRecordTx(tx, key, task)
	}); err != nil {
		t.Fatal(err)
	}
	req, _ := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+readyID+"/content", nil)
	req.Header.Set("Authorization", "Bearer "+admin.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 410 {
		t.Fatalf("expired archive served: %d", resp.StatusCode)
	}

	for deadline := time.Now().Add(2 * time.Second); ; {
		a.logDownloadMu.Lock()
		active := a.logDownloads
		a.logDownloadMu.Unlock()
		if active == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("previous download slot was not released: %d", active)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(pendingID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found {
			return err
		}
		task.State = "failed"
		return corestore.PutLogRecordTx(tx, key, task)
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(pendingID)
		task, found, err := corestore.GetLogRecordTx[corestore.LogExportTask](tx, key)
		if err != nil || !found {
			return err
		}
		task.State = "failed"
		return corestore.PutLogRecordTx(tx, key, task)
	}); err != nil {
		t.Fatal(err)
	}
	corruptID := "log-export-12121212121212121212121212121212"
	installReadyExport(t, a, owner, corruptID, []byte("original-bytes"))
	corruptPath := filepath.Join(a.options.DataDirectory, "runtime", "log-exports", corruptID, "bundle.zip")
	if err := os.WriteFile(corruptPath, []byte("replaced-bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	req, _ = http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+corruptID+"/content", nil)
	req.Header.Set("Authorization", "Bearer "+admin.Token)
	resp, err = http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 503 || !strings.Contains(string(raw), "LOG_EXPORT_CONTENT_UNAVAILABLE") {
		t.Fatalf("same-size corruption was served: %d %q", resp.StatusCode, raw)
	}
}

func TestLogExportDownloadStopsAfterSessionRevocation(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	exportID := "log-export-ffffffffffffffffffffffffffffffff"
	content := make([]byte, 64<<20)
	for index := range content {
		content[index] = byte(index)
	}
	installReadyExport(t, a, string(admin.User.ID), exportID, content)
	request, _ := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	request.Header.Set("Authorization", "Bearer "+admin.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("download failed: %d", response.StatusCode)
	}
	buffer := make([]byte, 8<<10)
	read := 0
	if n, err := response.Body.Read(buffer); err != nil && err != io.EOF {
		t.Fatal(err)
	} else {
		read += n
	}
	if err := a.Identity.Logout(context.Background(), admin.Token); err != nil {
		t.Fatal(err)
	}
	// The handler must stop even while content writes are backpressured. Hold
	// the client still and observe the server-side download slot release.
	start := time.Now()
	for {
		a.logDownloadMu.Lock()
		active := a.logDownloads
		a.logDownloadMu.Unlock()
		if active == 0 {
			break
		}
		if time.Since(start) > 3*time.Second {
			t.Fatalf("revoked download handler did not stop within the bound: %d active", active)
		}
		time.Sleep(10 * time.Millisecond)
	}
	readErr := error(nil)
	for {
		n, err := response.Body.Read(buffer)
		read += n
		if err != nil {
			readErr = err
			break
		}
		if time.Since(start) > 5*time.Second {
			t.Fatal("revoked download was not terminated")
		}
		time.Sleep(2 * time.Millisecond)
	}
	if readErr == nil || read >= len(content) {
		t.Fatalf("download continued after revocation: read=%d err=%v", read, readErr)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Fatalf("revocation was not applied within the bounded window: %v", elapsed)
	}
}

func TestLogExportDownloadConcurrencyLimit(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	exportID := "log-export-11111111111111111111111111111112"
	content := make([]byte, 2<<20)
	installReadyExport(t, a, string(admin.User.ID), exportID, content)
	request, _ := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	request.Header.Set("Authorization", "Bearer "+admin.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if _, err := response.Body.Read(make([]byte, 1024)); err != nil {
		t.Fatal(err)
	}
	second, _ := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	second.Header.Set("Authorization", "Bearer "+admin.Token)
	blocked, err := http.DefaultClient.Do(second)
	if err != nil {
		t.Fatal(err)
	}
	blocked.Body.Close()
	if blocked.StatusCode != 409 {
		t.Fatalf("concurrent same-user download was not rejected: %d", blocked.StatusCode)
	}
	response.Body.Close()
	time.Sleep(100 * time.Millisecond)
	third, _ := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	third.Header.Set("Authorization", "Bearer "+admin.Token)
	allowed, err := http.DefaultClient.Do(third)
	if err != nil {
		t.Fatal(err)
	}
	io.Copy(io.Discard, allowed.Body)
	allowed.Body.Close()
	if allowed.StatusCode != 200 {
		t.Fatalf("download slot was not released: %d", allowed.StatusCode)
	}
}

func TestLogExportDownloadStopsWhenRequestIsCanceled(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	exportID := "log-export-13131313131313131313131313131313"
	installReadyExport(t, a, string(admin.User.ID), exportID, make([]byte, 8<<20))
	ctx, cancel := context.WithCancel(context.Background())
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	request.Header.Set("Authorization", "Bearer "+admin.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if _, err := response.Body.Read(make([]byte, 1024)); err != nil {
		t.Fatal(err)
	}
	cancel()
	deadline := time.Now().Add(3 * time.Second)
	for {
		a.logDownloadMu.Lock()
		active := a.logDownloads
		a.logDownloadMu.Unlock()
		if active == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("canceled download handler remained active: %d", active)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func TestLogExportGCWaitsForActiveDownloadBeforeExpiry(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	exportID := "log-export-14141414141414141414141414141414"
	content := make([]byte, 8<<20)
	for index := range content {
		content[index] = byte(index)
	}
	installReadyExport(t, a, string(admin.User.ID), exportID, content)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	request.Header.Set("Authorization", "Bearer "+admin.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if _, err := response.Body.Read(make([]byte, 1024)); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		key, _ := corestore.LogTaskKey(exportID)
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
	task, _, _ := a.Store.LogExportTask(context.Background(), exportID)
	if task.State != "ready" {
		t.Fatalf("active download was expired by GC: %#v", task)
	}
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "runtime", "log-exports", exportID, "bundle.zip")); err != nil {
		t.Fatal("active download archive was removed")
	}
	cancel()
	deadline := time.Now().Add(3 * time.Second)
	for {
		a.logDownloadMu.Lock()
		active := a.logDownloads
		a.logDownloadMu.Unlock()
		if active == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("download slot not released")
		}
		time.Sleep(10 * time.Millisecond)
	}
	a.collectLogExportGarbage(context.Background())
	task, _, _ = a.Store.LogExportTask(context.Background(), exportID)
	if task.State != "expired" {
		t.Fatalf("expired result was not collected: %#v", task)
	}
}
