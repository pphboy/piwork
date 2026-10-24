package cli

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopRunEventsAreAuthorizedAndResumable(t *testing.T) {
	var coreCalls int
	modern := false
	window := false
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/me" {
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"user"}`)
			return
		}
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Error("Run read omitted Core authorization")
		}
		coreCalls++
		if r.URL.Path == "/api/v1/works/work-1/runs/run-1" {
			if modern && r.URL.Query().Get("responseProfile") != "history-v1" {
				t.Error("unbounded preflight")
			}
			_, _ = io.WriteString(w, `{"runId":"run-1","state":"running"}`)
			return
		}
		if r.URL.Path == "/api/v1/works/work-1/runs/run-1/events" && r.URL.Query().Get("after") == "2" {
			w.Header().Set("Content-Type", "application/x-ndjson")
			if modern {
				if window {
					for offset := 0; offset < 20<<20; offset += 32768 {
						frame := map[string]any{"sequence": 3, "kind": map[string]any{"$case": "text", "text": map[string]any{"delta": strings.Repeat("a", 32768), "byteOffset": offset, "totalBytes": 20 << 20, "complete": offset+32768 == 20<<20}}}
						if json.NewEncoder(w).Encode(frame) != nil {
							return
						}
					}
					return
				}
				if r.URL.Query().Get("responseProfile") != "history-v1" {
					t.Error("missing stream profile")
				}
				_, _ = io.WriteString(w, "{\"sequence\":3,\"kind\":{\"$case\":\"text\",\"text\":{\"delta\":\"a\",\"byteOffset\":0,\"totalBytes\":2,\"complete\":false}}}\n{\"sequence\":3,\"kind\":{\"$case\":\"text\",\"text\":{\"delta\":\"b\",\"byteOffset\":1,\"totalBytes\":2,\"complete\":true}}}\n")
			} else {
				_, _ = io.WriteString(w, "{\"sequence\":3,\"type\":\"message\"}\n")
			}
			return
		}
		t.Error("unexpected Core run route", r.URL.String())
		w.WriteHeader(404)
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
			Version: 1, CoreURL: core.URL, Token: "secret", ExpiresAt: "2099-01-01T00:00:00Z",
			User: client.Identity{ID: "user-1", Account: "owner", Role: "user"},
		}, checked: true}}
	call := func(path, origin string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest("GET", d.origin+path, nil)
		r.Header.Set("Cookie", d.cookieName()+"=local")
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	path := "/_desktop/api/works/work-1/runs/run-1/events?after=2"
	response := call(path, d.origin)
	if response.Code != 200 || response.Header().Get("Content-Type") != "application/x-ndjson" ||
		!strings.Contains(response.Body.String(), `"sequence":3`) || strings.Contains(response.Body.String(), "secret") {
		t.Fatal("Desktop Run stream was not forwarded safely", response.Code, response.Body.String())
	}
	modern = true
	response = call(path+"&responseProfile=history-v1", d.origin)
	if response.Code != 200 || strings.Count(response.Body.String(), `"sequence":3`) != 2 {
		t.Fatal("same sequence fragment was dropped", response.Code, response.Body.String())
	}
	window = true
	response = call(path+"&responseProfile=history-v1", d.origin)
	if response.Code != 200 || response.Body.Len() > 16<<20 || strings.Contains(response.Body.String(), `"complete":true`) {
		t.Fatal("connection window lost its bound or advanced an incomplete event", response.Code, response.Body.Len())
	}
	window = false
	prior := coreCalls
	for _, invalid := range []string{"-1", "9007199254740992", "hi", "2&other=1"} {
		response = call("/_desktop/api/works/work-1/runs/run-1/events?after="+invalid, d.origin)
		if response.Code != 400 {
			t.Fatal("invalid Run cursor accepted", invalid, response.Code)
		}
	}
	if coreCalls != prior {
		t.Fatal("invalid Run cursor reached Core")
	}
	if response := call(path, "http://evil.example"); response.Code != 403 {
		t.Fatal("cross-origin Run stream accepted", response.Code)
	}
}
