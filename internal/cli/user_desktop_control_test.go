package cli

import (
	"context"
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

func TestDesktopNameConflictProjectsOnlySafeNameField(t *testing.T) {
	for _, path := range []string{"/api/v1/works", "/api/v1/work-imports"} {
		for _, field := range []any{"name", "configuration.secret", "../private", 42, nil} {
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(409)
				_ = json.NewEncoder(w).Encode(map[string]any{"code": "WORK_NAME_CONFLICT", "message": "Choose a different Work name.", "field": field, "requestJson": "PRIVATE-CONTENT", "stack": "/private/host/path"})
			}))
			api, err := client.New(core.URL, "")
			if err != nil {
				t.Fatal(err)
			}
			err = api.Request(context.Background(), "POST", path, map[string]string{"name": "Taken"}, nil)
			core.Close()
			if err == nil {
				t.Fatal("expected Core rejection")
			}
			response := httptest.NewRecorder()
			desktopControlFailure(response, err)
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if response.Code != 409 || body["code"] != "WORK_NAME_CONFLICT" || body["message"] != "Choose a different Work name." || (body["field"] == "name") != (field == "name") {
				t.Fatal(path, field, response.Code, body)
			}
			if strings.Contains(response.Body.String(), "PRIVATE") || strings.Contains(response.Body.String(), "private") || len(body) != 2 && len(body) != 3 {
				t.Fatal("unsafe error details forwarded", body)
			}
		}
	}
}

func TestNativeDesktopTemporaryCleanupReads(t *testing.T) {
	for _, item := range []struct {
		suffix string
		status int
	}{
		{"/temporary-cleanups/service-1", 200},
		{"/temporary-cleanups?runId=run-1", 200},
		{"/temporary-cleanups/service-1", 403},
		{"/temporary-cleanups?runId=run-1", 403},
	} {
		t.Run(item.suffix+http.StatusText(item.status), func(t *testing.T) {
			suffix := item.suffix
			var forwarded string
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/me" {
					_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"user"}`)
					return
				}
				if r.Method != http.MethodGet || r.Header.Get("Authorization") != "Bearer synthetic-token" {
					t.Errorf("unexpected forwarding method or authentication")
				}
				forwarded = r.URL.RequestURI()
				if item.status == http.StatusForbidden {
					w.WriteHeader(http.StatusForbidden)
					_, _ = io.WriteString(w, `{"code":"PERMISSION_DENIED","message":"Access denied"}`)
					return
				}
				_, _ = io.WriteString(w, `{"items":[],"truncated":false}`)
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
					Version: 1, CoreURL: core.URL, Token: "synthetic-token", ExpiresAt: "2099-01-01T00:00:00Z",
					User: client.Identity{ID: "user-1", Account: "owner", Role: "user"},
				}, checked: true}}
			r := httptest.NewRequest(http.MethodGet, d.origin+"/_desktop/api/works/work-1"+suffix, nil)
			r.Header.Set("Cookie", d.cookieName()+"=local")
			r.Header.Set("Origin", d.origin)
			response := httptest.NewRecorder()
			d.ServeHTTP(response, r)
			if response.Code != item.status || forwarded != "/api/v1/works/work-1"+suffix {
				t.Fatalf("cleanup read returned %d: %s; forwarded %q", response.Code, response.Body.String(), forwarded)
			}
			if strings.Contains(response.Body.String(), "synthetic-token") {
				t.Fatal("Core credential leaked")
			}
			for _, boundary := range []string{"missing-session", "foreign-origin"} {
				forwarded = ""
				r := httptest.NewRequest(http.MethodGet, d.origin+"/_desktop/api/works/work-1"+suffix, nil)
				if boundary == "foreign-origin" {
					r.Header.Set("Cookie", d.cookieName()+"=local")
					r.Header.Set("Origin", "http://foreign.invalid")
				}
				response := httptest.NewRecorder()
				d.ServeHTTP(response, r)
				if response.Code < 400 || forwarded != "" {
					t.Fatalf("%s bypassed local boundary: %d, forwarded %q", boundary, response.Code, forwarded)
				}
			}
		})
	}
}

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
		{"GET", "/_desktop/api/works/work-1/runs/active", "", "/api/v1/works/work-1/runs/active"},
		{"POST", "/_desktop/api/works/work-1/runs", `{"sessionId":"session-1","prompt":"next","submissionKey":"replace-1","inputMode":"text","cancelRunId":"run-old"}`, "/api/v1/works/work-1/runs"},
		{"GET", "/_desktop/api/works", "", "/api/v1/works"},
		{"POST", "/_desktop/api/works", `{"name":"中文 Work"}`, "/api/v1/works"},
		{"POST", "/_desktop/api/works/work-1/start", "", "/api/v1/works/work-1/start"},
		{"GET", "/_desktop/api/works/work-1/services/svc-1/logs?tailLines=20", "", "/api/v1/works/work-1/services/svc-1/logs?tailLines=20"},
		{"POST", "/_desktop/api/works/work-1/services/svc-1/stop", "", "/api/v1/works/work-1/services/svc-1/disable"},
		{"GET", "/_desktop/api/works/work-1/packages/%40example%2Ftools", "", "/api/v1/works/work-1/packages/%40example%2Ftools"},
		{"PUT", "/_desktop/api/works/work-1/configuration/agents", `{"agentsMd":"# Agent"}`, "/api/v1/works/work-1/configuration/agents"},
		{"GET", "/_desktop/api/works/work-1/models", "", "/api/v1/works/work-1/models"},
		{"GET", "/_desktop/api/works/work-1/chat-capabilities", "", "/api/v1/works/work-1/chat-capabilities"},
		{"GET", "/_desktop/api/works/work-1/session-management-capabilities", "", "/api/v1/works/work-1/session-management-capabilities"},
		{"GET", "/_desktop/api/works/work-1/sessions/session-1/management", "", "/api/v1/works/work-1/sessions/session-1/management"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/name", `{"operationKey":"rename-key","expectedRevision":0,"title":"新名称"}`, "/api/v1/works/work-1/sessions/session-1/name"},
		{"POST", "/_desktop/api/works/work-1/sessions/session-1/delete", `{"operationKey":"delete-key","expectedRevision":1}`, "/api/v1/works/work-1/sessions/session-1/delete"},
		{"POST", "/_desktop/api/works/work-1/sessions/session-1/auto-name", `{"operationKey":"auto-key","expectedRevision":1}`, "/api/v1/works/work-1/sessions/session-1/auto-name"},
		{"GET", "/_desktop/api/works/work-1/sessions/session-1/management-operations/delete-key", "", "/api/v1/works/work-1/sessions/session-1/management-operations/delete-key"},
		{"GET", "/_desktop/api/works/work-1/chat-models", "", "/api/v1/works/work-1/chat-models"},
		{"GET", "/_desktop/api/works/work-1/commands", "", "/api/v1/works/work-1/commands"},
		{"GET", "/_desktop/api/works/work-1/sessions/session-1/chat-options", "", "/api/v1/works/work-1/sessions/session-1/chat-options"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":"high"}`, "/api/v1/works/work-1/sessions/session-1/chat-options"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":"high","thinkingProfile":"responses-effort-v1"}`, "/api/v1/works/work-1/sessions/session-1/chat-options"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":null,"thinkingProfile":null}`, "/api/v1/works/work-1/sessions/session-1/chat-options"},
		{"GET", "/_desktop/api/works/work-1/sessions/submissions/original-key", "", "/api/v1/works/work-1/sessions/submissions/original-key"},
		{"GET", "/_desktop/api/works/work-1/runs/submissions/original-key", "", "/api/v1/works/work-1/runs/submissions/original-key"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/model", `{"modelRef":null}`, "/api/v1/works/work-1/sessions/session-1/model"},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1/retry-submission?submissionKey=original", "", "/api/v1/works/work-1/agent-requests/request-1/retry-submission?submissionKey=original"},
		{"GET", "/_desktop/api/works/work-1/agent-requests?serviceName=todo&limit=5", "", "/api/v1/works/work-1/agent-requests?limit=5&serviceName=todo"},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1?cursor=page-1", "", "/api/v1/works/work-1/agent-requests/request-1?cursor=page-1"},
		{"GET", "/_desktop/api/works/work-1/evidence/evidence-1", "", "/api/v1/works/work-1/evidence/evidence-1"},
		{"POST", "/_desktop/api/works/work-1/agent-requests/request-1/retry", `{"submissionKey":"original-retry-key"}`, "/api/v1/works/work-1/agent-requests/request-1/retry"},
		{"POST", "/_desktop/api/works/work-1/agent-requests/request-1/cancel", `{}`, "/api/v1/works/work-1/agent-requests/request-1/cancel"},
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
		if item.method == "PATCH" && strings.HasSuffix(item.path, "/chat-options") {
			var expected map[string]any
			if err := json.Unmarshal([]byte(item.payload), &expected); err != nil {
				t.Fatal(err)
			}
			want, present := expected["thinkingProfile"]
			got, forwarded := last.body["thinkingProfile"]
			if forwarded != present || got != want {
				t.Fatalf("profile was not forwarded intact: %+v", last.body)
			}
		}
		if strings.HasSuffix(item.path, "/sessions/session-1/name") || strings.HasSuffix(item.path, "/sessions/session-1/delete") || strings.HasSuffix(item.path, "/sessions/session-1/auto-name") {
			var expected map[string]any
			if err := json.Unmarshal([]byte(item.payload), &expected); err != nil || last.body["operationKey"] != expected["operationKey"] || last.body["expectedRevision"] != expected["expectedRevision"] {
				t.Fatalf("original Session operation identity changed: %+v", last.body)
			}
		}
		if item.method == "POST" && item.path != "/_desktop/api/works/work-1/runs" && !strings.Contains(item.path, "/agent-requests/") && !strings.HasSuffix(item.path, "/sessions/session-1/delete") && !strings.HasSuffix(item.path, "/sessions/session-1/auto-name") {
			if key, _ := last.body["idempotencyKey"].(string); !strings.HasPrefix(key, "desktop-") {
				t.Fatalf("mutation has no idempotency key: %+v", last)
			}
		}
		if strings.HasSuffix(item.path, "/runs") {
			key, _ := last.body["submissionKey"].(string)
			if target, present := last.body["cancelRunId"]; present {
				if target != "run-old" || key != "replace-1" {
					t.Fatal("explicit replacement identity changed", last.body)
				}
			} else if !strings.HasPrefix(key, "desktop-") {
				t.Fatalf("run has no submission key: %+v", last)
			}
		}
	}
	mu.Lock()
	before := len(calls)
	mu.Unlock()
	for _, item := range []struct{ method, path, payload, csrf string }{
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups?runId=", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups?unexpected=run-1", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups?runId=run-1&runId=run-2", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups?runId=../run-1", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups?runId=%252f", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups?runId=run-1&%broken", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups/service-1?unknown=true", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups/%2e%2e", "", ""},
		{"GET", "/_desktop/api/works/work-1/temporary-cleanups/service%2fother", "", ""},
		{"GET", "/_desktop/api/works/%2e%2e/temporary-cleanups/service-1", "", ""},
		{"POST", "/_desktop/api/works/work-1/temporary-cleanups/service-1", "", "csrf"},
		{"DELETE", "/_desktop/api/works/work-1/temporary-cleanups?runId=run-1", "", "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/model", `{"modelRef":null,"credential":"not-allowed"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/name", `{"operationKey":"key","expectedRevision":-1,"title":"name"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/name", `{"operationKey":"key","expectedRevision":0,"title":"name","credential":"private"}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1/sessions/session-1/delete", `{"operationKey":"key","expectedRevision":0,"extra":true}`, "csrf"},
		{"GET", "/_desktop/api/works/work-1/sessions/session-1/management-operations/%2e%2e", "", ""},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":"invalid"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":null,"thinkingProfile":"messages-adaptive-v1"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":"max","thinkingProfile":"messages-budget-v1"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":"high","thinkingProfile":"unknown"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/chat-options", `{"modelRef":null,"thinkingLevel":"off","credential":"private"}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1/runs", `{"sessionId":"session-1","prompt":"hello","inputMode":"extension"}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1/runs", `{"sessionId":"session-1","prompt":"next","cancelRunId":""}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1/runs", `{"sessionId":"session-1","prompt":"next","cancelRunId":"../other"}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1/runs", `{"sessionId":"session-1","prompt":"next","cancelRunId":null}`, "csrf"},
		{"POST", "/_desktop/api/works/work-1/sessions", `{"idempotencyKey":"../invalid"}`, "csrf"},
		{"PATCH", "/_desktop/api/works/work-1/sessions/session-1/model", `{"modelRef":null}`, "wrong"},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1/retry-submission?submissionKey=a&%broken", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1/retry-submission", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1/retry-submission?submissionKey=", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1/retry-submission?submissionKey=a&submissionKey=b", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests?limit=101", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests?limit=1&limit=2", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests/request-1?serviceName=todo", "", ""},
		{"GET", "/_desktop/api/works/work-1/agent-requests?unknown=true", "", ""},
		{"POST", "/_desktop/api/works/work-1/agent-requests/request-1/retry", `{"idempotencyKey":"invented"}`, "csrf"},
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

func TestDesktopChatOriginalKeysAndInputMode(t *testing.T) {
	for _, kind := range []string{"sessions", "runs"} {
		body := `{"idempotencyKey":"original.key:1"}`
		if kind == "runs" {
			body = `{"sessionId":"session-1","prompt":"/skill:sample parameters","submissionKey":"original.key:1","inputMode":"command"}`
		}
		r := httptest.NewRequest("POST", "http://desktop.localhost/_desktop/api/works/work-1/"+kind, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		plan, handled, err := planDesktopControl(r)
		if err != nil || !handled {
			t.Fatal(plan, err)
		}
		raw, _ := json.Marshal(plan.input)
		var value map[string]any
		json.Unmarshal(raw, &value)
		if kind == "sessions" && value["idempotencyKey"] != "original.key:1" || kind == "runs" && (value["submissionKey"] != "original.key:1" || value["inputMode"] != "command") {
			t.Fatal("original key changed", value)
		}
	}
}
