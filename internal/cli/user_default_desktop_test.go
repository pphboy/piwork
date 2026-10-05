package cli

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/client"
)

func TestDefaultDesktopDispatchAndOriginBoundToken(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	t.Setenv("PIWORK_CORE_URL", "")
	saved := client.Credential{Version: 1, CoreURL: "https://saved.example/", Token: "fixture-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	if err := (client.CredentialStore{Path: path}).Save(saved); err != nil {
		t.Fatal(err)
	}
	prefs := client.DesktopPreferencesStore{CredentialPath: path}
	if _, err := prefs.Save(context.Background(), "http://default.example", nil); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		args        []string
		core, token string
	}{
		{nil, "http://default.example/", ""},
		{[]string{"--core", "https://saved.example"}, "https://saved.example/", saved.Token},
		{[]string{"--core", "http://saved.example"}, "http://saved.example/", ""},
		{[]string{"--core", "http://192.168.14.134:7171", "desktop", "--no-open"}, "http://192.168.14.134:7171/", ""},
		{[]string{"desktop", "--port", "17901", "--no-open"}, "http://default.example/", ""},
	} {
		called := false
		launch := func(api *client.Client, store client.CredentialStore, credential *client.Credential, args []string, out, diagnostic io.Writer) int {
			called = true
			if api.Base.String() != test.core || api.Token != test.token || store.Path != path {
				t.Fatal("Desktop used wrong Core, token or state path")
			}
			return 42
		}
		var out, diagnostic bytes.Buffer
		if code := runUserWithDesktop(test.args, &out, &diagnostic, launch); code != 42 || !called {
			t.Fatal("default/explicit launch", test.args, code, diagnostic.String())
		}
	}
}

func TestDefaultDesktopEarlyReturnsNeverLaunchOrCreateState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "absent", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	t.Setenv("PIWORK_CORE_URL", "bad")
	for _, test := range []struct {
		args []string
		code int
	}{
		{[]string{"help"}, 0}, {[]string{"--help"}, 0}, {[]string{"-h"}, 0}, {[]string{"--version"}, 0}, {[]string{"version"}, 0},
		{[]string{"--json"}, 0}, {[]string{"--core", "bad", "--json"}, 0},
		{[]string{"--port", "17901"}, 2}, {[]string{"--no-open"}, 2}, {[]string{"--core", ""}, 2}, {[]string{"--core", "bad", "--core", "other"}, 2},
		{[]string{"unknown"}, 2}, {[]string{"--json", "desktop"}, 2}, {[]string{"--json", "proxy"}, 2},
	} {
		var out, diagnostic bytes.Buffer
		code := runUserWithDesktop(test.args, &out, &diagnostic, func(*client.Client, client.CredentialStore, *client.Credential, []string, io.Writer, io.Writer) int {
			t.Fatal("early return launched Desktop")
			return 99
		})
		if code != test.code {
			t.Fatal(test.args, code, diagnostic.String())
		}
		if _, err := os.Stat(filepath.Dir(path)); !os.IsNotExist(err) {
			t.Fatal("early return created state", err)
		}
	}
}
