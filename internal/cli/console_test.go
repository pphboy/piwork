package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestConsoleSessionCapacityExpiryAndTemporaryCoreFailure(t *testing.T) {
	mode, logouts, mutations := "ready", 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/login":
			io.WriteString(w, `{"token":"new-private-token","expiresAt":"2099-01-01T00:00:00Z","user":{"id":"owner","account":"admin","role":"admin"}}`)
		case "/api/v1/me":
			if mode == "offline" {
				w.WriteHeader(503)
				io.WriteString(w, `{"code":"UNAVAILABLE"}`)
				return
			}
			if mode == "revoked" {
				w.WriteHeader(401)
				io.WriteString(w, `{"code":"SESSION_REVOKED"}`)
				return
			}
			io.WriteString(w, `{"id":"owner","account":"admin","role":"admin"}`)
		case "/api/v1/admin/status":
			io.WriteString(w, `{"adminApiVersion":1}`)
		case "/api/v1/logout":
			logouts++
			w.WriteHeader(204)
		case "/api/v1/admin/users":
			if r.Method != "GET" {
				mutations++
			}
			io.WriteString(w, `{"users":[]}`)
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	c := &nativeConsole{options: consoleOptions{coreURL: core.URL, publicOrigin: "https://console.example:7173"}, sessions: map[string]consoleSession{}, challenges: map[string]consoleChallenge{}}
	now := time.Now()
	for i := 0; i < 1024; i++ {
		c.sessions[fmt.Sprint(i)] = consoleSession{token: "existing", csrf: "csrf", user: client.Identity{ID: "owner", Role: "admin"}, expiresAt: now.Add(time.Hour)}
	}
	call := func(method, path, body, cookie, csrf, origin string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, c.options.publicOrigin+path, strings.NewReader(body))
		r.Header.Set("Cookie", cookie)
		r.Header.Set("X-Csrf-Token", csrf)
		r.Header.Set("Origin", origin)
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		c.ServeHTTP(w, r)
		return w
	}
	login := func() *httptest.ResponseRecorder {
		c.challenges["login"] = consoleChallenge{csrf: "login-csrf", expiresAt: time.Now().Add(time.Minute)}
		return call("POST", "/console/api/login", `{"account":"admin","password":"fixture-password"}`, consoleLoginCookie+"=login", "login-csrf", c.options.publicOrigin)
	}
	if result := login(); result.Code != 503 || !strings.Contains(result.Body.String(), "CONSOLE_SESSION_CAPACITY") || strings.Contains(result.Body.String(), "new-private-token") || logouts != 1 || len(c.sessions) != 1024 {
		t.Fatal("capacity displaced a live session or retained a newly issued token", result.Code, result.Body.String(), logouts, len(c.sessions))
	}
	expired := c.sessions["0"]
	expired.expiresAt = now.Add(-time.Second)
	c.sessions["0"] = expired
	if result := login(); result.Code != 200 || len(c.sessions) != 1024 {
		t.Fatal("expired session was not reclaimed", result.Code, len(c.sessions))
	}
	for i := 0; i < 2048; i++ {
		c.challenges[fmt.Sprint(i)] = consoleChallenge{expiresAt: now.Add(time.Minute)}
	}
	if result := call("GET", "/console/api/session", "", "", "", ""); result.Code != 429 {
		t.Fatal("challenge capacity unbounded", result.Code)
	}
	c.challenges["0"] = consoleChallenge{expiresAt: now.Add(-time.Second)}
	if result := call("GET", "/console/api/session", "", "", "", ""); result.Code != 200 || len(c.challenges) != 2048 {
		t.Fatal("expired challenge not reclaimed", result.Code, len(c.challenges))
	}
	mode = "offline"
	for _, path := range []string{"/console/api/session", "/console/api/admin/users"} {
		if result := call("GET", path, "", consoleSessionCookie+"=1", "", ""); result.Code != 502 || !strings.Contains(result.Body.String(), "CORE_UNAVAILABLE") {
			t.Fatal("connection failure became logout", result.Code, result.Body.String())
		}
	}
	if _, retained := c.sessions["1"]; !retained {
		t.Fatal("temporary Core failure removed session")
	}
	mode = "ready"
	if result := call("GET", "/console/api/admin/users", "", consoleSessionCookie+"=1", "", ""); result.Code != 200 {
		t.Fatal("same cookie could not recover", result.Code)
	}
	for _, csrf := range []string{"", "other-session"} {
		if result := call("POST", "/console/api/admin/users", "{}", consoleSessionCookie+"=1", csrf, c.options.publicOrigin); result.Code != 403 {
			t.Fatal("CSRF rejection failed", result.Code)
		}
	}
	if mutations != 0 {
		t.Fatal("forged mutation reached Core")
	}
	if result := call("POST", "/console/api/logout", "{}", consoleSessionCookie+"=1", "csrf", c.options.publicOrigin); result.Code != 200 {
		t.Fatal(result.Code)
	}
	if result := call("GET", "/console/api/admin/users", "", consoleSessionCookie+"=2", "", ""); result.Code != 200 {
		t.Fatal("other browser was logged out", result.Code)
	}
	mode = "revoked"
	if result := call("GET", "/console/api/admin/users", "", consoleSessionCookie+"=2", "", ""); result.Code != 401 {
		t.Fatal(result.Code)
	}
	if _, retained := c.sessions["2"]; retained {
		t.Fatal("revoked session retained")
	}
}

func TestNativeConsoleBrowserAndAdministratorSession(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/readyz":
			_, _ = io.WriteString(w, `{"checks":{"administrator":true}}`)
		case "/api/v1/login":
			var input struct {
				Account  string `json:"account"`
				Password string `json:"password"`
			}
			_ = json.NewDecoder(r.Body).Decode(&input)
			if input.Password == "wrong" {
				w.WriteHeader(401)
				_, _ = io.WriteString(w, `{"code":"AUTHENTICATION_FAILED","message":"invalid"}`)
				return
			}
			role := "admin"
			if input.Account == "ordinary" {
				role = "user"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"token": "server-only-token", "expiresAt": "2099-01-01T00:00:00Z",
				"user": map[string]any{"id": "user-1", "account": input.Account, "role": role}})
		case "/api/v1/me":
			if r.Header.Get("Authorization") != "Bearer server-only-token" {
				t.Error("Console omitted Core bearer")
			}
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"admin"}`)
		case "/api/v1/admin/status":
			if r.Header.Get("Authorization") != "Bearer server-only-token" {
				t.Error("Console omitted Core administrator bearer")
			}
			_, _ = io.WriteString(w, `{"adminApiVersion":1,"ready":true}`)
		case "/api/v1/admin/users":
			if r.Header.Get("Authorization") != "Bearer server-only-token" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Csrf-Token") != "" {
				t.Error("Console leaked browser credentials to Core")
			}
			_, _ = io.WriteString(w, `{"users":[]}`)
		case "/api/v1/logout":
			w.WriteHeader(204)
		default:
			t.Error("unexpected Core route", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	c := &nativeConsole{options: consoleOptions{coreURL: core.URL, publicOrigin: "https://console.example:7173"}}
	call := func(method, path, body, cookie, csrf, origin string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, c.options.publicOrigin+path, strings.NewReader(body))
		if cookie != "" {
			r.Header.Set("Cookie", cookie)
		}
		if csrf != "" {
			r.Header.Set("X-Csrf-Token", csrf)
		}
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		if body != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		c.ServeHTTP(w, r)
		return w
	}
	if page := call("GET", "/", "", "", "", ""); page.Code != 200 || !strings.Contains(page.Body.String(), "PiWork Serve") {
		t.Fatal("embedded Console page failed", page.Code)
	}
	if module := call("GET", "/browser/package-phase.js", "", "", "", ""); module.Code != 200 || !strings.Contains(module.Body.String(), "Unrecognized phase") {
		t.Fatal("embedded package phase module failed", module.Code)
	}
	for _, path := range []string{"/login", "/users", "/runtime", "/default-work", "/skills", "/skills/example", "/packages", "/packages/example", "/packages/%40example%2Ftools", "/operations", "/operations/operation-1"} {
		if page := call("GET", path, "", "", "", ""); page.Code != 200 {
			t.Fatal("Console page is missing", path, page.Code)
		}
	}
	if availability := call("GET", "/console/api/availability", "", "", "", ""); availability.Code != 200 || !strings.Contains(availability.Body.String(), `"administratorInitialized":true`) {
		t.Fatal("Console availability failed", availability.Code, availability.Body.String())
	}
	if blocked := call("GET", "/console/api/admin/users", "", "", "", ""); blocked.Code != 401 {
		t.Fatal("anonymous Console admin route accepted", blocked.Code)
	}
	challenge := call("GET", "/console/api/session", "", "", "", "")
	if challenge.Code != 200 {
		t.Fatal("Console login challenge failed", challenge.Code)
	}
	var initial struct {
		CSRF string `json:"csrfToken"`
	}
	_ = json.Unmarshal(challenge.Body.Bytes(), &initial)
	loginCookie := strings.SplitN(challenge.Header().Get("Set-Cookie"), ";", 2)[0]
	if initial.CSRF == "" || loginCookie == "" || !strings.Contains(challenge.Header().Get("Set-Cookie"), "Secure; HttpOnly; SameSite=Strict") {
		t.Fatal("Console challenge omitted secure cookie or CSRF")
	}
	if denied := call("POST", "/console/api/login", `{"account":"owner","password":"password"}`, loginCookie, initial.CSRF, "https://evil.example"); denied.Code != 403 {
		t.Fatal("cross-origin Console login accepted", denied.Code)
	}
	if denied := call("POST", "/console/api/login", `{"account":"ordinary","password":"password"}`, loginCookie, initial.CSRF, c.options.publicOrigin); denied.Code != 403 {
		t.Fatal("ordinary user logged into Console", denied.Code)
	}
	logged := call("POST", "/console/api/login", `{"account":"owner","password":"password"}`, loginCookie, initial.CSRF, c.options.publicOrigin)
	if logged.Code != 200 || strings.Contains(logged.Body.String(), "server-only-token") {
		t.Fatal("Console administrator login failed or leaked bearer", logged.Code, logged.Body.String())
	}
	var session struct {
		CSRF string `json:"csrfToken"`
	}
	_ = json.Unmarshal(logged.Body.Bytes(), &session)
	var sessionCookie string
	for _, value := range logged.Header().Values("Set-Cookie") {
		if strings.HasPrefix(value, consoleSessionCookie+"=") {
			sessionCookie = strings.SplitN(value, ";", 2)[0]
		}
	}
	if sessionCookie == "" || session.CSRF == "" {
		t.Fatal("Console admin session missing")
	}
	restarted := &nativeConsole{options: c.options}
	restartRequest := httptest.NewRequest("GET", c.options.publicOrigin+"/console/api/admin/users", nil)
	restartRequest.Header.Set("Cookie", sessionCookie)
	restartResponse := httptest.NewRecorder()
	restarted.ServeHTTP(restartResponse, restartRequest)
	if restartResponse.Code != 401 {
		t.Fatal("Console restored a browser session after process restart", restartResponse.Code)
	}
	if users := call("GET", "/console/api/admin/users", "", sessionCookie, "", ""); users.Code != 200 || !strings.Contains(users.Body.String(), `"users":[]`) {
		t.Fatal("Console admin GET failed", users.Code, users.Body.String())
	}
	if denied := call("POST", "/console/api/logout", "{}", sessionCookie, "wrong", c.options.publicOrigin); denied.Code != 403 {
		t.Fatal("Console mutation accepted wrong CSRF", denied.Code)
	}
	if left := call("POST", "/console/api/logout", "{}", sessionCookie, session.CSRF, c.options.publicOrigin); left.Code != 200 {
		t.Fatal("Console logout failed", left.Code, left.Body.String())
	}
	if blocked := call("GET", "/console/api/admin/users", "", sessionCookie, "", ""); blocked.Code != 401 {
		t.Fatal("Console accepted expired local session", blocked.Code)
	}
	challenge = call("GET", "/console/api/session", "", "", "", "")
	_ = json.Unmarshal(challenge.Body.Bytes(), &initial)
	loginCookie = strings.SplitN(challenge.Header().Get("Set-Cookie"), ";", 2)[0]
	for attempt := 0; attempt < 5; attempt++ {
		if result := call("POST", "/console/api/login", `{"account":"owner","password":"wrong"}`, loginCookie, initial.CSRF, c.options.publicOrigin); result.Code != 401 {
			t.Fatal("failed Console login was not rejected", attempt, result.Code)
		}
	}
	if result := call("POST", "/console/api/login", `{"account":"owner","password":"wrong"}`, loginCookie, initial.CSRF, c.options.publicOrigin); result.Code != 429 {
		t.Fatal("Console login rate limit failed", result.Code)
	}
}

func TestNativeConsoleRejectsInvalidOriginAndTLSKey(t *testing.T) {
	for _, origin := range []string{"http://localhost:7173", "https://localhost:7174", "https://owner:pass@localhost:7173", "https://localhost:7173/path"} {
		if _, err := parseConsoleOptions([]string{"serve", "--listen", "127.0.0.1:7173", "--public-origin", origin,
			"--tls-cert", "missing", "--tls-key", "missing"}); err == nil {
			t.Fatal("invalid Console origin accepted", origin)
		}
	}
	root := t.TempDir()
	certificate, key := filepath.Join(root, "cert.pem"), filepath.Join(root, "key.pem")
	if err := os.WriteFile(certificate, []byte("invalid certificate"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(key, []byte("invalid key"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := parseConsoleOptions([]string{"serve", "--listen", "127.0.0.1:7173", "--public-origin", "https://localhost:7173",
		"--tls-cert", certificate, "--tls-key", key}); err == nil {
		t.Fatal("world-readable Console key accepted")
	}
	if _, err := parseConsoleOptions([]string{"serve", "--core", "http://public.example:7171", "--public-origin", "https://localhost:7173",
		"--tls-cert", certificate, "--tls-key", key}); err == nil {
		t.Fatal("non-loopback Core accepted")
	}
}
