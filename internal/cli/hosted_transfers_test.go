package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"piwork/internal/client"
	"strings"
	"testing"
	"time"
)

func TestHostedInspectionIsPrivateToBrowserAndKnownOperationsToUser(t *testing.T) {
	content, err := os.ReadFile(filepath.Join("..", "workpackage", "testdata", "golden-native-pi-package.work"))
	if err != nil {
		t.Fatal(err)
	}
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/me" {
			t.Error("inspection contacted business Core", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		user := "owner"
		if strings.Contains(r.Header.Get("Authorization"), "other") {
			user = "other"
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"id": user, "account": user, "role": "user"})
	}))
	defer backend.Close()
	root := t.TempDir()
	create := func(user, session string) *HostedDesktop {
		h, err := NewHostedDesktop(HostedDesktopOptions{Origin: "http://127.0.0.1:7171", CookieName: "hosted", SessionID: session, CSRF: "csrf-" + session, StateDirectory: filepath.Join(root, "sessions", session), RecordDirectory: filepath.Join(root, "users", user), Credential: client.Credential{Version: 1, CoreURL: backend.URL, Token: user + session, ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano), User: client.Identity{ID: user, Account: user, Role: "user"}}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(h.Close)
		return h
	}
	first, second, other := create("owner", "first"), create("owner", "second"), create("other", "third")
	call := func(h *HostedDesktop, method, path string, body []byte) *httptest.ResponseRecorder {
		options := h.desktop.hosted
		r := httptest.NewRequest(method, options.Origin+"/_desktop/api/"+path, bytes.NewReader(body))
		r.Header.Set("Origin", options.Origin)
		r.Header.Set("Cookie", options.CookieName+"="+options.SessionID)
		r.Header.Set("X-Piwork-Csrf", options.CSRF)
		r.Header.Set("Content-Type", workPackageMIME)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	inspected := call(first, "POST", "work-packages", content)
	if inspected.Code != 200 {
		t.Fatal("hosted inspection failed", inspected.Code)
	}
	var value struct{ TransferID string }
	if json.Unmarshal(inspected.Body.Bytes(), &value) != nil || value.TransferID == "" {
		t.Fatal("missing inspection identifier")
	}
	for _, h := range []*HostedDesktop{second, other} {
		for _, method := range []string{"GET", "DELETE"} {
			if r := call(h, method, "work-packages/"+value.TransferID, nil); r.Code != 404 {
				t.Fatal("inspection crossed browser identity", method, r.Code)
			}
		}
	}
	if r := call(first, "GET", "work-packages/"+value.TransferID, nil); r.Code != 200 {
		t.Fatal("other session cleanup affected owner", r.Code)
	}
	payload := json.RawMessage(`{"operationId":"operation-owned","workId":"work-owned"}`)
	if err := first.desktop.operationRecords().accept(first.desktop.identity.coreURL, "owner", "Work action", payload); err != nil {
		t.Fatal(err)
	}
	same, err := second.desktop.operationRecords().list(second.desktop.identity.coreURL, "owner")
	if err != nil || len(same) != 1 {
		t.Fatal("same user cannot recover known operation", err, len(same))
	}
	distinct, err := other.desktop.operationRecords().list(other.desktop.identity.coreURL, "other")
	if err != nil || len(distinct) != 0 {
		t.Fatal("known operation crossed user", err)
	}
	if err := first.desktop.operationRecords().observeTerminal(first.desktop.identity.coreURL, "owner", "operation-owned", json.RawMessage(`{"operationId":"operation-owned","workId":"work-owned","kind":"start-work","state":"failed"}`)); err != nil {
		t.Fatal(err)
	}
	known := call(second, "GET", "known-operations", nil)
	var restored struct {
		Operations []struct {
			OperationID       string `json:"operationId"`
			Terminal          bool   `json:"terminal"`
			TerminalState     string `json:"terminalState"`
			TerminalCheckedAt string `json:"terminalCheckedAt"`
		}
	}
	if known.Code != 200 || json.Unmarshal(known.Body.Bytes(), &restored) != nil || len(restored.Operations) != 1 || !restored.Operations[0].Terminal || restored.Operations[0].TerminalState != "failed" || restored.Operations[0].TerminalCheckedAt == "" {
		t.Fatal("terminal hint not exposed to same user", known.Code, known.Body.String())
	}
	first.Close()
	if _, err := os.Stat(filepath.Join(root, "sessions", "first", "desktop-transfers-go", value.TransferID)); !os.IsNotExist(err) {
		t.Fatal("closed session retained upload spool")
	}
	if r := call(first, "GET", "work-packages/"+value.TransferID, nil); r.Code != 401 {
		raw, _ := io.ReadAll(r.Body)
		t.Fatal("closed browser retained inspection", r.Code, string(raw))
	}
}

func TestHostedHTTPSFileDestinationKeepsExactOriginAndWork(t *testing.T) {
	const origin = "https://[2001:db8::1]:7171"
	valid := origin + "/_desktop/files/works/work-12345678-1234-1234-1234-123456789012/files/next.txt"
	if value, err := desktopFileDestination(valid, "work-12345678-1234-1234-1234-123456789012", origin); err != nil || value != "/api/v1/works/work-12345678-1234-1234-1234-123456789012/files/next.txt" {
		t.Fatal("HTTPS destination rejected", value, err)
	}
	for _, value := range []string{"http://[2001:db8::1]:7171/_desktop/files/works/work-12345678-1234-1234-1234-123456789012/files/next.txt", "https://[2001:db8::1]:7172/_desktop/files/works/work-12345678-1234-1234-1234-123456789012/files/next.txt", origin + "/_desktop/files/works/work-22345678-1234-1234-1234-123456789012/files/next.txt", valid + "?query=1"} {
		if _, err := desktopFileDestination(value, "work-12345678-1234-1234-1234-123456789012", origin); err == nil {
			t.Fatal("file destination escaped origin/Work")
		}
	}
}
