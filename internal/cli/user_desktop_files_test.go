package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopFilesBridgeUsesCoreWebDAVAndKeepsTokenLocal(t *testing.T) {
	const workID = "work-12345678-1234-1234-1234-123456789012"
	var writes atomic.Int32
	var deny atomic.Bool
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" {
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"user"}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer core-token" {
			t.Error("Desktop did not authenticate Core file call")
		}
		switch r.URL.Path {
		case "/api/v1/file-access":
			_ = json.NewEncoder(w).Encode(proxyFileCapability{Version: 1, Protocol: "webdav", Profile: "workspace-transfer-v1",
				RootTemplate: "/api/v1/works/{workId}/files/", Limits: proxyFileExpectedLimits, Available: true})
		case "/api/v1/works/" + workID + "/files/":
			if r.Method != "PROPFIND" || r.Header.Get("Depth") != "1" {
				t.Error("invalid Core PROPFIND", r.Method, r.Header)
			}
			w.Header().Set("Content-Type", "application/xml; charset=utf-8")
			w.WriteHeader(207)
			_, _ = io.WriteString(w, `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/api/v1/works/`+workID+`/files/note.txt</d:href></d:response></d:multistatus>`)
		case "/api/v1/works/" + workID + "/files/note.txt":
			if deny.Load() {
				w.WriteHeader(401)
				return
			}
			if r.Method == "PUT" {
				content, _ := io.ReadAll(r.Body)
				if string(content) != "hello" || r.Header.Get("Cookie") != "" || r.Header.Get("X-Piwork-Csrf") != "" {
					t.Error("Desktop leaked local headers or sent wrong body")
				}
				writes.Add(1)
				w.WriteHeader(201)
				return
			}
			_, _ = io.WriteString(w, "hello")
		default:
			t.Error("unexpected Core file route", r.URL.Path)
			w.WriteHeader(404)
		}
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
			Version: 1, CoreURL: core.URL, Token: "core-token", ExpiresAt: "2099-01-01T00:00:00Z",
			User: client.Identity{ID: "user-1", Account: "owner", Role: "user"},
		}, checked: true}}
	request := func(method, path, body, csrf, destination string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, d.origin+path, strings.NewReader(body))
		r.Header.Set("Cookie", d.cookieName()+"=local")
		r.Header.Set("Origin", d.origin)
		r.Header.Set("Depth", "1")
		if csrf != "" {
			r.Header.Set("X-Piwork-Csrf", csrf)
		}
		if destination != "" {
			r.Header.Set("Destination", destination)
		}
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	base := "/_desktop/files/works/" + workID + "/files/"
	listed := request("PROPFIND", base, "", "csrf", "")
	if listed.Code != 207 || !strings.Contains(listed.Body.String(), base+"note.txt") || strings.Contains(listed.Body.String(), "core-token") {
		t.Fatal("Desktop WebDAV listing was not mapped", listed.Code, listed.Body.String())
	}
	if denied := request("PUT", base+"note.txt", "hello", "wrong", ""); denied.Code != 403 {
		t.Fatal("Desktop File mutation ignored CSRF", denied.Code)
	}
	if denied := request("MOVE", base+"note.txt", "", "csrf", "/_desktop/files/works/work-99999999-9999-9999-9999-999999999999/files/foreign.txt"); denied.Code != 403 {
		t.Fatal("Desktop accepted cross-Work destination", denied.Code)
	}
	put := request("PUT", base+"note.txt", "hello", "csrf", "")
	if put.Code != 201 || writes.Load() != 1 {
		t.Fatal("Desktop PUT did not reach Core", put.Code, writes.Load())
	}
	got := request("GET", base+"note.txt", "", "", "")
	if got.Code != 200 || got.Body.String() != "hello" {
		t.Fatal("Desktop GET did not return Core file", got.Code, got.Body.String())
	}
	deny.Store(true)
	got = request("GET", base+"note.txt", "", "", "")
	if got.Code != 401 || got.Header().Get("X-Piwork-File-Error") != "AUTH_REQUIRED" {
		t.Fatal("Core session revocation not reflected in Desktop Files", got.Code)
	}
	d.mu.Lock()
	credential := d.identity.credential
	d.mu.Unlock()
	if credential != nil {
		t.Fatal("Desktop retained revoked Core credential")
	}
}
