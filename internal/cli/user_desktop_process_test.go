package cli

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopHelperProcess(t *testing.T) {
	if os.Getenv("PIWORK_TEST_DESKTOP_CHILD") != "1" {
		return
	}
	api, err := client.New("http://192.0.2.1:1", "")
	if err != nil {
		os.Exit(91)
	}
	store := client.CredentialStore{Path: filepath.Join(os.TempDir(), "piwork-test-desktop-credential-never-read")}
	args := []string{"--port", os.Getenv("PIWORK_TEST_DESKTOP_PORT")}
	if os.Getenv("PIWORK_TEST_DESKTOP_OPEN") != "1" {
		args = append(args, "--no-open")
	}
	os.Exit(runUserDesktop(api, store, nil, args, os.Stdout, os.Stderr))
}

func TestNativeDesktopMissingBrowserOpenerPrintsManualAddress(t *testing.T) {
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := free.Addr().(*net.TCPAddr).Port
	_ = free.Close()
	command := nativeTestCommand(t, "-test.run=^TestNativeDesktopHelperProcess$")
	command.Env = []string{"PIWORK_TEST_DESKTOP_CHILD=1", "PIWORK_TEST_DESKTOP_OPEN=1", "PIWORK_TEST_DESKTOP_PORT=" + strconv.Itoa(port), "PATH=" + filepath.Join(t.TempDir(), "no-browser-opener")}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		}
	})
	line := make(chan string, 1)
	go func() { text, _ := bufio.NewReader(stdout).ReadString('\n'); line <- text }()
	var launch string
	select {
	case launch = <-line:
	case <-time.After(5 * time.Second):
		t.Fatal("Desktop did not start without opener")
	}
	manual := make(chan string, 1)
	go func() { text, _ := bufio.NewReader(stderr).ReadString('\n'); manual <- text }()
	var diagnostic string
	select {
	case diagnostic = <-manual:
	case <-time.After(5 * time.Second):
		t.Fatal("Desktop did not show manual address when opener was absent")
	}
	if err := interruptTestProcess(command); err != nil {
		t.Fatal(err)
	}
	if err := command.Wait(); errorCode(err) != 130 {
		t.Fatal("Desktop did not close", err)
	}
	if !strings.Contains(diagnostic, "Could not open a browser. Open "+strings.TrimSpace(strings.TrimPrefix(launch, "Piwork Desktop: "))+" manually.") {
		t.Fatal("missing manual browser address", diagnostic, launch)
	}
}

func TestNativeDesktopEmbeddedProcessLoadsFromArbitraryDirectory(t *testing.T) {
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	busyPort := occupied.Addr().(*net.TCPAddr).Port
	busy := nativeTestCommand(t, "-test.run=^TestNativeDesktopHelperProcess$")
	busy.Env = []string{"PIWORK_TEST_DESKTOP_CHILD=1", "PIWORK_TEST_DESKTOP_PORT=" + strconv.Itoa(busyPort), "PATH=" + filepath.Join(t.TempDir(), "no-host-tools")}
	busyOutput, busyErr := busy.CombinedOutput()
	_ = occupied.Close()
	if errorCode(busyErr) != 6 || strings.Contains(string(busyOutput), "Piwork Desktop:") {
		t.Fatal("Desktop changed occupied port or printed a launch URL", busyErr, string(busyOutput))
	}
	free, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := free.Addr().(*net.TCPAddr).Port
	_ = free.Close()
	command := nativeTestCommand(t, "-test.run=^TestNativeDesktopHelperProcess$")
	command.Dir = t.TempDir()
	command.Env = []string{"PIWORK_TEST_DESKTOP_CHILD=1", "PIWORK_TEST_DESKTOP_PORT=" + strconv.Itoa(port), "PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "HOME=" + t.TempDir()}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if command.ProcessState == nil {
			_ = command.Process.Kill()
			_, _ = command.Process.Wait()
		}
	})
	line := make(chan string, 1)
	go func() { text, _ := bufio.NewReader(stdout).ReadString('\n'); line <- text }()
	var launch string
	select {
	case launch = <-line:
	case <-time.After(5 * time.Second):
		t.Fatal("Desktop did not listen")
	}
	if !strings.HasPrefix(launch, "Piwork Desktop: http://desktop.localhost:") || !strings.Contains(launch, "#ticket=") {
		t.Fatal("Desktop launch URL", launch)
	}
	ticket := strings.TrimSpace(strings.SplitN(launch, "#ticket=", 2)[1])
	base := "http://127.0.0.1:" + strconv.Itoa(port)
	request := func(method, path, body, origin string) *http.Response {
		t.Helper()
		req, err := http.NewRequest(method, base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Host = "desktop.localhost:" + strconv.Itoa(port)
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		response, err := (&http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}}).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return response
	}
	response := request("GET", "/", "", "")
	page, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(string(page), "PiWork Desktop") {
		t.Fatal("embedded page unavailable", response.StatusCode)
	}
	response = request("GET", "/desktop/browser/app.js", "", "")
	script, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 200 || !strings.Contains(string(script), "adapter.initialize") {
		t.Fatal("embedded app unavailable", response.StatusCode)
	}
	response = request("POST", "/_desktop/api/bootstrap", `{"ticket":"`+ticket+`"}`, "http://desktop.localhost:"+strconv.Itoa(port))
	var session map[string]any
	if json.NewDecoder(response.Body).Decode(&session) != nil || response.StatusCode != 200 || session["authorized"] != true {
		t.Fatal("offline Desktop bootstrap failed", response.StatusCode, session)
	}
	cookie := response.Header.Get("Set-Cookie")
	response.Body.Close()
	if cookie == "" {
		t.Fatal("Desktop did not set local cookie")
	}
	if err := interruptTestProcess(command); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- command.Wait() }()
	select {
	case err := <-finished:
		if errorCode(err) != 130 {
			data, _ := io.ReadAll(stderr)
			t.Fatal("Desktop did not close on SIGINT", err, string(data))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Desktop retained listener after SIGINT")
	}
	// Rebinding the same local port creates a fresh authority; old browser
	// cookies and tickets must not gain access to this new listener.
	restarted := nativeTestCommand(t, "-test.run=^TestNativeDesktopHelperProcess$")
	restarted.Dir = command.Dir
	restarted.Env = command.Env
	freshOutput, err := restarted.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = restarted.Process.Kill(); _ = restarted.Wait() })
	freshLine := make(chan string, 1)
	go func() { text, _ := bufio.NewReader(freshOutput).ReadString('\n'); freshLine <- text }()
	var freshLaunch string
	select {
	case freshLaunch = <-freshLine:
	case <-time.After(5 * time.Second):
		t.Fatal("restarted Desktop did not listen")
	}
	parts := strings.SplitN(freshLaunch, "#ticket=", 2)
	if len(parts) != 2 {
		t.Fatal("restart ticket absent", freshLaunch)
	}
	freshTicket := strings.TrimSpace(parts[1])
	if freshTicket == ticket {
		t.Fatal("restart reused authority")
	}
	response = request("POST", "/_desktop/api/bootstrap", `{"ticket":"`+ticket+`"}`, "http://desktop.localhost:"+strconv.Itoa(port))
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("old restart ticket accepted", response.StatusCode)
	}
	oldCookieReq, _ := http.NewRequest("GET", base+"/_desktop/api/identity", nil)
	oldCookieReq.Host = "desktop.localhost:" + strconv.Itoa(port)
	oldCookieReq.Header.Set("Cookie", strings.SplitN(cookie, ";", 2)[0])
	response, err = (&http.Client{Timeout: 5 * time.Second}).Do(oldCookieReq)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 401 {
		t.Fatal("old restart cookie accepted", response.StatusCode)
	}
	response = request("POST", "/_desktop/api/bootstrap", `{"ticket":"`+freshTicket+`"}`, "http://desktop.localhost:"+strconv.Itoa(port))
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("new restart authority rejected", response.StatusCode)
	}
}
