//go:build integration

package coreapp

import (
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	userclient "piwork/internal/client"
)

func TestNativeDesktopNewSessionWithoutPlaywright(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node is required for the CDP integration driver")
	}
	browser, err := exec.LookPath("chromium-browser")
	if err != nil {
		t.Skip("Chromium is required for the CDP integration driver")
	}
	binary := os.Getenv("PIWORK_TEST_CLI_BINARY")
	if binary == "" {
		t.Skip("set PIWORK_TEST_CLI_BINARY to the built Desktop CLI")
	}
	_, base, authorization, workID, ctx := nativeApplyFixture(t)
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (userclient.CredentialStore{Path: credential}).Save(userclient.Credential{Version: 1, CoreURL: base,
		Token: strings.TrimPrefix(authorization, "Bearer "), ExpiresAt: "2099-01-01T00:00:00Z",
		User: userclient.Identity{ID: "cli-test-user", Account: "admin", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	desktop := exec.Command(binary, "--core", base, "desktop", "--port", strconv.Itoa(port), "--no-open")
	desktop.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credential, "DISPLAY=", "WAYLAND_DISPLAY=")
	desktop.Stdout, desktop.Stderr = io.Discard, io.Discard
	if err := desktop.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = desktop.Process.Kill(); _ = desktop.Wait() })
	origin := "http://desktop.localhost:" + strconv.Itoa(port)
	for {
		req, _ := http.NewRequestWithContext(ctx, "GET", origin+"/", nil)
		response, getErr := (&http.Client{Timeout: time.Second}).Do(req)
		if getErr == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("Desktop failed to start", ctx.Err())
		case <-time.After(100 * time.Millisecond):
		}
	}
	_, source, _, _ := runtime.Caller(0)
	script := filepath.Join(filepath.Dir(source), "..", "..", "apps", "desktop-webui", "test", "session-real-cdp.mjs")
	driveCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	driver := exec.CommandContext(driveCtx, node, script, origin, workID, browser)
	driver.Env = append(os.Environ(), "PATH=/usr/bin:/bin")
	output, err := driver.CombinedOutput()
	if err != nil {
		t.Fatalf("real Desktop Session test failed: %v: %s", err, output)
	}
	t.Log(strings.TrimSpace(string(output)))
}
