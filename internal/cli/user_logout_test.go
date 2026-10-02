package cli

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"piwork/internal/client"
)

func TestLogoutClearsOnlyConfirmedSelectedCoreSessions(t *testing.T) {
	for _, test := range []struct {
		name   string
		status int
		body   string
		clears bool
	}{
		{"revoked", 401, `{"code":"AUTHENTICATION_FAILED","message":"Session is invalid"}`, true},
		{"success", 204, "", true},
		{"unexpected-success-html", 200, `<html>Sign in</html>`, false},
		{"unexpected-success-json", 200, `{"loggedOut":true}`, false},
		{"unknown-code", 401, `{"code":"UNKNOWN_AUTH","message":"Unknown"}`, false},
		{"html", 401, `<html>Unauthorized</html>`, false},
		{"truncated-json", 401, `{"code":"AUTHENTICATION_FAILED","message":`, false},
		{"missing-message", 401, `{"code":"AUTHENTICATION_FAILED"}`, false},
		{"duplicate-code", 401, `{"code":"UNKNOWN_AUTH","code":"AUTHENTICATION_FAILED","message":"Invalid"}`, false},
		{"forbidden", 403, `{"code":"AUTHENTICATION_FAILED","message":"Invalid"}`, false},
		{"server-failure", 503, `{"code":"AUTHENTICATION_FAILED","message":"Unavailable"}`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			var calls atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Method != "POST" || r.URL.Path != "/api/v1/logout" || r.Header.Get("Authorization") != "Bearer selected-core-token" {
					t.Error("wrong logout request")
				}
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, test.body)
			}))
			defer core.Close()
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			t.Setenv("PIWORK_CONFIG_PATH", path)
			store := client.CredentialStore{Path: path}
			if err := store.Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "selected-core-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			var out, diagnostic bytes.Buffer
			code := runUser([]string{"--core", core.URL, "--json", "logout"}, &out, &diagnostic)
			if calls.Load() != 1 {
				t.Fatal("logout was replayed", calls.Load())
			}
			if test.clears {
				if code != 0 || out.String() != "{\"loggedOut\":true}\n" || diagnostic.Len() != 0 {
					t.Fatal(code, out.String(), diagnostic.String())
				}
				if _, err := os.Stat(path); !os.IsNotExist(err) {
					t.Fatal("credential retained", err)
				}
			} else {
				after, err := os.ReadFile(path)
				if code == 0 || bytes.Contains(out.Bytes(), []byte("loggedOut")) || err != nil || !bytes.Equal(before, after) {
					t.Fatal("unconfirmed response cleared credential or reported success", code, err)
				}
			}
		})
	}
}

func TestLogoutClearFailureDoesNotReportSuccessOrReplay(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if err := os.Chmod(filepath.Dir(path), 0755); err != nil {
			t.Error(err)
		}
		w.WriteHeader(401)
		_, _ = io.WriteString(w, `{"code":"AUTHENTICATION_FAILED","message":"Revoked"}`)
	}))
	defer core.Close()
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	var out, diagnostic bytes.Buffer
	code := runUser([]string{"--json", "logout"}, &out, &diagnostic)
	after, err := os.ReadFile(path)
	if code == 0 || out.Len() != 0 || diagnostic.Len() == 0 || calls.Load() != 1 || err != nil || !bytes.Equal(before, after) {
		t.Fatal("failed clear reported success, changed credential or replayed", code, calls.Load(), err)
	}
}
