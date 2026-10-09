package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopEmbeddedBrowserAndLocalIdentity(t *testing.T) {
	var offlineLogout, revoked atomic.Bool
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/login":
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "core-token", "expiresAt": "2099-01-01T00:00:00Z", "user": map[string]any{"id": "user-1", "account": "owner", "role": "user"}})
		case "/api/v1/me":
			if r.Header.Get("Authorization") != "Bearer core-token" {
				t.Error("Desktop did not keep bearer on server")
			}
			if revoked.Load() {
				w.WriteHeader(401)
				_, _ = io.WriteString(w, `{"code":"AUTH_REQUIRED","message":"expired"}`)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "user-1", "account": "owner", "role": "user"})
		case "/api/v1/logout":
			if offlineLogout.Load() {
				w.WriteHeader(503)
				_, _ = io.WriteString(w, `{"code":"SERVICE_UNAVAILABLE","message":"offline"}`)
				return
			}
			w.WriteHeader(204)
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	api, err := client.New(core.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	store := client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}
	d := &nativeDesktop{api: api, store: store, port: 17891, origin: "http://desktop.localhost:17891",
		ticket: "ticket", ticketEnd: time.Now().Add(time.Minute), sessions: make(map[string]desktopSession),
		identity: desktopIdentity{coreURL: core.URL}}
	serve := func(method, path string, body io.Reader, cookie, csrf, origin string) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, "http://desktop.localhost:17891"+path, body)
		if cookie != "" {
			req.Header.Set("Cookie", cookie)
		}
		if csrf != "" {
			req.Header.Set("X-Piwork-Csrf", csrf)
		}
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		response := httptest.NewRecorder()
		d.ServeHTTP(response, req)
		return response
	}
	for path, fragment := range map[string]string{"/": "PiWork Desktop", "/style.css": "work-layout", "/desktop/browser/app.js": "adapter.initialize", "/desktop/browser/action-state.js": "renderActionStates", "/desktop/browser/files.js": "mountFiles", "/desktop/browser/configuration.js": "synchronizeConfiguration", "/desktop/browser/adapter.js": "If-None-Match"} {
		response := serve("GET", path, nil, "", "", "")
		if response.Code != 200 || !strings.Contains(response.Body.String(), fragment) {
			t.Fatal("embedded Desktop asset", path, response.Code)
		}
	}
	logoSource, err := os.ReadFile(filepath.Join("..", "..", "docs", "images", "piwork-logo.png"))
	if err != nil {
		t.Fatal(err)
	}
	logo := serve("GET", "/desktop/piwork-logo.png", nil, "", "", "")
	if logo.Code != 200 || logo.Header().Get("Content-Type") != "image/png" || !bytes.Equal(logo.Body.Bytes(), logoSource) {
		t.Fatal("anonymous embedded Logo differs from project PNG", logo.Code, logo.Header())
	}
	if missing := serve("GET", "/desktop/unknown-logo.png", nil, "", "", ""); missing.Code != 404 {
		t.Fatal("unknown PNG accepted", missing.Code)
	}
	badHost := httptest.NewRequest("GET", "http://desktop.localhost:17891/desktop/piwork-logo.png", nil)
	badHost.Host = "evil.example"
	denied := httptest.NewRecorder()
	d.ServeHTTP(denied, badHost)
	if denied.Code != 403 {
		t.Fatal("Logo bypassed Host boundary", denied.Code)
	}
	if response := serve("POST", "/_desktop/api/bootstrap", strings.NewReader(`{"ticket":"ticket"}`), "", "", "http://evil.example"); response.Code != 403 {
		t.Fatal("cross origin bootstrap accepted")
	}
	response := serve("POST", "/_desktop/api/bootstrap", strings.NewReader(`{"ticket":"ticket"}`), "", "", d.origin)
	if response.Code != 200 || !strings.Contains(response.Header().Get("Set-Cookie"), "HttpOnly; Secure; SameSite=Strict") {
		t.Fatal("bootstrap did not issue scoped cookie", response.Code, response.Header())
	}
	cookie := strings.SplitN(response.Header().Get("Set-Cookie"), ";", 2)[0]
	var authorized map[string]any
	if json.Unmarshal(response.Body.Bytes(), &authorized) != nil {
		t.Fatal("bootstrap JSON", response.Body.String())
	}
	csrf, _ := authorized["csrf"].(string)
	if csrf == "" {
		t.Fatal("bootstrap omitted CSRF")
	}
	if replay := serve("POST", "/_desktop/api/bootstrap", strings.NewReader(`{"ticket":"ticket"}`), "", "", d.origin); replay.Code != 403 {
		t.Fatal("bootstrap ticket replayed", replay.Code)
	}
	if unauthenticated := serve("GET", "/_desktop/api/session", nil, "", "", ""); unauthenticated.Code != 401 {
		t.Fatal("session available without local cookie")
	}
	if wrong := serve("POST", "/_desktop/api/login", strings.NewReader(`{"account":"owner","password":"pass"}`), cookie, "wrong", d.origin); wrong.Code != 403 {
		t.Fatal("Desktop mutation accepted wrong CSRF")
	}
	response = serve("GET", "/_desktop/api/session", nil, cookie, "", "")
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"state":"signed-out"`)) {
		t.Fatal("signed-out page unavailable", response.Code, response.Body.String())
	}
	response = serve("POST", "/_desktop/api/login", strings.NewReader(`{"account":"owner","password":"pass"}`), cookie, csrf, d.origin)
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"state":"authenticated"`)) {
		t.Fatal("Desktop login failed", response.Code, response.Body.String())
	}
	if _, err := store.Load(); err != nil {
		t.Fatal("Desktop did not save Core credential", err)
	}
	response = serve("POST", "/_desktop/api/logout", strings.NewReader(`{}`), cookie, csrf, d.origin)
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"remoteRevocationConfirmed":true`)) {
		t.Fatal("Desktop logout failed", response.Code, response.Body.String())
	}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal("Desktop retained logged-out Core credential", value, err)
	}
	response = serve("POST", "/_desktop/api/login", strings.NewReader(`{"account":"owner","password":"pass"}`), cookie, csrf, d.origin)
	if response.Code != 200 {
		t.Fatal("Desktop second login failed", response.Code)
	}
	offlineLogout.Store(true)
	response = serve("POST", "/_desktop/api/logout", strings.NewReader(`{}`), cookie, csrf, d.origin)
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"remoteRevocationConfirmed":false`)) {
		t.Fatal("offline logout concealed uncertainty", response.Code, response.Body.String())
	}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal("offline logout retained local token", value, err)
	}
	offlineLogout.Store(false)
	response = serve("POST", "/_desktop/api/login", strings.NewReader(`{"account":"owner","password":"pass"}`), cookie, csrf, d.origin)
	if response.Code != 200 {
		t.Fatal("Desktop third login failed", response.Code)
	}
	revoked.Store(true)
	response = serve("GET", "/_desktop/api/session", nil, cookie, "", "")
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"state":"signed-out"`)) || bytes.Contains(response.Body.Bytes(), []byte("core-token")) {
		t.Fatal("expired Core token remained authorized", response.Code, response.Body.String())
	}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal("expired Core token remained stored", value, err)
	}
	revoked.Store(false)
	response = serve("POST", "/_desktop/api/login", strings.NewReader(`{"account":"owner","password":"pass"}`), cookie, csrf, d.origin)
	if response.Code != 200 {
		t.Fatal("Desktop fourth login failed", response.Code)
	}
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("Desktop sent old Core token to a different Core")
		}
		w.WriteHeader(503)
	}))
	defer foreign.Close()
	response = serve("PUT", "/_desktop/api/connection", strings.NewReader(`{"coreUrl":"`+foreign.URL+`"}`), cookie, csrf, d.origin)
	if response.Code != 200 || !bytes.Contains(response.Body.Bytes(), []byte(`"state":"signed-out"`)) || !bytes.Contains(response.Body.Bytes(), []byte(foreign.URL)) {
		t.Fatal("Core switch retained old identity", response.Code, response.Body.String())
	}
	response = serve("GET", "/_desktop/api/session", nil, cookie, "", "http://evil.example")
	if response.Code != 403 {
		t.Fatal("cross-site session request accepted", response.Code)
	}
	id := strings.TrimPrefix(cookie, d.cookieName()+"=")
	d.mu.Lock()
	d.sessions[id] = desktopSession{csrf: csrf, end: time.Now().Add(-time.Second)}
	d.mu.Unlock()
	response = serve("GET", "/_desktop/api/session", nil, cookie, "", "")
	if response.Code != 401 {
		t.Fatal("expired local cookie remained valid", response.Code)
	}
}

func TestNativeDesktopRejectsUnsafeSharedCredentialStorage(t *testing.T) {
	for _, kind := range []string{"public-parent", "linked-parent"} {
		t.Run(kind, func(t *testing.T) {
			var revocations atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/v1/logout" {
					if r.Header.Get("Authorization") != "Bearer new-core-token" {
						t.Error("wrong cleanup token")
					}
					revocations.Add(1)
					w.WriteHeader(204)
					return
				}
				if r.Header.Get("Authorization") != "" {
					t.Error("login sent previous bearer")
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"token": "new-core-token", "expiresAt": "2099-01-01T00:00:00Z", "user": map[string]any{"id": "owner", "account": "owner", "role": "user"}})
			}))
			defer core.Close()
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			store := client.CredentialStore{Path: path}
			if err := store.Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "old-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(path)
			if kind == "public-parent" {
				makePublicFixtureDirectory(t, filepath.Dir(path))
			} else {
				link := filepath.Join(t.TempDir(), "linked")
				makeLinkedFixtureDirectory(t, filepath.Dir(path), link)
				store.Path = filepath.Join(link, "client.json")
			}
			d := &nativeDesktop{store: store, identity: desktopIdentity{coreURL: core.URL}}
			response := httptest.NewRecorder()
			request := httptest.NewRequest("POST", "http://desktop.localhost/_desktop/api/login", strings.NewReader(`{"account":"owner","password":"fixture"}`))
			request.Header.Set("Content-Type", "application/json")
			d.login(response, request, "csrf")
			after, err := os.ReadFile(path)
			if response.Code != 503 || !strings.Contains(response.Body.String(), "CREDENTIAL_STORAGE_UNAVAILABLE") || strings.Contains(response.Body.String(), "new-core-token") || d.identity.credential != nil || revocations.Load() != 1 || err != nil || !bytes.Equal(before, after) {
				t.Fatal("Desktop accepted unsafe shared store, leaked token or changed original credential", response.Code, err)
			}
		})
	}
}

func TestNativeDesktopOptionsAreValidatedBeforeCredentialAccess(t *testing.T) {
	for _, args := range [][]string{{"--port", "0"}, {"--port", "65536"}, {"--port"}, {"--port", "abc"}, {"--no-open", "--no-open"}} {
		if _, err := parseUserDesktopOptions(args); err == nil {
			t.Fatal("invalid Desktop options accepted", args)
		}
	}
	if options, err := parseUserDesktopOptions([]string{"--no-open", "--port", "18000"}); err != nil || options.port != 18000 || options.open {
		t.Fatal("valid Desktop options rejected", options, err)
	}
}
