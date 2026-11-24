package consoleapp

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"piwork/internal/client"
)

func TestContentProxyRoutesAreExact(t *testing.T) {
	for _, test := range []struct {
		method, path string
		allowed      bool
	}{
		{"GET", "/skills/demo/files", true},
		{"GET", "/skills/demo/file", true},
		{"PUT", "/skills/demo/file", true},
		{"POST", "/skills/demo/file", false},
		{"DELETE", "/skills/demo/file", false},
		{"PUT", "/skills/demo/files", false},
		{"GET", "/skills/demo/file/extra", false},
		{"GET", "/skills/%2Fprivate/file", false},
		{"GET", "/skills/demo/arbitrary", false},
		{"POST", "/skills/demo/enable", true},
		{"PUT", "/skills/demo", true},
	} {
		if got := consoleAllowedAdmin(test.method, test.path); got != test.allowed {
			t.Fatalf("%s %s allowed=%v", test.method, test.path, got)
		}
	}
}

func contentHandler(t *testing.T, core http.Handler, role string) http.Handler {
	t.Helper()
	origin := "http://localhost:17891"
	server := httptest.NewServer(core)
	t.Cleanup(server.Close)
	return NewHostedHandler(HostedOptions{CoreURL: server.URL, Origin: func(*http.Request) string { return origin }, Resolve: func(*http.Request) (HostedSession, error) {
		return HostedSession{ID: "session", Token: "synthetic-token", CSRF: "synthetic-csrf", User: client.Identity{ID: "user", Role: role}}, nil
	}})
}

func contentRequest(handler http.Handler, method, path, contentType, body string, mutate func(*http.Request)) *httptest.ResponseRecorder {
	origin := "http://localhost:17891"
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, origin+path, reader)
	r.Header.Set("Origin", origin)
	r.Header.Set("X-Csrf-Token", "synthetic-csrf")
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if mutate != nil {
		mutate(r)
	}
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestContentProxyForwardsBoundedEnvelopeAndSinglePath(t *testing.T) {
	var seen atomic.Value
	core := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.Store(r.Method + " " + r.URL.Path + "?" + r.URL.RawQuery)
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/admin/skills/demo/file":
			if r.URL.Query().Get("path") != "references/rules.md" {
				t.Error("path query was not preserved", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"path": "references/rules.md", "content": strings.Repeat("a", 2<<20), "version": "v1"})
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/admin/skills/demo/files":
			_ = json.NewEncoder(w).Encode(map[string]any{"files": []any{map[string]any{"path": "SKILL.md", "size": 12}}})
		case r.Method == http.MethodPut && r.URL.Path == "/api/v1/admin/skills/demo/file":
			raw, err := io.ReadAll(r.Body)
			if err != nil || len(raw) < 1<<20 {
				t.Error("large JSON body was truncated", len(raw), err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"path": "SKILL.md", "version": "v2"})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
	handler := contentHandler(t, core, "admin")
	response := contentRequest(handler, http.MethodGet, "/console/api/admin/skills/demo/file?path=references%2Frules.md", "", "", nil)
	if response.Code != 200 || response.Header().Get("Cache-Control") != "no-store" || !strings.Contains(response.Body.String(), `"version":"v1"`) {
		t.Fatal("large content read was not forwarded", response.Code, response.Header(), response.Body.Len())
	}
	if seen.Load() != "GET /api/v1/admin/skills/demo/file?path=references%2Frules.md" {
		t.Fatal("Core did not receive the exact single path query", seen.Load())
	}
	body := `{"path":"SKILL.md","content":"` + strings.Repeat("b", 2<<20) + `","expectedVersion":"v1"}`
	response = contentRequest(handler, http.MethodPut, "/console/api/admin/skills/demo/file", "application/json", body, nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"version":"v2"`) {
		t.Fatal("large content save was not forwarded", response.Code, response.Body.String())
	}
	response = contentRequest(handler, http.MethodGet, "/console/api/admin/skills/demo/files", "", "", nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"files"`) {
		t.Fatal("file list was not forwarded", response.Code, response.Body.String())
	}
}

func TestContentProxyRejectsAmbiguousQueriesAndOtherLimits(t *testing.T) {
	var calls atomic.Int32
	core := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path == "/api/v1/admin/skills" {
			_, _ = w.Write([]byte(`{"skills":"` + strings.Repeat("x", (1<<20)+1) + `"}`))
			return
		}
		w.WriteHeader(http.StatusBadRequest)
	})
	handler := contentHandler(t, core, "admin")
	for _, query := range []string{"", "?path=", "?path=a&path=b", "?path=a&other=1", "?other=1", "?path=%zz"} {
		response := contentRequest(handler, http.MethodGet, "/console/api/admin/skills/demo/file"+query, "", "", nil)
		if response.Code != 400 || !strings.Contains(response.Body.String(), "INVALID_REQUEST") {
			t.Fatalf("ambiguous query %q was forwarded: %d %s", query, response.Code, response.Body.String())
		}
	}
	if calls.Load() != 0 {
		t.Fatal("ambiguous content query reached Core")
	}
	response := contentRequest(handler, http.MethodPut, "/console/api/admin/skills/demo", "application/json", `{"directoryName":"demo"}`, nil)
	if response.Code != 415 {
		t.Fatal("directory update stopped requiring multipart", response.Code)
	}
	response = contentRequest(handler, http.MethodGet, "/console/api/admin/skills", "", "", nil)
	if response.Code != 502 || !strings.Contains(response.Body.String(), "CORE_INVALID_RESPONSE") {
		t.Fatal("other admin responses gained the content envelope", response.Code, response.Body.String())
	}
	response = contentRequest(handler, http.MethodGet, "/console/api/admin/skills/demo/arbitrary", "", "", nil)
	if response.Code != 404 {
		t.Fatal("unknown admin path was proxied", response.Code)
	}
	response = contentRequest(handler, http.MethodPost, "/console/api/admin/skills/demo/file", "application/json", `{}`, nil)
	if response.Code != 404 {
		t.Fatal("unknown method was proxied", response.Code)
	}
}

func TestContentProxyKeepsSessionOriginAndRoleBoundaries(t *testing.T) {
	var calls atomic.Int32
	core := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"files":[]}`))
	})
	admin := contentHandler(t, core, "admin")
	response := contentRequest(admin, http.MethodPut, "/console/api/admin/skills/demo/file", "application/json", `{}`, func(r *http.Request) {
		r.Header.Set("Origin", "http://evil.invalid")
	})
	if response.Code != 403 || calls.Load() != 0 {
		t.Fatal("cross-origin content save reached Core", response.Code)
	}
	response = contentRequest(admin, http.MethodPut, "/console/api/admin/skills/demo/file", "application/json", `{}`, func(r *http.Request) {
		r.Header.Del("X-Csrf-Token")
	})
	if response.Code != 403 || calls.Load() != 0 {
		t.Fatal("content save without CSRF reached Core", response.Code)
	}
	user := contentHandler(t, core, "user")
	response = contentRequest(user, http.MethodGet, "/console/api/admin/skills/demo/files", "", "", nil)
	if response.Code != 403 || calls.Load() != 0 {
		t.Fatal("ordinary user reached content proxy", response.Code)
	}
	response = contentRequest(admin, http.MethodGet, "/console/api/admin/skills/demo/files", "", "", nil)
	if response.Code != 200 || calls.Load() != 1 {
		t.Fatal("authorized content read did not reach Core", response.Code, calls.Load())
	}
}

func TestContentProxyKeepsUnknownSaveResultDistinct(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connection, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		connection.Close()
	}))
	defer core.Close()
	origin := "http://localhost:17891"
	handler := NewHostedHandler(HostedOptions{CoreURL: core.URL, Origin: func(*http.Request) string { return origin }, Resolve: func(*http.Request) (HostedSession, error) {
		return HostedSession{ID: "session", Token: "synthetic-token", CSRF: "synthetic-csrf", User: client.Identity{ID: "user", Role: "admin"}}, nil
	}})
	response := contentRequest(handler, http.MethodPut, "/console/api/admin/skills/demo/file", "application/json", `{"path":"SKILL.md","content":"x","expectedVersion":"v"}`, nil)
	if response.Code != http.StatusBadGateway || !strings.Contains(response.Body.String(), "CORE_UNAVAILABLE") {
		t.Fatal("lost content save must remain an unknown result", response.Code, response.Body.String())
	}
}
