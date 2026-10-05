package cli

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
	"piwork/internal/clientfs"
)

type preferenceFailureFixture struct {
	client.DesktopPreferencesStore
	before func()
	after  error
}

func (s preferenceFailureFixture) Save(ctx context.Context, value string, check func() error) (string, error) {
	if s.before != nil {
		s.before()
	}
	core, err := s.DesktopPreferencesStore.Save(ctx, value, check)
	if err != nil {
		return core, err
	}
	return core, s.after
}

func TestDesktopPreferencesAPIIsOfflineLocalAndIndependent(t *testing.T) {
	d := recoveryDesktop(t)
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(time.Hour)}
	cookie := d.cookieName() + "=fixture"
	request := func(method, body string) int {
		return recoveryHTTP(d, method, "/_desktop/api/preferences", body, cookie, "csrf").Code
	}
	core, generation := d.identity.coreURL, d.identity.generation
	if r := recoveryHTTP(d, "GET", "/_desktop/api/preferences", "", cookie, ""); r.Code != 200 || strings.TrimSpace(r.Body.String()) != `{"coreUrl":null}` {
		t.Fatal(r.Code, r.Body.String())
	}
	if _, err := os.Stat(filepath.Dir(d.store.Path)); !os.IsNotExist(err) {
		t.Fatal("GET created preferences state", err)
	}
	if status := request("PUT", `{"coreUrl":"http://next.example/"}`); status != 200 {
		t.Fatal("offline save failed", status)
	}
	if r := recoveryHTTP(d, "GET", "/_desktop/api/preferences", "", cookie, ""); r.Code != 200 || strings.TrimSpace(r.Body.String()) != `{"coreUrl":"http://next.example"}` {
		t.Fatal(r.Code, r.Body.String())
	}
	if d.identity.coreURL != core || d.identity.generation != generation || d.identity.credential != nil || d.transfers != nil {
		t.Fatal("saving preferences changed current identity/content")
	}
	if _, err := os.Stat(d.store.Path); !os.IsNotExist(err) {
		t.Fatal("saving preferences wrote credentials", err)
	}
	for _, body := range []string{`{`, `{"coreUrl":"http://remote.example/path"}`, `{"coreUrl":"https://a.example","coreUrl":"https://b.example"}`, `{"coreUrl":"http://next.example","token":"never"}`, strings.Repeat("x", client.DesktopPreferencesLimit+1)} {
		if status := request("PUT", body); status != 400 {
			t.Fatal("invalid PUT", status)
		}
	}
	if status := request("POST", `{}`); status != 405 {
		t.Fatal("unknown method", status)
	}
	store := client.DesktopPreferencesStore{CredentialPath: d.store.Path}
	path := filepath.Join(filepath.Dir(d.store.Path), "desktop")
	dir, err := clientfs.OpenPrivateDirectory(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.Close()
	lock, err := dir.TryLock(".lock")
	if err != nil {
		t.Fatal(err)
	}
	if status := request("PUT", `{"coreUrl":"https://busy.example"}`); status != 409 {
		t.Fatal("locked save", status)
	}
	if status := request("DELETE", ""); status != 409 {
		t.Fatal("locked clear", status)
	}
	lock.Close()
	if err := dir.AtomicWrite(t.Context(), "preferences.json", []byte("{bad")); err != nil {
		t.Fatal(err)
	}
	if status := request("GET", ""); status != 500 {
		t.Fatal("corrupt GET", status)
	}
	if status := request("PUT", `{"coreUrl":"https://replacement.example"}`); status != 500 {
		t.Fatal("corrupt PUT replaced record", status)
	}
	if status := request("DELETE", ""); status != 200 {
		t.Fatal("explicit recovery failed", status)
	}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal("clear readback", value, err)
	}
}

func TestDesktopPreferencesAPIUnknownCommitAuthorizationResetAndCapacity(t *testing.T) {
	d := recoveryDesktop(t)
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(time.Hour)}
	cookie := d.cookieName() + "=fixture"
	store := client.DesktopPreferencesStore{CredentialPath: d.store.Path}
	d.preferencesStorage = preferenceFailureFixture{DesktopPreferencesStore: store, after: clientfs.ErrOutcomeUnknown}
	r := recoveryHTTP(d, "PUT", "/_desktop/api/preferences", `{"coreUrl":"https://committed.example"}`, cookie, "csrf")
	if r.Code != 500 || !strings.Contains(r.Body.String(), "DESKTOP_PREFERENCES_OUTCOME_UNKNOWN") {
		t.Fatal("commit ambiguity hidden", r.Code, r.Body.String())
	}
	r = recoveryHTTP(d, "GET", "/_desktop/api/preferences", "", cookie, "")
	if r.Code != 200 || !strings.Contains(r.Body.String(), "https://committed.example") {
		t.Fatal("read-only confirmation failed", r.Code)
	}
	d.preferencesStorage = preferenceFailureFixture{DesktopPreferencesStore: store, before: func() { d.mu.Lock(); delete(d.sessions, "fixture"); d.localGeneration++; d.mu.Unlock() }}
	r = recoveryHTTP(d, "PUT", "/_desktop/api/preferences", `{"coreUrl":"https://revoked.example"}`, cookie, "csrf")
	if r.Code != 401 && r.Code != 403 {
		t.Fatal("revoked local access not rejected", r.Code)
	}
	if value, err := store.Load(); err != nil || value == nil || *value != "https://committed.example" {
		t.Fatal("revoked access committed", err)
	}
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(time.Hour)}
	d.activeAccess = map[*desktopAccess]bool{}
	for range 256 {
		d.activeAccess[&desktopAccess{}] = true
	}
	r = recoveryHTTP(d, "GET", "/_desktop/api/preferences", "", cookie, "")
	if r.Code != 503 || !strings.Contains(r.Body.String(), "LOCAL_CONTENT_BUSY") {
		t.Fatal("local access capacity bypassed", r.Code)
	}
}

func TestDesktopPreferencesAPIHostOriginInputsAndInspectIndependence(t *testing.T) {
	d := recoveryDesktop(t)
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(time.Hour)}
	cookie := d.cookieName() + "=fixture"
	transfers, err := d.transferStore()
	if err != nil {
		t.Fatal(err)
	}
	defer transfers.clear()
	job := &desktopTransfer{id: "anonymous-inspect", phase: "inspected"}
	transfers.jobs[job.id] = job
	for _, test := range []struct {
		method, path, body, host, origin, contentType string
		status                                        int
	}{
		{"GET", "/_desktop/api/preferences", "", "service.desktop.localhost:1", "", "", 403},
		{"GET", "/_desktop/api/preferences", "", "", "https://foreign.example", "", 403},
		{"PUT", "/_desktop/api/preferences", `{"coreUrl":"http://saved.example"}`, "", "", "text/plain", 400},
		{"DELETE", "/_desktop/api/preferences", "{}", "", "", "application/json", 400},
		{"GET", "/_desktop/api/preferences?token=never", "", "", "", "", 400},
		{"PUT", "/_desktop/api/preferences", `{"coreUrl":"http://saved.example"}`, "", "", "application/json", 200},
	} {
		req := httptest.NewRequest(test.method, d.origin+test.path, strings.NewReader(test.body))
		req.Header.Set("Cookie", cookie)
		req.Header.Set("X-Piwork-Csrf", "csrf")
		req.Header.Set("Content-Type", test.contentType)
		if test.host != "" {
			req.Host = test.host
		}
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		r := httptest.NewRecorder()
		d.ServeHTTP(r, req)
		if r.Code != test.status {
			t.Fatal("local preference guard", test, r.Code)
		}
	}
	if d.transfers != transfers || transfers.jobs[job.id] != job || d.identity.generation != 0 || d.identity.credential != nil {
		t.Fatal("default preference cleared Inspect or changed identity")
	}
}

func TestDesktopPreferencesAPIAuthorizationPrecedesDisk(t *testing.T) {
	d := recoveryDesktop(t)
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(time.Hour)}
	for _, test := range []struct {
		method, cookie, csrf, origin string
		status                       int
	}{
		{http.MethodGet, "", "", "", 401},
		{http.MethodPut, d.cookieName() + "=fixture", "wrong", "", 403},
		{http.MethodPut, d.cookieName() + "=fixture", "csrf", "http://service.localhost", 403},
	} {
		req := httptest.NewRequest(test.method, d.origin+"/_desktop/api/preferences", strings.NewReader(`{"coreUrl":"https://default.example"}`))
		req.Header.Set("Cookie", test.cookie)
		req.Header.Set("X-Piwork-Csrf", test.csrf)
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		r := httptest.NewRecorder()
		d.ServeHTTP(r, req)
		if r.Code != test.status {
			t.Fatal("unauthorized preferences access", r.Code)
		}
	}
	if _, err := os.Stat(filepath.Dir(d.store.Path)); !os.IsNotExist(err) {
		t.Fatal("unauthorized request touched disk", err)
	}
	// Expired access remains a local authorization failure, never a Core login.
	d.sessions["fixture"] = desktopSession{id: "fixture", csrf: "csrf", end: time.Now().Add(-time.Second)}
	r := recoveryHTTP(d, "GET", "/_desktop/api/preferences", "", d.cookieName()+"=fixture", "")
	var value map[string]string
	json.Unmarshal(r.Body.Bytes(), &value)
	if r.Code != 401 || value["code"] != "LOCAL_AUTH_REQUIRED" {
		t.Fatal(r.Code, value)
	}
}
