package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"piwork/internal/client"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDesktopRecoveryCLIValidationPrecedesCredentialIO(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", "/definitely/not/a/credential.json")
	t.Setenv("PIWORK_CORE_URL", ":bad")
	for _, args := range [][]string{
		{"desktop", "open", "--port", "0"}, {"desktop", "open", "--port", "65536"}, {"desktop", "open", "--port", "-1"},
		{"desktop", "open", "--port", "42", "--port", "43"}, {"desktop", "open", "--no-open", "--no-open"},
		{"desktop", "logout", "--no-open"}, {"--core", "http://localhost:1", "desktop", "open"}, {"--json", "desktop", "logout"},
		{"desktop", "open", "extra"}, {"desktop", "logout", "--wat"},
	} {
		var out, err bytes.Buffer
		if code := runUser(args, &out, &err); code != 2 || out.Len() != 0 {
			t.Fatalf("syntax %v: %d", args, code)
		}
	}
	for _, args := range [][]string{{"desktop", "open", "--help"}, {"desktop", "logout", "--help"}} {
		var out, err bytes.Buffer
		if code := runUser(args, &out, &err); code != 0 || !strings.Contains(out.String(), "desktop open") {
			t.Fatal("help did I/O", code, err.String())
		}
	}
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	var out, stderr bytes.Buffer
	if code := runUser([]string{"desktop", "open", "--port", fmt.Sprint(d.port), "--no-open"}, &out, &stderr); code != 0 {
		t.Fatal(code, stderr.String())
	}
	if !validDesktopLaunchURL(strings.TrimSpace(strings.TrimPrefix(out.String(), "Piwork Desktop: ")), d.port) {
		t.Fatal("bad launch output")
	}
	c.close()
	out.Reset()
	stderr.Reset()
	if code := runUser([]string{"desktop", "open", "--port", fmt.Sprint(d.port), "--no-open"}, &out, &stderr); code != 4 || out.Len() != 0 {
		t.Fatal("missing instance", code, stderr.String())
	}
}
func TestDesktopTicketAtomicRenewalCapacityAndRandomFailure(t *testing.T) {
	d := recoveryDesktop(t)
	first, err := d.issueTicket()
	if err != nil {
		t.Fatal(err)
	}
	response := recoveryBootstrap(d, recoveryTicket(first))
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	cookie := strings.Split(response.Header().Get("Set-Cookie"), ";")[0]
	second, _ := d.issueTicket()
	third, _ := d.issueTicket()
	if recoveryBootstrap(d, recoveryTicket(second)).Code != 403 {
		t.Fatal("prior ticket valid")
	}
	if recoveryHTTP(d, "GET", "/_desktop/api/session", "", cookie, "").Code != 200 {
		t.Fatal("renewal revoked local session")
	}
	var successes atomic.Int32
	var wait sync.WaitGroup
	for i := 0; i < 12; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if recoveryBootstrap(d, recoveryTicket(third)).Code == 200 {
				successes.Add(1)
			}
		}()
	}
	wait.Wait()
	if successes.Load() != 1 {
		t.Fatal("concurrent ticket", successes.Load())
	}
	fourth, _ := d.issueTicket()
	d.secret = func() (string, error) { return "", errors.New("random unavailable") }
	if recoveryBootstrap(d, recoveryTicket(fourth)).Code != 503 || d.used {
		t.Fatal("random failure consumed ticket")
	}
	d.secret = nil
	for len(d.sessions) < 128 {
		id := fmt.Sprint(len(d.sessions))
		d.sessions[id] = desktopSession{end: time.Now().Add(time.Hour)}
	}
	if r := recoveryBootstrap(d, recoveryTicket(fourth)); r.Code != 503 || !strings.Contains(r.Body.String(), "LOCAL_SESSION_CAPACITY") || d.used {
		t.Fatal("capacity consumed or evicted", r.Code)
	}
	d.sessions["expired"] = desktopSession{end: time.Now().Add(-time.Second)}
	delete(d.sessions, "127")
	if recoveryBootstrap(d, recoveryTicket(fourth)).Code != 200 {
		t.Fatal("expired capacity not recovered")
	}
}
func TestDesktopBrowserResetKeepsCoreAndCancelsContent(t *testing.T) {
	d := recoveryDesktop(t)
	credential := client.Credential{Version: 1, CoreURL: d.identity.coreURL, Token: "core-secret", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	d.identity.credential = &credential
	d.identity.checked = true
	if err := d.store.Save(credential); err != nil {
		t.Fatal(err)
	}
	url, _ := d.issueTicket()
	bootstrap := recoveryBootstrap(d, recoveryTicket(url))
	cookie := strings.Split(bootstrap.Header().Get("Set-Cookie"), ";")[0]
	var jsonValue map[string]any
	_ = json.Unmarshal(bootstrap.Body.Bytes(), &jsonValue)
	csrf := jsonValue["csrf"].(string)
	req := httptest.NewRequest("GET", d.origin+"/_desktop/files/works/w/files/a", nil)
	req.Header.Set("Cookie", cookie)
	ss, ok := d.authorize(req, false)
	if !ok {
		t.Fatal("authorization")
	}
	guarded, content, finish, ok := d.guardContent(httptest.NewRecorder(), req, ss)
	if !ok {
		t.Fatal("guard")
	}
	defer finish()
	for _, csrfValue := range []string{"", "wrong"} {
		if recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", cookie, csrfValue).Code != 403 {
			t.Fatal("reset bypassed csrf")
		}
	}
	if recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", "", csrf).Code != 403 {
		t.Fatal("anonymous reset")
	}
	pending, _ := d.issueTicket()
	response := recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", cookie, csrf)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"coreSessionRetained":true`) {
		t.Fatal("reset failed", response.Code)
	}
	select {
	case <-content.Context().Done():
	case <-time.After(2 * time.Second):
		t.Fatal("content not cancelled")
	}
	if _, err := guarded.Write([]byte("old sensitive content")); err == nil {
		t.Fatal("late content published")
	}
	if recoveryHTTP(d, "GET", "/_desktop/api/session", "", cookie, "").Code != 401 || recoveryBootstrap(d, recoveryTicket(pending)).Code != 403 {
		t.Fatal("old authorization retained")
	}
	if d.identity.credential != &credential {
		t.Fatal("reset logged Core out")
	}
	saved, err := d.store.Load()
	if err != nil || saved.Token != credential.Token {
		t.Fatal("reset deleted Core credential")
	}
	fresh, _ := d.issueTicket()
	if recoveryBootstrap(d, recoveryTicket(fresh)).Code != 200 {
		t.Fatal("cannot reauthorize")
	}
}

// A separate process exercises the same OS peer credentials and public CLI entry.
func TestDesktopControlHelperProcess(t *testing.T) {
	if os.Getenv("PIWORK_DESKTOP_CONTROL_TEST_HELPER") == "1" {
		args := strings.Split(os.Getenv("PIWORK_DESKTOP_CONTROL_TEST_ARGS"), " ")
		os.Exit(runUser(args, os.Stdout, os.Stderr))
	}
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	command := nativeTestCommand(t, "-test.run=^TestDesktopControlHelperProcess$")
	command.Dir = t.TempDir()
	command.Env = append(os.Environ(), "PIWORK_DESKTOP_CONTROL_TEST_HELPER=1", "PIWORK_DESKTOP_CONTROL_TEST_ARGS=desktop open --port "+fmt.Sprint(d.port)+" --no-open", "PIWORK_CONFIG_PATH=/bad/credential", "PIWORK_CORE_URL=invalid")
	output, err := command.CombinedOutput()
	if err != nil || !strings.HasPrefix(string(output), "Piwork Desktop: ") {
		t.Fatal("same-UID helper", err, string(output))
	}
}

func TestDesktopHelperBrowserFallbackAndInterruptPreserveInstance(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	command := nativeTestCommand(t, "-test.run=^TestDesktopControlHelperProcess$")
	command.Env = append(os.Environ(), "PIWORK_DESKTOP_CONTROL_TEST_HELPER=1", "PIWORK_DESKTOP_CONTROL_TEST_ARGS=desktop open --port "+fmt.Sprint(d.port), "PATH=/nonexistent")
	output, err := command.CombinedOutput()
	if err != nil || !bytes.Contains(output, []byte("manually")) || !bytes.Contains(output, []byte("Piwork Desktop:")) {
		t.Fatal("browser fallback", err, string(output))
	}
	originalCore := d.identity.coreURL
	d.mu.Lock()
	waiting := nativeTestCommand(t, "-test.run=^TestDesktopControlHelperProcess$")
	waiting.Env = append(os.Environ(), "PIWORK_DESKTOP_CONTROL_TEST_HELPER=1", "PIWORK_DESKTOP_CONTROL_TEST_ARGS=desktop open --port "+fmt.Sprint(d.port)+" --no-open")
	if err := waiting.Start(); err != nil {
		d.mu.Unlock()
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for len(c.slots) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	_ = interruptTestProcess(waiting)
	err = waiting.Wait()
	d.mu.Unlock()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 130 {
		t.Fatal("helper interrupt", err)
	}
	if _, err := requestDesktopControl(context.Background(), d.port, "open"); err != nil || d.identity.coreURL != originalCore {
		t.Fatal("interrupt stopped or changed instance", err)
	}
}

func TestDesktopExpiredContentCancelsAndRemovesRegistration(t *testing.T) {
	d := recoveryDesktop(t)
	d.sessions["session"] = desktopSession{end: time.Now().Add(50 * time.Millisecond), csrf: "csrf"}
	req := httptest.NewRequest("GET", d.origin+"/_desktop/api/works", nil)
	req.Header.Set("Cookie", d.cookieName()+"=session")
	ss, ok := d.authorize(req, false)
	if !ok {
		t.Fatal("authorize")
	}
	_, content, finish, ok := d.guardContent(httptest.NewRecorder(), req, ss)
	if !ok {
		t.Fatal("guard")
	}
	select {
	case <-content.Context().Done():
	case <-time.After(2 * time.Second):
		t.Fatal("expired stream survived")
	}
	finish()
	d.mu.Lock()
	count := len(d.activeAccess)
	d.mu.Unlock()
	if count != 0 {
		t.Fatal("registration leaked")
	}
}

func TestDesktopResetOriginAndTemporaryResourceBoundary(t *testing.T) {
	d := recoveryDesktop(t)
	url, _ := d.issueTicket()
	bootstrap := recoveryBootstrap(d, recoveryTicket(url))
	cookie := strings.Split(bootstrap.Header().Get("Set-Cookie"), ";")[0]
	var value map[string]any
	_ = json.Unmarshal(bootstrap.Body.Bytes(), &value)
	csrf := value["csrf"].(string)
	for _, host := range []string{fmt.Sprintf("service.desktop.localhost:%d", d.port), fmt.Sprintf("localhost:%d", d.port)} {
		req := httptest.NewRequest("POST", d.origin+"/_desktop/api/browser-access/reset", strings.NewReader("{}"))
		req.Host = host
		req.Header.Set("Cookie", cookie)
		req.Header.Set("X-Piwork-Csrf", csrf)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", d.origin)
		response := httptest.NewRecorder()
		d.ServeHTTP(response, req)
		if response.Code != 403 {
			t.Fatal("non-shell Host reset accepted", response.Code)
		}
	}
	req := httptest.NewRequest("POST", d.origin+"/_desktop/api/browser-access/reset", strings.NewReader("{}"))
	req.Header.Set("Cookie", cookie)
	req.Header.Set("X-Piwork-Csrf", csrf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.test")
	response := httptest.NewRecorder()
	d.ServeHTTP(response, req)
	if response.Code != 403 {
		t.Fatal("cross-site reset")
	}
	transfers, err := d.transferStore()
	if err != nil {
		t.Fatal(err)
	}
	temporary := filepath.Join(transfers.directory, "pending")
	if err := transfers.root.AtomicWrite(t.Context(), "pending", []byte("private temporary content")); err != nil {
		t.Fatal(err)
	}
	d.serviceEntries = map[string]*desktopServiceEntry{"old": {}}
	response = recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", cookie, csrf)
	if response.Code != 200 || d.transfers != nil || len(d.serviceEntries) != 0 {
		t.Fatal("reset retained temporary resources")
	}
	if _, err := os.Stat(temporary); !os.IsNotExist(err) {
		t.Fatal("temporary file retained")
	}
	if fresh, err := d.transferStore(); err != nil || fresh == transfers {
		t.Fatal("new transfer store unavailable after reset")
	} else {
		fresh.clear()
	}
}

func TestDesktopResetClosesActualWebDAVAndRunStreams(t *testing.T) {
	for _, route := range []string{"file", "run"} {
		t.Run(route, func(t *testing.T) {
			stopped := make(chan struct{})
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Path == "/api/v1/me":
					_, _ = io.WriteString(w, `{"id":"owner","account":"owner","role":"user"}`)
				case r.URL.Path == "/api/v1/file-access":
					_ = json.NewEncoder(w).Encode(proxyFileCapability{Version: 1, Protocol: "webdav", Profile: "workspace-transfer-v1", RootTemplate: "/api/v1/works/{workId}/files/", Limits: proxyFileExpectedLimits, Available: true})
				case r.URL.Path == "/api/v1/works/work-1/runs/run-1":
					_, _ = io.WriteString(w, `{"runId":"run-1"}`)
				default:
					if route == "run" {
						w.Header().Set("Content-Type", "application/x-ndjson")
						_, _ = io.WriteString(w, "{\"sequence\":1}\n")
					} else {
						_, _ = io.WriteString(w, strings.Repeat("a", 8192))
					}
					w.(http.Flusher).Flush()
					<-r.Context().Done()
					close(stopped)
				}
			}))
			defer core.Close()
			d := recoveryDesktop(t)
			d.identity.coreURL = core.URL
			d.identity.credential = &client.Credential{Version: 1, CoreURL: core.URL, Token: "stream-secret", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
			d.identity.checked = true
			d.sessions["local"] = desktopSession{csrf: "csrf", end: time.Now().Add(time.Hour)}
			local := httptest.NewServer(d)
			defer local.Close()
			path := "/_desktop/files/works/work-12345678-1234-1234-1234-123456789012/files/stream"
			if route == "run" {
				path = "/_desktop/api/works/work-1/runs/run-1/events?after=0"
			}
			request, _ := http.NewRequest("GET", local.URL+path, nil)
			request.Host = fmt.Sprintf("desktop.localhost:%d", d.port)
			request.Header.Set("Cookie", d.cookieName()+"=local")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				body, _ := io.ReadAll(response.Body)
				t.Fatal("stream rejected", response.StatusCode, string(body))
			}
			initial := make([]byte, 1)
			if _, err := response.Body.Read(initial); err != nil {
				t.Fatal("stream not started", err)
			}
			reset := recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", d.cookieName()+"=local", "csrf")
			if reset.Code != 200 {
				t.Fatal(reset.Code)
			}
			select {
			case <-stopped:
			case <-time.After(2 * time.Second):
				t.Fatal("actual upstream stream still open")
			}
			finished := make(chan struct{})
			go func() { _, _ = io.Copy(io.Discard, response.Body); close(finished) }()
			select {
			case <-finished:
			case <-time.After(2 * time.Second):
				t.Fatal("browser body still open")
			}
		})
	}
}
func TestDesktopLogoutAlreadyInvalidAndLateResponseStayCaptured(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{})
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-gate
		w.WriteHeader(401)
		_, _ = io.WriteString(w, `{"code":"AUTHENTICATION_FAILED","message":"Session ended"}`)
	}))
	defer core.Close()
	d := recoveryDesktop(t)
	old := client.Credential{Version: 1, CoreURL: core.URL, Token: "old", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "old", Account: "old", Role: "user"}}
	d.identity.coreURL = core.URL
	d.identity.credential = &old
	if err := d.store.Save(old); err != nil {
		t.Fatal(err)
	}
	result := make(chan desktopLogoutResult, 1)
	go func() { result <- d.logoutIdentity() }()
	<-started
	newer := old
	newer.Token = "new"
	newer.User.ID = "new"
	if err := d.store.Save(newer); err != nil {
		t.Fatal(err)
	}
	// Emulate a later identity callback without replacing the captured cleanup.
	d.mu.Lock()
	d.identity.generation++
	d.identity.credential = &newer
	generation := d.identity.generation
	d.mu.Unlock()
	close(gate)
	outcome := <-result
	if !outcome.RemoteRevocationConfirmed || !outcome.CredentialCleared {
		t.Fatal("already invalid not confirmed", outcome)
	}
	d.mu.Lock()
	unchanged := d.identity.credential == &newer && d.identity.generation == generation
	d.mu.Unlock()
	if !unchanged || outcome.View["generation"] == generation {
		t.Fatal("late logout mutated/reported new identity")
	}
	saved, err := d.store.Load()
	if err != nil || saved.Token != newer.Token {
		t.Fatal("late logout deleted newer credential")
	}
}

func TestDesktopConcurrentLogoutSharesBoundedCleanup(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{})
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-gate
		w.WriteHeader(204)
	}))
	defer core.Close()
	d := recoveryDesktop(t)
	d.identity.coreURL = core.URL
	d.identity.credential = &client.Credential{Version: 1, CoreURL: core.URL, Token: "shared", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	first := make(chan desktopLogoutResult, 1)
	second := make(chan desktopLogoutResult, 1)
	go func() { first <- d.logoutIdentity() }()
	<-started
	go func() { second <- d.logoutIdentity() }()
	time.Sleep(10 * time.Millisecond)
	close(gate)
	one, two := <-first, <-second
	if calls.Load() != 1 || !one.RemoteRevocationConfirmed || !two.RemoteRevocationConfirmed {
		t.Fatal("concurrent cleanup duplicated", calls.Load())
	}
	one.View["csrf"] = "one"
	if two.View["csrf"] != nil {
		t.Fatal("shared mutable response view")
	}
}
