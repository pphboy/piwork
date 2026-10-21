package coreapp

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"piwork/internal/identity"
)

func logExportHTTPFixture(t *testing.T) (*Application, string, identity.LoginResult, identity.LoginResult, identity.LoginResult) {
	t.Helper()
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"logs-admin", "development-fixture-pass"}}})
	ctx := context.Background()
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "logs-user", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "logs-admin-two", "development-fixture-pass", "admin"); err != nil {
		t.Fatal(err)
	}
	admin, err := a.Identity.Login(ctx, "logs-admin", "development-fixture-pass", "logs")
	if err != nil {
		t.Fatal(err)
	}
	user, err := a.Identity.Login(ctx, "logs-user", "development-fixture-pass", "logs")
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.Identity.Login(ctx, "logs-admin-two", "development-fixture-pass", "logs")
	if err != nil {
		t.Fatal(err)
	}
	return a, base, admin, user, other
}

func waitLogExportReady(t *testing.T, base, token, exportID string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		status, view := httpCall(t, base, "/api/v1/log-exports/"+exportID, "GET", "Bearer "+token, nil)
		if status != 200 {
			t.Fatalf("status query failed: %d %v", status, view)
		}
		switch view["state"] {
		case "ready":
			return view
		case "failed", "interrupted":
			t.Fatalf("export did not complete: %v", view)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("export did not become ready")
	return nil
}

func TestLogExportHTTPAuthorizationAcceptanceAndDownload(t *testing.T) {
	a, base, admin, user, other := logExportHTTPFixture(t)
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "export-content"})

	body := map[string]string{"idempotencyKey": "export-one"}
	status, accepted := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, body)
	if status != 202 {
		t.Fatalf("create failed: %d %v", status, accepted)
	}
	exportID, _ := accepted["exportId"].(string)
	if exportID == "" || accepted["reused"] != false || accepted["scope"].(map[string]any)["includeCoreLogs"] != true {
		t.Fatalf("unexpected acceptance: %v", accepted)
	}
	if status, _ := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+user.Token, map[string]string{"idempotencyKey": "user-key"}); status != 403 {
		t.Fatalf("ordinary user created an export: %d", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/log-exports/"+exportID, "GET", "Bearer "+other.Token, nil); status != 403 {
		t.Fatalf("another admin read the export: %d", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, map[string]string{"idempotencyKey": "bad", "ownerUserId": "user-2"}); status != 400 {
		t.Fatalf("unknown create field accepted: %d", status)
	}
	view := waitLogExportReady(t, base, admin.Token, exportID)
	if view["complete"] != true || view["warningCount"].(float64) != 0 {
		t.Fatalf("unexpected completed view: %v", view)
	}
	result := view["result"].(map[string]any)
	digest := result["digest"].(string)

	status, replay := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, body)
	if status != 202 || replay["exportId"] != exportID || replay["reused"] != true || replay["cutoffTime"] != accepted["cutoffTime"] {
		t.Fatalf("idempotent replay diverged: %d %v", status, replay)
	}

	request, err := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+exportID+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+admin.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "application/zip" || response.Header.Get("X-Piwork-SHA256") != digest || response.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("unexpected download headers: %d %v", response.StatusCode, response.Header)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	foundManifest, foundCore := false, false
	for _, file := range reader.File {
		if file.Name == "manifest.json" {
			foundManifest = true
			content, err := file.Open()
			if err != nil {
				t.Fatal(err)
			}
			manifestRaw, _ := io.ReadAll(content)
			content.Close()
			var manifest logManifest
			if err := json.Unmarshal(manifestRaw, &manifest); err != nil || manifest.ExportID != exportID || !manifest.Complete {
				t.Fatalf("invalid manifest: %s %v", manifestRaw, err)
			}
		}
		if bytes.HasPrefix([]byte(file.Name), []byte("core/")) {
			foundCore = true
		}
	}
	if !foundManifest || !foundCore {
		t.Fatalf("archive layout missing entries: %v", reader.File)
	}
	if status, _ := httpCall(t, base, "/api/v1/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "GET", "Bearer "+admin.Token, nil); status != 404 {
		t.Fatalf("unknown export did not return 404: %d", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/log-exports/"+exportID, "GET", "Bearer invalid", nil); status != 401 {
		t.Fatalf("invalid authentication did not return 401: %d", status)
	}
}

func TestLogExportReplayPrecedesCapacityAdmission(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	input := map[string]string{"idempotencyKey": "replay-before-capacity"}
	status, accepted := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, input)
	if status != 202 {
		t.Fatal(status, accepted)
	}
	exportID := accepted["exportId"].(string)
	waitLogExportReady(t, base, admin.Token, exportID)
	limits := defaultLogExportLimits()
	limits.areaLimit = 1
	a.logLimitsForTest = limits
	status, replayed := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, input)
	if status != 202 || replayed["exportId"] != exportID || replayed["reused"] != true {
		t.Fatalf("replay was blocked by capacity: %d %v", status, replayed)
	}
}

func TestLogExportAreaQuotaStopsPublication(t *testing.T) {
	a, base, admin, _, _ := logExportHTTPFixture(t)
	a.RecordAppEvent("test.export", "info", map[string]string{"marker": "area-quota"})
	limits := defaultLogExportLimits()
	limits.areaLimit = 1
	a.logLimitsForTest = limits
	status, accepted := httpCall(t, base, "/api/v1/log-exports", "POST", "Bearer "+admin.Token, map[string]string{"idempotencyKey": "area-quota"})
	if status != 503 || accepted["code"] != "LOG_EXPORT_STORAGE_UNAVAILABLE" {
		t.Fatalf("quota admission: %d %v", status, accepted)
	}
	tasks, err := a.Store.LogExportTasks(context.Background())
	if err != nil || len(tasks) != 0 {
		t.Fatalf("capacity rejection allocated a task: %v %v", tasks, err)
	}
}
