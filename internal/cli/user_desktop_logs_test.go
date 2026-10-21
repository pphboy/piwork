package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func logDesktopFixture(t *testing.T, role string) (*nativeDesktop, *atomic.Int64) {
	t.Helper()
	var calls atomic.Int64
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/log-exports":
			if r.Header.Get("Authorization") != "Bearer core-token" {
				t.Error("Desktop did not use the current session credential")
			}
			w.WriteHeader(202)
			io.WriteString(w, `{"exportId":"log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","correlationId":"c","cutoffTime":"2026-10-21T00:00:00Z","state":"collecting","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"reused":false,"ownerUserId":"private"}`)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":
			io.WriteString(w, `{"exportId":"log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","state":"ready","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"cutoffTime":"2026-10-21T00:00:00Z","createdAt":"2026-10-21T00:00:00Z","updatedAt":"2026-10-21T00:00:01Z","progress":{"processedSources":0,"totalSources":0,"collectedBytes":0},"complete":true,"warningCount":0,"warnings":[],"warningsTruncated":false,"result":{"filename":"piwork-logs.zip","size":4,"digest":"`+strings.Repeat("a", 64)+`","readyAt":"2026-10-21T00:00:01Z","expiresAt":"2026-10-22T00:00:01Z"},"error":null,"cleanupPending":false,"internalToken":"private"}`)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/content":
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", "4")
			w.Header().Set("Content-Disposition", `attachment; filename="piwork-logs.zip"`)
			w.Header().Set("X-Piwork-SHA256", strings.Repeat("a", 64))
			w.Header().Set("Cache-Control", "no-store")
			w.Write([]byte("ZIP!"))
		default:
			t.Errorf("unexpected upstream request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(core.Close)
	record := client.Credential{Version: 1, CoreURL: core.URL, Token: "core-token", ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano), User: client.Identity{ID: "user-1", Account: "admin", Role: role}}
	d := &nativeDesktop{
		store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")},
		port:  17891, origin: "http://desktop.localhost:17891",
		sessions: map[string]desktopSession{"local": {id: "local", csrf: "csrf", end: time.Now().Add(time.Hour)}},
		identity: desktopIdentity{coreURL: core.URL, credential: &record, checked: true},
	}
	return d, &calls
}

func callDesktopLogs(d *nativeDesktop, method, path, body, csrf string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, "http://desktop.localhost:17891"+path, strings.NewReader(body))
	request.Header.Set("Origin", d.origin)
	request.Header.Set("Cookie", "__Host-piwork-desktop-17891=local")
	request.Header.Set("X-Piwork-Csrf", csrf)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	d.ServeHTTP(response, request)
	return response
}

func TestDesktopLogExportAdapterUsesSessionAndStripsPrivateFields(t *testing.T) {
	d, calls := logDesktopFixture(t, "admin")
	response := callDesktopLogs(d, http.MethodPost, "/_desktop/api/log-exports", `{"idempotencyKey":"desktop-key"}`, "csrf")
	if response.Code != 202 {
		t.Fatalf("create failed: %d %s", response.Code, response.Body.String())
	}
	if strings.Contains(response.Body.String(), "private") || strings.Contains(response.Body.String(), "core-token") {
		t.Fatalf("adapter leaked private fields: %s", response.Body.String())
	}
	var accepted map[string]any
	if json.Unmarshal(response.Body.Bytes(), &accepted) != nil || accepted["exportId"] == "" {
		t.Fatalf("invalid create response: %s", response.Body.String())
	}
	response = callDesktopLogs(d, http.MethodGet, "/_desktop/api/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "", "csrf")
	if response.Code != 200 || strings.Contains(response.Body.String(), "internalToken") || !strings.Contains(response.Body.String(), `"state":"ready"`) {
		t.Fatalf("status projection failed: %d %s", response.Code, response.Body.String())
	}
	response = callDesktopLogs(d, http.MethodGet, "/_desktop/api/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/content", "", "csrf")
	if response.Code != 200 || response.Body.String() != "ZIP!" || response.Header().Get("X-Piwork-SHA256") != strings.Repeat("a", 64) || response.Header().Get("Content-Type") != "application/zip" {
		t.Fatalf("content forwarding failed: %d %v", response.Code, response.Header())
	}
	if calls.Load() != 3 {
		t.Fatalf("unexpected upstream calls: %d", calls.Load())
	}

	response = callDesktopLogs(d, http.MethodPost, "/_desktop/api/log-exports", `{"idempotencyKey":"desktop-key"}`, "wrong")
	if response.Code != 403 || calls.Load() != 3 {
		t.Fatalf("missing CSRF reached Core: %d", response.Code)
	}
	response = callDesktopLogs(d, http.MethodPost, "/_desktop/api/log-exports", `{"idempotencyKey":"desktop-key","ownerUserId":"other"}`, "csrf")
	if response.Code != 400 || calls.Load() != 3 {
		t.Fatalf("unknown field accepted: %d", response.Code)
	}
}

func TestDesktopLogExportAdapterRejectsOrdinaryUsersBeforeCore(t *testing.T) {
	d, calls := logDesktopFixture(t, "user")
	response := callDesktopLogs(d, http.MethodPost, "/_desktop/api/log-exports", `{"idempotencyKey":"desktop-key"}`, "csrf")
	if response.Code != 403 || calls.Load() != 0 {
		t.Fatalf("ordinary user reached Core: %d %d", response.Code, calls.Load())
	}
	response = callDesktopLogs(d, http.MethodGet, "/_desktop/api/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/content", "", "csrf")
	if response.Code != 403 || calls.Load() != 0 {
		t.Fatalf("ordinary user downloaded content: %d", response.Code)
	}
}
