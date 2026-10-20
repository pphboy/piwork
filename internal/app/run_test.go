package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/coreapp"
)

type lockedOutput struct {
	mu   sync.Mutex
	data bytes.Buffer
}

func (w *lockedOutput) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.data.Write(data)
}
func (w *lockedOutput) text() string { w.mu.Lock(); defer w.mu.Unlock(); return w.data.String() }

func TestUnifiedHelpVersionAndWrongUserCommandsHaveNoStartupEffects(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	for _, args := range [][]string{{"--help"}, {"serve", "--no-open", "--help"}, {"--version"}, {"login"}, {"chat", "synthetic-work"}} {
		var out, stderr bytes.Buffer
		code := Run(context.Background(), args, strings.NewReader(""), &out, &stderr)
		if args[0] == "login" || args[0] == "chat" {
			if code != 2 || !strings.Contains(stderr.String(), "piwork-cli") {
				t.Fatal("wrong user entry accepted", code)
			}
		} else if code != 0 {
			t.Fatal("help/version failed", args, code)
		}
		if strings.Contains(out.String(), "setup link") {
			t.Fatal("help still advertises the removed setup link command")
		}
	}
	directory, _ := defaultDirectory()
	if _, err := os.Stat(directory); !os.IsNotExist(err) {
		t.Fatal("help/version opened the installation")
	}
}

func TestStartupRejectsInvalidOptionsBeforeCreatingData(t *testing.T) {
	for _, extra := range [][]string{{"--agent-image", "fixture/agent:override"}, {"--agent-image=fixture/agent:override"}, {"--listen", "invalid"}, {"--listen", "127.0.0.1:1", "--listen", "127.0.0.1:2"}, {"--public-origin", "http://invalid/path"}, {"--tls-cert", "missing"}, {"--service-ports", "1-65535"}, {"--service-ports", "7000-7200"}} {
		directory := filepath.Join(t.TempDir(), "uncreated")
		args := append([]string{"--data-dir", directory, "--no-open"}, extra...)
		if code := RunServe(context.Background(), args, io.Discard, io.Discard); code != 2 {
			t.Fatal("invalid startup accepted", extra, code)
		}
		if _, err := os.Stat(directory); !os.IsNotExist(err) {
			t.Fatal("invalid startup created data")
		}
	}
}

func TestBrowserOriginNeverPrintsUnspecifiedAddressAndFormatsIPv6(t *testing.T) {
	if value := browserOrigin(coreapp.ListenAddress{Host: "::1", Port: 7171}, true); value != "https://[::1]:7171" {
		t.Fatal("IPv6 URL invalid", value)
	}
	for _, host := range []string{"0.0.0.0", "::"} {
		value := browserOrigin(coreapp.ListenAddress{Host: host, Port: 7171}, false)
		if strings.Contains(value, "0.0.0.0") || strings.Contains(value, "[::]") {
			t.Fatal("unspecified browser link", value)
		}
	}
}

func TestNoArgumentsStartsOnePersistentApplicationAndReleasesItsLock(t *testing.T) {
	reservation, err := net.Listen("tcp", "0.0.0.0:7171")
	if err != nil {
		t.Skip("default port 7171 belongs to another process")
	}
	_ = reservation.Close()
	config := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", config)
	for _, name := range []string{"PIWORK_ADMIN_ACCOUNT", "PIWORK_ADMIN_PASSWORD"} {
		t.Setenv(name, "")
		_ = os.Unsetenv(name)
	}
	t.Setenv("PIWORK_LISTEN", "invalid-obsolete-listen")
	t.Setenv("DISPLAY", "")
	t.Setenv("WAYLAND_DISPLAY", "")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var out, stderr lockedOutput
	done := make(chan int, 1)
	go func() { done <- Run(ctx, nil, strings.NewReader(""), &out, &stderr) }()
	var origin string
	for i := 0; i < 200 && origin == ""; i++ {
		for _, line := range strings.Split(out.text(), "\n") {
			var event struct {
				Event string `json:"event"`
				URL   string `json:"url"`
			}
			if json.Unmarshal([]byte(line), &event) == nil && event.Event == "app.listening" {
				origin = event.URL
				break
			}
		}
		if origin == "" {
			select {
			case code := <-done:
				t.Fatal("default startup failed", code, stderr.text())
			default:
				time.Sleep(10 * time.Millisecond)
			}
		}
	}
	if origin == "" {
		t.Fatal("default startup did not open its listener")
	}
	httpClient := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 3 * time.Second}
	for _, path := range []string{"/healthz", "/setup"} {
		response, err := httpClient.Get(origin + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal("uninitialized browser/health unavailable", path, response.StatusCode)
		}
	}
	directory := filepath.Join(config, "piwork", "server")
	if code := RunServe(context.Background(), []string{"--data-dir", directory, "--listen", "127.0.0.1:7170", "--no-open"}, io.Discard, io.Discard); code != 1 {
		t.Fatal("second Core owner accepted", code)
	}
	cancel()
	select {
	case code := <-done:
		if code != 0 {
			t.Fatal("unconfigured shutdown failed", code)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("shutdown exceeded expected empty-install budget")
	}
	if strings.Contains(out.text(), "#setup=") || strings.Contains(out.text(), "First-time setup:") {
		t.Fatal("startup still issues an installer authorization link")
	}
	core, err := coreapp.New(context.Background(), coreapp.Options{DataDirectory: directory})
	if err != nil {
		t.Fatal("shutdown retained the installation lock", err)
	}
	if err := core.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestHandlerConfigurationFailureClosesListenerAndInstallationCanClose(t *testing.T) {
	directory := t.TempDir()
	core, err := coreapp.New(context.Background(), coreapp.Options{DataDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	var bound coreapp.ListenAddress
	_, err = core.ListenWithHandler(coreapp.ListenAddress{Host: "127.0.0.1", Port: 0}, func(address coreapp.ListenAddress, _ http.Handler) (http.Handler, error) {
		bound = address
		return nil, io.ErrUnexpectedEOF
	}, nil)
	if err == nil {
		t.Fatal("failing browser construction was ignored")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(bound.Host, strings.TrimPrefix(bound.URL(), "http://"+bound.Host+":")))
	if err != nil {
		t.Fatal("failed application retained listener", err)
	}
	_ = listener.Close()
	if err := core.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	core, err = coreapp.New(context.Background(), coreapp.Options{DataDirectory: directory})
	if err != nil {
		t.Fatal("failed startup retained data lock", err)
	}
	_ = core.Close(context.Background())
}

func TestMissingBrowserOpenerKeepsManualAccessGuidance(t *testing.T) {
	t.Setenv("PATH", t.TempDir())
	var stderr bytes.Buffer
	openBrowser(context.Background(), "http://192.0.2.1:7171", &stderr)
	if !strings.Contains(stderr.String(), "Open http://192.0.2.1:7171 manually") {
		t.Fatal("missing browser opener lost server URL guidance")
	}
}

func TestInvalidAdminEnvironmentHasNoFilesystemEffects(t *testing.T) {
	t.Setenv("PIWORK_ADMIN_ACCOUNT", "admin")
	t.Setenv("PIWORK_ADMIN_PASSWORD", "short")
	directory := filepath.Join(t.TempDir(), "missing-parent", "server")
	var stderr bytes.Buffer
	if code := RunServe(context.Background(), []string{"--data-dir", directory, "--no-open"}, io.Discard, &stderr); code != 2 || !strings.Contains(stderr.String(), "PIWORK_ADMIN_PASSWORD") || strings.Contains(stderr.String(), "short") {
		t.Fatal("invalid admin bootstrap projection", code)
	}
	if _, err := os.Stat(filepath.Dir(directory)); !os.IsNotExist(err) {
		t.Fatal("invalid admin bootstrap created a parent")
	}
}
