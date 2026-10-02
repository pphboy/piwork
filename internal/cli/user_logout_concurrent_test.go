//go:build linux

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/client"
)

func TestLogoutConcurrentLoginProcesses(t *testing.T) {
	binary := filepath.Join(t.TempDir(), "piwork-cli")
	build := exec.Command("go", "build", "-mod=readonly", "-o", binary, "./cmd/piwork-cli")
	build.Dir = "../.."
	if result, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build: %v %s", err, result)
	}
	for _, otherCore := range []bool{false, true} {
		for _, status := range []int{204, 401} {
			name := "same-core"
			if otherCore {
				name = "different-core"
			}
			if status == 401 {
				name += "-invalid-session"
			}
			t.Run(name, func(t *testing.T) {
				requested, release := make(chan struct{}), make(chan struct{})
				var releaseOnce sync.Once
				unblock := func() { releaseOnce.Do(func() { close(release) }) }
				defer unblock()
				var logoutCalls atomic.Int32
				handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					switch r.URL.Path {
					case "/api/v1/logout":
						logoutCalls.Add(1)
						if r.Header.Get("Authorization") != "Bearer old-token" {
							t.Error("wrong old-session bearer")
						}
						close(requested)
						select {
						case <-release:
						case <-r.Context().Done():
							return
						}
						if status == 401 {
							w.Header().Set("Content-Type", "application/json")
						}
						w.WriteHeader(status)
						if status == 401 {
							_, _ = io.WriteString(w, `{"code":"AUTHENTICATION_FAILED","message":"Old session invalid"}`)
						}
					case "/api/v1/login":
						if r.Header.Get("Authorization") != "" {
							t.Error("login borrowed saved bearer")
						}
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(map[string]any{"token": "new-token", "expiresAt": "2099-01-01T00:00:00Z", "user": client.Identity{ID: "owner", Account: "owner", Role: "user"}})
					default:
						w.WriteHeader(404)
					}
				})
				core := httptest.NewServer(handler)
				defer core.Close()
				loginURL := core.URL
				if otherCore {
					second := httptest.NewServer(handler)
					defer second.Close()
					loginURL = second.URL
				}
				// Cleanup must release the handler before either server is closed.
				defer unblock()
				path := filepath.Join(t.TempDir(), "credentials", "client.json")
				store := client.CredentialStore{Path: path}
				old := client.Credential{Version: 1, CoreURL: core.URL, Token: "old-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
				if err := store.Save(old); err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				command := func(url string, args ...string) *exec.Cmd {
					cmd := exec.CommandContext(ctx, binary, append([]string{"--core", url, "--json"}, args...)...)
					cmd.Env = []string{"PIWORK_CONFIG_PATH=" + path, "PATH=/nonexistent-piwork-tools"}
					return cmd
				}
				var out, diagnostic bytes.Buffer
				logout := command(core.URL, "logout")
				logout.Stdout = &out
				logout.Stderr = &diagnostic
				if err := logout.Start(); err != nil {
					t.Fatal(err)
				}
				defer func() { _ = logout.Process.Kill() }()
				select {
				case <-requested:
				case <-ctx.Done():
					t.Fatal("logout request timed out")
				}
				login := command(loginURL, "login", "--account", "owner", "--password-stdin")
				login.Stdin = strings.NewReader("fixture-password\n")
				if result, err := login.CombinedOutput(); err != nil {
					t.Fatalf("concurrent login: %v %s", err, result)
				}
				before, err := os.ReadFile(path)
				if err != nil {
					t.Fatal(err)
				}
				if saved, err := store.Load(); err != nil || saved == nil || saved.Token != "new-token" || !sameCoreOrigin(saved.CoreURL, loginURL) {
					t.Fatal("new login not saved", err)
				}
				unblock()
				if err := logout.Wait(); err != nil {
					t.Fatal("logout failed", err, diagnostic.String())
				}
				after, err := os.ReadFile(path)
				if err != nil || !bytes.Equal(before, after) || out.String() != "{\"loggedOut\":true}\n" || diagnostic.Len() != 0 || logoutCalls.Load() != 1 {
					t.Fatal("new session lost, logout replayed or wrong output", err, out.String(), diagnostic.String(), logoutCalls.Load())
				}
			})
		}
	}
}

func TestLogoutConditionalCleanupOutcomes(t *testing.T) {
	for _, kind := range []string{"absent", "lock-busy", "malformed"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			var lockFD atomic.Int32
			lockFD.Store(-1)
			defer func() {
				if fd := lockFD.Load(); fd >= 0 {
					_ = unix.Close(int(fd))
				}
			}()
			var calls atomic.Int32
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				switch kind {
				case "absent":
					if err := os.Remove(path); err != nil {
						t.Error(err)
					}
				case "malformed":
					if err := os.WriteFile(path, []byte("{bad json"), 0600); err != nil {
						t.Error(err)
					}
				case "lock-busy":
					fd, err := unix.Open(filepath.Dir(path), unix.O_RDONLY|unix.O_DIRECTORY, 0)
					if err != nil {
						t.Error(err)
						return
					}
					lockFD.Store(int32(fd))
					if err := unix.Flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
						t.Error(err)
					}
				}
				w.WriteHeader(204)
			}))
			defer core.Close()
			t.Setenv("PIWORK_CONFIG_PATH", path)
			store := client.CredentialStore{Path: path}
			if err := store.Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "old-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
				t.Fatal(err)
			}
			var out, diagnostic bytes.Buffer
			code := runUser([]string{"--json", "logout"}, &out, &diagnostic)
			if calls.Load() != 1 {
				t.Fatal("remote logout replayed")
			}
			if kind == "absent" {
				if code != 0 || out.String() != "{\"loggedOut\":true}\n" || diagnostic.Len() != 0 {
					t.Fatal(code, out.String(), diagnostic.String())
				}
			} else {
				if code == 0 || out.Len() != 0 || diagnostic.Len() == 0 {
					t.Fatal("failed cleanup reported success", code)
				}
				if _, err := os.Stat(path); err != nil {
					t.Fatal("failed cleanup removed record", err)
				}
			}
		})
	}
}
