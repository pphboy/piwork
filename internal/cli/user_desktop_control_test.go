package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopControlRoutesForwardOnlyAllowedRequests(t *testing.T) {
	type forwarded struct {
		method string
		path   string
		body   map[string]any
		auth   string
	}
	var mu sync.Mutex
	var calls []forwarded
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" {
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"user"}`)
			return
		}
		body := map[string]any{}
		if r.Body != nil {
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		mu.Lock()
		calls = append(calls, forwarded{r.Method, r.URL.RequestURI(), body, r.Header.Get("Authorization")})
		mu.Unlock()
		_, _ = io.WriteString(w, `{"operationId":"operation-1","value":"ok"}`)
	}))
	defer core.Close()
	api, err := client.New(core.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	d := &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "credential.json")},
		port: 17891, origin: "http://desktop.localhost:17891", sessions: map[string]desktopSession{
			"local": {csrf: "csrf", end: time.Now().Add(time.Hour)},
		}, identity: desktopIdentity{coreURL: core.URL, credential: &client.Credential{
			Version: 1, CoreURL: core.URL, Token: "secret-core-token", ExpiresAt: "2099-01-01T00:00:00Z",
			User: client.Identity{ID: "user-1", Account: "owner", Role: "user"},
		}, checked: true}}
	request := func(method, path, payload, csrf string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, d.origin+path, strings.NewReader(payload))
		r.Header.Set("Cookie", d.cookieName()+"=local")
		r.Header.Set("Origin", d.origin)
		if payload != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		if csrf != "" {
			r.Header.Set("X-Piwork-Csrf", csrf)
		}
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	for _, item := range []struct {
		method, path, payload, forwarded string
	}{
		{"GET", "/_desktop/api/works", "", "/api/v1/works"},
		{"POST", "/_desktop/api/works", `{"name":"中文 Work"}`, "/api/v1/works"},
		{"POST", "/_desktop/api/works/work-1/start", "", "/api/v1/works/work-1/start"},
		{"GET", "/_desktop/api/works/work-1/services/svc-1/logs?tailLines=20", "", "/api/v1/works/work-1/services/svc-1/logs?tailLines=20"},
		{"POST", "/_desktop/api/works/work-1/services/svc-1/stop", "", "/api/v1/works/work-1/services/svc-1/disable"},
		{"GET", "/_desktop/api/works/work-1/packages/%40example%2Ftools", "", "/api/v1/works/work-1/packages/%40example%2Ftools"},
		{"PUT", "/_desktop/api/works/work-1/configuration/agents", `{"agentsMd":"# Agent"}`, "/api/v1/works/work-1/configuration/agents"},
		{"POST", "/_desktop/api/works/work-1/runs", `{"sessionId":"session-1","prompt":"你好"}`, "/api/v1/works/work-1/runs"},
	} {
		response := request(item.method, item.path, item.payload, "csrf")
		if response.Code != 200 && response.Code != 202 {
			t.Fatalf("%s %s returned %d: %s", item.method, item.path, response.Code, response.Body.String())
		}
		if strings.Contains(response.Body.String(), "secret-core-token") {
			t.Fatal("Core credential leaked to Desktop response")
		}
		mu.Lock()
		last := calls[len(calls)-1]
		mu.Unlock()
		if last.method != item.method || last.path != item.forwarded || last.auth != "Bearer secret-core-token" {
			t.Fatalf("wrong Core request: %+v", last)
		}
		if item.method == "POST" && item.path != "/_desktop/api/works/work-1/runs" {
			if key, _ := last.body["idempotencyKey"].(string); !strings.HasPrefix(key, "desktop-") {
				t.Fatalf("mutation has no idempotency key: %+v", last)
			}
		}
		if strings.HasSuffix(item.path, "/runs") {
			if key, _ := last.body["submissionKey"].(string); !strings.HasPrefix(key, "desktop-") {
				t.Fatalf("run has no submission key: %+v", last)
			}
		}
	}
	mu.Lock()
	before := len(calls)
	mu.Unlock()
	for _, item := range []struct{ method, path, payload, csrf string }{
		{"POST", "/_desktop/api/works", `{"name":"bad","idempotencyKey":"attacker"}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1", "", "csrf"},
		{"GET", "/_desktop/api/works/work-1/services/svc-1/logs?tailLines=201", "", ""},
		{"GET", "/_desktop/api/works/%2e%2e", "", ""},
		{"POST", "/_desktop/api/works/work-1/start", "", "wrong"},
	} {
		response := request(item.method, item.path, item.payload, item.csrf)
		if response.Code < 400 {
			t.Fatalf("invalid request accepted: %s %s %d", item.method, item.path, response.Code)
		}
	}
	mu.Lock()
	after := len(calls)
	mu.Unlock()
	if after != before {
		t.Fatalf("invalid Desktop request reached Core: %d -> %d", before, after)
	}
}
