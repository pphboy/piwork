package webapp

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/coreapp"
	"piwork/internal/distribution"
	"piwork/internal/identity"
)

func fixture(t *testing.T) (*Server, *coreapp.Application, string) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	directory := t.TempDir()
	core, err := coreapp.New(ctx, coreapp.Options{DataDirectory: directory})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	var web *Server
	bound, err := core.ListenWithHandler(coreapp.ListenAddress{Host: "127.0.0.1", Port: 0}, func(bound coreapp.ListenAddress, handler http.Handler) (http.Handler, error) {
		var err error
		web, err = New(ctx, Options{Origin: bound.URL(), DataDirectory: directory, Core: core, Handler: handler})
		return web, err
	}, nil)
	if err != nil {
		cancel()
		_ = core.Close(context.Background())
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cancel()
		web.Close()
		ctx, end := context.WithTimeout(context.Background(), 5*time.Second)
		defer end()
		if err := core.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return web, core, bound.URL()
}

func browser(t *testing.T) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	return &http.Client{Jar: jar, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func call(t *testing.T, browser *http.Client, origin, path, method, csrf string, body any) (int, map[string]any, *http.Response) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	r, err := http.NewRequest(method, origin+path, reader)
	if err != nil {
		t.Fatal(err)
	}
	if method != "GET" {
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Piwork-Csrf", csrf)
		r.Header.Set("X-Csrf-Token", csrf)
		r.Header.Set("Content-Type", "application/json")
	}
	response, err := browser.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	_ = json.Unmarshal(data, &value)
	return response.StatusCode, value, response
}

func signIn(t *testing.T, browser *http.Client, origin, account string) string {
	t.Helper()
	code, challenge, _ := call(t, browser, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 {
		t.Fatal("login challenge unavailable", code)
	}
	code, value, response := call(t, browser, origin, "/_web/api/login", "POST", challenge["csrfToken"].(string), map[string]string{"account": account, "password": "synthetic-password"})
	if code != 200 || value["authenticated"] != true {
		t.Fatal("login rejected", code, value)
	}
	for _, cookie := range response.Cookies() {
		if cookie.Value != "" && (!cookie.HttpOnly || cookie.Secure || strings.HasPrefix(cookie.Name, "__Host-")) {
			t.Fatal("HTTP login cookie invalid")
		}
	}
	if _, ok := value["token"]; ok {
		t.Fatal("Core token reached browser")
	}
	return value["csrfToken"].(string)
}

func TestFirstUserSetupIsScopedOneUseAndClosedAfterBootstrap(t *testing.T) {
	s, core, origin := fixture(t)
	browser := browser(t)
	link, err := s.SetupLink(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(link)
	proof := strings.TrimPrefix(parsed.Fragment, "setup=")
	code, state, _ := call(t, browser, origin, "/_web/api/state", "GET", "", nil)
	if code != 200 || state["administratorInitialized"] != false || strings.Contains(fmtJSON(state), proof) {
		t.Fatal("public state exposed setup authorization")
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", "", map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 403 {
		t.Fatal("anonymous bootstrap accepted", code)
	}
	code, redeemed, response := call(t, browser, origin, "/_web/api/setup/redeem", "POST", "", map[string]string{"proof": proof})
	if code != 200 {
		t.Fatal("valid setup link rejected", code, redeemed)
	}
	for _, cookie := range response.Cookies() {
		if !cookie.HttpOnly || cookie.Secure {
			t.Fatal("setup cookie unsafe for HTTP")
		}
	}
	csrf := redeemed["csrfToken"].(string)
	code, _, _ = call(t, browser, origin, "/_web/api/setup/redeem", "POST", "", map[string]string{"proof": proof})
	if code != 403 {
		t.Fatal("setup proof replay accepted", code)
	}
	code, resumed, _ := call(t, browser, origin, "/_web/api/setup/session", "GET", "", nil)
	if code != 200 || resumed["csrfToken"] != csrf {
		t.Fatal("setup cannot resume after refresh")
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", "wrong", map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 403 {
		t.Fatal("setup mutation skipped CSRF", code)
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", csrf, map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 201 {
		t.Fatal("valid setup failed", code)
	}
	if _, err := s.SetupLink(context.Background()); err == nil {
		t.Fatal("bootstrap reopened after first user")
	}
	if hasUsers, err := core.Identity.HasUsers(context.Background()); err != nil || !hasUsers {
		t.Fatal("first user not durable", err)
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", csrf, map[string]string{"account": "second", "password": "synthetic-password"})
	if code != 409 {
		t.Fatal("old setup grant still works", code)
	}
	code, _, _ = call(t, browser, origin, "/healthz", "GET", "", nil)
	if code != 200 {
		t.Fatal("unconfigured app is not alive")
	}
	code, _, _ = call(t, browser, origin, "/readyz", "GET", "", nil)
	if code != 503 {
		t.Fatal("unconfigured app falsely ready", code)
	}
}

func TestWebAndOperatorBootstrapAtMostOneUser(t *testing.T) {
	s, core, origin := fixture(t)
	browser := browser(t)
	link, _ := s.SetupLink(context.Background())
	parsed, _ := url.Parse(link)
	_, redeemed, _ := call(t, browser, origin, "/_web/api/setup/redeem", "POST", "", map[string]string{"proof": strings.TrimPrefix(parsed.Fragment, "setup=")})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = core.Identity.Bootstrap(context.Background(), "operator-admin", "synthetic-password")
	}()
	code, _, _ := call(t, browser, origin, "/_web/api/setup/administrator", "POST", redeemed["csrfToken"].(string), map[string]string{"account": "web-admin", "password": "synthetic-password"})
	wg.Wait()
	if code != 201 && code != 409 {
		t.Fatal("unexpected concurrent bootstrap result", code)
	}
	users, err := core.Identity.ListUsers(context.Background(), identity.OperatorPrincipal())
	if err != nil || len(users) != 1 {
		t.Fatal("concurrent bootstrap created multiple users", err)
	}
}

func TestHostedSessionsIsolateUsersAndRejectServiceOrigin(t *testing.T) {
	s, core, origin := fixture(t)
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	if _, err := core.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "user", "synthetic-password", "user"); err != nil {
		t.Fatal(err)
	}
	first, second, user := browser(t), browser(t), browser(t)
	csrf := signIn(t, first, origin, "admin")
	signIn(t, second, origin, "admin")
	signIn(t, user, origin, "user")
	code, _, _ := call(t, user, origin, "/console/api/admin/users", "GET", "", nil)
	if code != 403 {
		t.Fatal("ordinary user entered administration", code)
	}
	code, _, _ = call(t, first, origin, "/console/api/admin/users", "GET", "", nil)
	if code != 200 {
		t.Fatal("shared administrator session unavailable", code)
	}
	request, _ := http.NewRequest("GET", origin+"/_desktop/api/works", nil)
	request.Header.Set("Origin", "http://127.0.0.1:17891")
	response, err := first.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("Service origin reached workbench content", response.StatusCode)
	}
	s.mu.Lock()
	if len(s.sessions) != 3 {
		s.mu.Unlock()
		t.Fatal("browser identities were shared")
	}
	for _, ss := range s.sessions {
		if _, err := os.Stat(filepath.Join(ss.stateDirectory, "browser.json")); !os.IsNotExist(err) {
			s.mu.Unlock()
			t.Fatal("hosted session wrote CLI credentials")
		}
	}
	s.mu.Unlock()
	code, _, _ = call(t, first, origin, "/_web/api/logout", "POST", csrf, map[string]string{})
	if code != 200 {
		t.Fatal("logout failed", code)
	}
	code, value, _ := call(t, second, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || value["authenticated"] != true {
		t.Fatal("logout revoked independent login")
	}
	code, value, _ = call(t, first, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || value["authenticated"] != false {
		t.Fatal("logout retained browser identity")
	}
}

func fmtJSON(value any) string { data, _ := json.Marshal(value); return string(data) }

func TestRuntimeUsesCoreReleaseDefaultAndRejectsBrowserOverride(t *testing.T) {
	_, core, origin := fixture(t)
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	b := browser(t)
	csrf := signIn(t, b, origin, "admin")
	code, model, _ := call(t, b, origin, "/console/api/admin/models", "POST", csrf, map[string]any{"model": "custom-verification", "api": "openai-responses", "baseUrl": "https://models.example.invalid/v1", "credential": "synthetic-key"})
	if code != 201 {
		t.Fatal("create model", code, model)
	}
	defaults, err := core.RuntimeDefaults()
	if err != nil {
		t.Fatal(err)
	}
	code, view, _ := call(t, b, origin, "/console/api/admin/runtime-defaults", "GET", "", nil)
	if code != 200 || view["agentImage"] != defaults.AgentImage {
		t.Fatal("release defaults", code, view)
	}
	code, result, _ := call(t, b, origin, "/console/api/admin/runtime", "PUT", csrf, map[string]any{"modelRef": model["modelRef"]})
	if code != 200 || result["runtime"].(map[string]any)["agentImage"] != defaults.AgentImage {
		t.Fatal("runtime default", code, result)
	}
	before, _ := core.Settings.RuntimeView()
	code, _, _ = call(t, b, origin, "/console/api/admin/runtime", "PUT", csrf, map[string]any{"modelRef": model["modelRef"], "agentImage": "attacker/agent:different"})
	if code != 400 {
		t.Fatal("browser overrode Agent release", code)
	}
	code, _, _ = call(t, b, origin, "/console/api/admin/default-work", "PATCH", csrf, map[string]any{"baseImage": "attacker/agent:different"})
	if code != 400 {
		t.Fatal("Default Work bypassed Agent binding", code)
	}
	after, _ := core.Settings.RuntimeView()
	if fmtJSON(before) != fmtJSON(after) {
		t.Fatal("rejected override changed persisted runtime")
	}
	original := distribution.EncodedImages
	distribution.EncodedImages = "invalid!"
	t.Cleanup(func() { distribution.EncodedImages = original })
	code, _, _ = call(t, b, origin, "/console/api/admin/runtime", "PUT", csrf, map[string]any{"modelRef": model["modelRef"]})
	if code != 503 {
		t.Fatal("invalid embedded release was accepted", code)
	}
	after, _ = core.Settings.RuntimeView()
	if fmtJSON(before) != fmtJSON(after) {
		t.Fatal("missing release modified persisted runtime")
	}
	code, snapshot, _ := call(t, b, origin, "/_web/api/onboarding", "GET", "", nil)
	if code != 200 || snapshot["releaseError"] != "RELEASE_DEFAULTS_UNAVAILABLE" || snapshot["runtime"].(map[string]any)["configured"] != true {
		t.Fatal("release failure hid confirmed onboarding state", code, snapshot)
	}
	code, models, _ := call(t, b, origin, "/console/api/admin/models", "GET", "", nil)
	if code != 200 || len(models["models"].([]any)) != 1 {
		t.Fatal("release failure blocked model recovery", code)
	}

}

func TestSetupSharedAssetsArePublicAndTyped(t *testing.T) {
	_, _, origin := fixture(t)
	client := browser(t)
	for path, contentType := range map[string]string{
		"/setup": "text/html", "/login": "text/html",
		"/setup/browser/onboarding.js": "text/javascript",
		"/setup/browser/components.js": "text/javascript",
		"/setup/browser/model-form.js": "text/javascript",
		"/setup/piwork-logo.png":       "image/png", "/setup/style.css": "text/css",
	} {
		response, err := client.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || !strings.HasPrefix(response.Header.Get("Content-Type"), contentType) || len(body) == 0 {
			t.Fatalf("setup asset %s unavailable or wrong type", path)
		}
	}
	response, err := client.Get(origin + "/setup/browser/adapter.js")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 404 {
		t.Fatal("unexpected setup module was exposed")
	}
}

func TestHostedQuickSetupRoutingAndAuthority(t *testing.T) {
	_, core, origin := fixture(t)
	anonymous := browser(t)
	for _, path := range []string{"/admin/setup", "/admin/setup?step=prepare"} {
		response, err := anonymous.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 303 || response.Header.Get("Location") != "/setup" {
			t.Fatalf("empty installation route %s: %d", path, response.StatusCode)
		}
	}
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	admin := browser(t)
	signIn(t, admin, origin, "admin")
	code, session, _ := call(t, admin, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || session["next"] != "/admin/setup" {
		t.Fatal("first login did not continue inside Admin", code, session)
	}
	response, err := admin.Get(origin + "/setup")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 303 || response.Header.Get("Location") != "/admin/setup" {
		t.Fatal("legacy setup did not redirect")
	}
	for _, path := range []string{"/admin/setup", "/admin/setup?step=prepare", "/admin/runtime", "/admin/models", "/admin/browser/quick-setup.js"} {
		response, err := admin.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		content, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 200 || len(content) == 0 {
			t.Fatalf("admin route %s unavailable: %d", path, response.StatusCode)
		}
	}
	code, models, _ := call(t, admin, origin, "/console/api/admin/models", "GET", "", nil)
	if code != 200 || len(models["models"].([]any)) != 0 || core.Status().Checks.RuntimeConfigured {
		t.Fatal("opening Quick setup wrote configuration")
	}
	if _, err := core.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "ordinary-quick", "synthetic-password", "user"); err != nil {
		t.Fatal(err)
	}
	ordinary := browser(t)
	signIn(t, ordinary, origin, "ordinary-quick")
	for _, path := range []string{"/admin/setup", "/admin/setup?step=prepare", "/console/api/admin/models"} {
		response, err := ordinary.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 403 {
			t.Fatalf("ordinary user entered %s: %d", path, response.StatusCode)
		}
	}
	response, err = ordinary.Get(origin + "/setup")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("ordinary pending setup page was lost")
	}
	code, _, _ = call(t, admin, origin, "/_web/api/setup/administrator", "POST", "", map[string]string{"account": "again", "password": "synthetic-password"})
	if code == 201 {
		t.Fatal("Quick setup reopened bootstrap")
	}
}
