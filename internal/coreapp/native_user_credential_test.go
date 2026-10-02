package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
	"piwork/internal/identity"
)

// Build a real CLI executable instead of invoking its entry in the test process.
// The build is local and needs no Engine or model; the subprocess has no tools.
func TestNativeUserCredentialAndLogoutProcesses(t *testing.T) {
	_, source, _, _ := runtime.Caller(0)
	root := filepath.Clean(filepath.Join(filepath.Dir(source), "../.."))
	binary := filepath.Join(t.TempDir(), "piwork-cli")
	build := exec.Command("go", "build", "-mod=readonly", "-o", binary, "./cmd/piwork-cli")
	build.Dir = root
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatal("build native CLI", err, string(output))
	}
	ctx := context.Background()
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	invoke := func(path, selected string, args ...string) (int, string) {
		t.Helper()
		deadline, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		command := exec.CommandContext(deadline, binary, append([]string{"--core", selected, "--json"}, args...)...)
		command.Dir = t.TempDir()
		command.Env = []string{"PIWORK_CONFIG_PATH=" + path, "PATH=/nonexistent-piwork-test-tools"}
		output, err := command.CombinedOutput()
		if deadline.Err() != nil {
			t.Fatal("native CLI exceeded deadline")
		}
		code := 0
		if err != nil {
			failure, ok := err.(*exec.ExitError)
			if !ok {
				t.Fatal(err)
			}
			code = failure.ExitCode()
		}
		return code, string(output)
	}
	for _, kind := range []string{"valid", "revoked", "expired", "disabled"} {
		t.Run(kind, func(t *testing.T) {
			account := "admin"
			if kind == "disabled" {
				user, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "disabled-fixture", "development-fixture-pass", "user")
				if err != nil {
					t.Fatal(err)
				}
				account = string(user.Account)
			}
			login, err := a.Identity.Login(ctx, account, "development-fixture-pass", "native-process-fixture")
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			value := client.Credential{Version: 1, CoreURL: base, Token: login.Token, ExpiresAt: login.ExpiresAt,
				User: client.Identity{ID: login.User.ID, Account: login.User.Account, Role: login.User.Role}}
			if err := (client.CredentialStore{Path: path}).Save(value); err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "revoked":
				err = a.Identity.Logout(ctx, login.Token)
			case "expired":
				err = a.Store.Write(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec("UPDATE login_sessions SET expires_at=? WHERE token_digest=?", time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano), identity.TokenDigest(login.Token))
					return err
				})
			case "disabled":
				err = a.Identity.SetEnabled(ctx, identity.OperatorPrincipal(), login.User.ID, false)
			}
			if err != nil {
				t.Fatal(err)
			}
			if kind != "valid" {
				status, body := httpCall(t, base, "/api/v1/me", "GET", "Bearer "+login.Token, nil)
				if status != 401 || body["code"] != "AUTHENTICATION_FAILED" {
					t.Fatal("fixture session is still valid", status)
				}
			}
			if code, output := invoke(path, base, "logout"); code != 0 || strings.TrimSpace(output) != `{"loggedOut":true}` {
				t.Fatal("real Core session logout failed", code, output)
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("logout retained credential", err)
			}
			if _, err := a.Identity.Authenticate(ctx, login.Token); err == nil {
				t.Fatal("logout left session valid")
			}
		})
	}
	var received atomic.Int32
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received.Add(1)
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"code":"AUTHENTICATION_FAILED","message":"Invalid session"}`))
	}))
	defer foreign.Close()
	for _, kind := range []string{"public-parent", "parent-link", "file-link", "foreign-core", "offline"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			value := client.Credential{Version: 1, CoreURL: foreign.URL, Token: "must-not-be-sent", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
			if err := (client.CredentialStore{Path: path}).Save(value); err != nil {
				t.Fatal(err)
			}
			originalPath := path
			selected := foreign.URL
			command := "whoami"
			switch kind {
			case "public-parent":
				if err := os.Chmod(filepath.Dir(path), 0777); err != nil {
					t.Fatal(err)
				}
			case "parent-link":
				link := filepath.Join(t.TempDir(), "linked")
				if err := os.Symlink(filepath.Dir(path), link); err != nil {
					t.Fatal(err)
				}
				path = filepath.Join(link, "client.json")
			case "file-link":
				originalPath = filepath.Join(filepath.Dir(path), "original.json")
				if err := os.Rename(path, originalPath); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(originalPath, path); err != nil {
					t.Fatal(err)
				}
			case "foreign-core":
				selected, command = base, "logout"
			case "offline":
				dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
				selected = dead.URL
				dead.Close()
				value.CoreURL = selected
				if err := (client.CredentialStore{Path: path}).Save(value); err != nil {
					t.Fatal(err)
				}
				command = "logout"
			}
			before, err := os.ReadFile(originalPath)
			if err != nil {
				t.Fatal(err)
			}
			previous := received.Load()
			code, output := invoke(path, selected, command)
			after, err := os.ReadFile(originalPath)
			if code == 0 || strings.Contains(output, "loggedOut") || strings.Contains(output, value.Token) || received.Load() != previous || err != nil || !bytes.Equal(before, after) {
				t.Fatal("unsafe, foreign or offline credential used or removed", code, err)
			}
		})
	}
	t.Run("cancel", func(t *testing.T) {
		entered := make(chan struct{}, 1)
		var calls atomic.Int32
		core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			calls.Add(1)
			entered <- struct{}{}
			<-r.Context().Done()
		}))
		defer core.Close()
		path := filepath.Join(t.TempDir(), "credentials", "client.json")
		if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "cancel-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
			t.Fatal(err)
		}
		before, _ := os.ReadFile(path)
		command := exec.Command(binary, "--json", "logout")
		command.Env = []string{"PIWORK_CONFIG_PATH=" + path, "PATH=/nonexistent-piwork-test-tools"}
		var output bytes.Buffer
		command.Stdout, command.Stderr = &output, &output
		if err := command.Start(); err != nil {
			t.Fatal(err)
		}
		defer command.Process.Kill()
		select {
		case <-entered:
		case <-time.After(5 * time.Second):
			t.Fatal("logout did not reach Core")
		}
		if err := command.Process.Signal(os.Interrupt); err != nil {
			t.Fatal(err)
		}
		done := make(chan error, 1)
		go func() { done <- command.Wait() }()
		select {
		case err := <-done:
			failure, ok := err.(*exec.ExitError)
			if !ok || failure.ExitCode() != 130 {
				t.Fatal("cancelled logout did not exit 130", err)
			}
		case <-time.After(5 * time.Second):
			t.Fatal("cancelled logout did not finish")
		}
		after, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(before, after) || calls.Load() != 1 || strings.Contains(output.String(), "loggedOut") {
			t.Fatal("cancelled logout removed credential, replayed or reported success", err)
		}
	})
}
