package webapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
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
	core, err := coreapp.New(ctx, coreapp.Options{DataDirectory: directory, SetupSecret: "test-process-setup"})
	if err != nil {
		cancel()
		t.Fatal(err)
	}
	bound, err := core.Listen(coreapp.ListenAddress{Host: "127.0.0.1", Port: 0})
	if err != nil {
		cancel()
		_ = core.Close(context.Background())
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	web, err := New(ctx, Options{Origin: origin, CoreURL: bound.URL(), SetupSecret: "test-process-setup", DataDirectory: directory})
	if err != nil {
		server.Close()
		cancel()
		_ = core.Close(context.Background())
		t.Fatal(err)
	}
	server.Config.Handler = web
	server.Start()
	t.Cleanup(func() {
		cancel()
		web.Close()
		server.Close()
		ctx, end := context.WithTimeout(context.Background(), 5*time.Second)
		defer end()
		if err := core.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	return web, core, origin
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

func TestFirstUserSetupUsesOrdinarySessionAndClosesAfterBootstrap(t *testing.T) {
	_, core, origin := fixture(t)
	browser := browser(t)
	code, state, _ := call(t, browser, origin, "/_web/api/state", "GET", "", nil)
	if code != 200 || state["administratorInitialized"] != false {
		t.Fatal("empty installation state unavailable")
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", "", map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 403 {
		t.Fatal("bootstrap without CSRF accepted", code)
	}
	code, session, response := call(t, browser, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 {
		t.Fatal("ordinary session unavailable", code, session)
	}
	for _, cookie := range response.Cookies() {
		if !cookie.HttpOnly || cookie.Secure {
			t.Fatal("ordinary session cookie unsafe for HTTP")
		}
	}
	csrf := session["csrfToken"].(string)
	code, resumed, _ := call(t, browser, origin, "/_web/api/session", "GET", "", nil)
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
	code, session, _ = call(t, browser, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || session["authenticated"] != false {
		t.Fatal("creation bypassed normal sign-in", code)
	}
	if hasUsers, err := core.Identity.HasUsers(context.Background()); err != nil || !hasUsers {
		t.Fatal("first user not durable", err)
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", csrf, map[string]string{"account": "second", "password": "synthetic-password"})
	if code != 409 {
		t.Fatal("first-user creation reopened", code)
	}
	users, err := core.Identity.ListUsers(context.Background(), identity.OperatorPrincipal())
	if err != nil || len(users) != 1 {
		t.Fatal("first administrator missing", err)
	}
	if _, err := core.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "backup-admin", "synthetic-password", "admin"); err != nil {
		t.Fatal(err)
	}
	if err := core.Identity.SetEnabled(context.Background(), identity.OperatorPrincipal(), string(users[0].Id), false); err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", csrf, map[string]string{"account": "replacement", "password": "synthetic-password"})
	if code != 409 {
		t.Fatal("disabled administrator reopened bootstrap", code)
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
	_, core, origin := fixture(t)
	browser := browser(t)
	_, session, _ := call(t, browser, origin, "/_web/api/session", "GET", "", nil)
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = core.Identity.Bootstrap(context.Background(), "operator-admin", "synthetic-password")
	}()
	code, _, _ := call(t, browser, origin, "/_web/api/setup/administrator", "POST", session["csrfToken"].(string), map[string]string{"account": "web-admin", "password": "synthetic-password"})
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
		"/setup/browser/onboarding.js":   "text/javascript",
		"/setup/browser/components.js":   "text/javascript",
		"/setup/browser/model-form.js":   "text/javascript",
		"/setup/browser/pending.js":      "text/javascript",
		"/setup/browser/i18n.js":         "text/javascript",
		"/setup/browser/boot.js":         "text/javascript",
		"/setup/browser/locale.js":       "text/javascript",
		"/setup/browser/i18n/catalog.js": "text/javascript",
		"/setup/browser/i18n/shared.js":  "text/javascript",
		"/setup/browser/i18n/setup.js":   "text/javascript",
		"/setup/browser/i18n/app.js":     "text/javascript",
		"/setup/piwork-logo.png":         "image/png", "/setup/style.css": "text/css",
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

func TestSetupLanguageModulesSupportHeadAndKeepCSP(t *testing.T) {
	_, _, origin := fixture(t)
	client := browser(t)
	// Every boot/runtime module the setup entry references must also answer HEAD
	// with the same type, and the asset response must keep the strict policy.
	for _, path := range []string{
		"/setup/browser/boot.js",
		"/setup/browser/i18n.js",
		"/setup/browser/locale.js",
		"/setup/browser/read-deadline.js",
		"/setup/browser/i18n/catalog.js",
		"/setup/browser/i18n/shared.js",
		"/setup/browser/i18n/setup.js",
		"/setup/browser/i18n/app.js",
	} {
		request, err := http.NewRequest(http.MethodHead, origin+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/javascript") {
			t.Fatalf("setup language module %s HEAD: HTTP %d, type %q", path, response.StatusCode, response.Header.Get("Content-Type"))
		}
		if policy := response.Header.Get("Content-Security-Policy"); !strings.Contains(policy, "default-src 'none'") || !strings.Contains(policy, "script-src 'self'") {
			t.Fatalf("setup language module %s lost CSP: %q", path, policy)
		}
	}
	// The allowlist is exact-path only: an unlisted nested module stays hidden.
	response, err := client.Get(origin + "/setup/browser/i18n/unlisted.js")
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusNotFound {
		t.Fatal("unlisted nested setup module was exposed")
	}
}

func TestEntryWatchdogHashesMatchRealHTMLResponses(t *testing.T) {
	_, core, origin := fixture(t)
	client := browser(t)
	check := func(path string) {
		t.Helper()
		response, err := client.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		html, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d %v", path, response.StatusCode, err)
		}
		start := bytes.Index(html, []byte("<script data-boot-watchdog "))
		if start < 0 {
			t.Fatalf("%s: watchdog missing", path)
		}
		start += bytes.IndexByte(html[start:], '>') + 1
		end := bytes.Index(html[start:], []byte("</script>"))
		if end < 0 {
			t.Fatalf("%s: watchdog not closed", path)
		}
		digest := sha256.Sum256(html[start : start+end])
		policy := response.Header.Get("Content-Security-Policy")
		if !strings.Contains(policy, "'sha256-"+base64.StdEncoding.EncodeToString(digest[:])+"'") || strings.Contains(policy, "unsafe-inline") {
			t.Fatalf("%s: incorrect CSP %q", path, policy)
		}
		encoded := base64.RawURLEncoding.EncodeToString([]byte(path))
		if !strings.Contains(string(html), `<form method="get" data-boot-recovery-form>`) || !strings.Contains(string(html), `name="__piwork_boot_retry" value="`+encoded+`"`) {
			t.Fatalf("%s: native recovery form lost its public request target", path)
		}
		copy := *client
		copy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
		pathname := strings.SplitN(path, "?", 2)[0]
		retry, err := copy.Get(origin + pathname + "?__piwork_boot_retry=" + encoded)
		if err != nil {
			t.Fatal(err)
		}
		retry.Body.Close()
		if retry.StatusCode != http.StatusSeeOther || retry.Header.Get("Location") != path {
			t.Fatalf("%s: recovery redirect changed the URL: %d %q", path, retry.StatusCode, retry.Header.Get("Location"))
		}
	}
	check("/setup?returnTo=%2Fservices%2Fw%2Fs%2F8080%2F")
	check("/login?view=one%20two&tag=a&tag=b")
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	signIn(t, client, origin, "admin")
	check("/?view=one%20two&tag=a&tag=b")
	check("/admin")
	check("/admin/setup?step=prepare")
}

func TestSetupModuleImportsArePublicAndTyped(t *testing.T) {
	_, _, origin := fixture(t)
	client := browser(t)
	entry, err := url.Parse(origin + "/setup/browser/onboarding.js")
	if err != nil {
		t.Fatal(err)
	}
	// Follow the embedded entry's actual imports through the production handler.
	// A fixture static server would hide omissions in the public asset allowlist.
	imports := regexp.MustCompile(`(?m)^\s*(?:import|export)\s+(?:[^;'"\n]+\s+from\s+)?['"]([^'"]+)['"]`)
	queue := []*url.URL{entry}
	seen := map[string]bool{}
	for len(queue) > 0 {
		module := queue[0]
		queue = queue[1:]
		if seen[module.String()] {
			continue
		}
		seen[module.String()] = true
		response, err := client.Get(module.String())
		if err != nil {
			t.Fatal(err)
		}
		body, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != http.StatusOK || !strings.HasPrefix(response.Header.Get("Content-Type"), "text/javascript") || len(body) == 0 {
			t.Fatalf("setup module %s unavailable or wrong type: HTTP %d", module.Path, response.StatusCode)
		}
		for _, match := range imports.FindAllSubmatch(body, -1) {
			dependency, err := module.Parse(string(match[1]))
			if err != nil || dependency.Scheme != entry.Scheme || dependency.Host != entry.Host || !strings.HasPrefix(dependency.Path, "/setup/browser/") {
				t.Fatalf("setup module %s imports unsupported dependency %q", module.Path, match[1])
			}
			queue = append(queue, dependency)
		}
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
