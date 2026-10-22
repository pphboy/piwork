package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/testsupport/sqlitefixture"
)

func TestSQLiteReaderChild(t *testing.T) { sqlitefixture.ReaderChild(t) }

// The default path exercises the real Run/signal owner in a test subprocess.
// PIWORK_TEST_CORE_BINARY runs the identical scenario against the built ELF.
func TestCoreWALProcessChild(t *testing.T) {
	if os.Getenv("PIWORK_CORE_PROCESS_CHILD") != "1" {
		return
	}
	var args []string
	if err := json.Unmarshal([]byte(os.Getenv("PIWORK_CORE_PROCESS_ARGS")), &args); err != nil {
		t.Fatal(err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
	defer stop()
	os.Exit(Run(ctx, args, os.Stdout, os.Stderr))
}

type walCoreProcess struct {
	command        *exec.Cmd
	done           chan error
	stdout, stderr lockedOutput
	coreURL        string
	finished       bool
}

func walProcessPort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func startWALCoreProcess(t *testing.T, directory string, uiPort, corePort int) *walCoreProcess {
	t.Helper()
	args := []string{"--data-dir", directory, "--ui-port", strconv.Itoa(uiPort), "--core-port", strconv.Itoa(corePort)}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	binary := os.Getenv("PIWORK_TEST_CORE_BINARY")
	childArgs := args
	if binary == "" {
		binary = os.Args[0]
		childArgs = []string{"-test.run=^TestCoreWALProcessChild$"}
	}
	p := &walCoreProcess{command: exec.CommandContext(ctx, binary, childArgs...), done: make(chan error, 1)}
	env := make([]string, 0)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if strings.HasPrefix(key, "PIWORK_") || key == "DISPLAY" || key == "WAYLAND_DISPLAY" || key == "DOCKER_CONTEXT" || key == "DOCKER_HOST" || key == "DOCKER_CONFIG" || key == "PATH" {
			continue
		}
		env = append(env, entry)
	}
	encoded, _ := json.Marshal(args)
	env = append(env, "PIWORK_CORE_PROCESS_CHILD=1", "PIWORK_CORE_PROCESS_ARGS="+string(encoded),
		"PIWORK_ADMIN_ACCOUNT=wal-process-test", "PIWORK_ADMIN_PASSWORD=wal-process-synthetic-password",
		"DOCKER_HOST=unix://"+filepath.Join(t.TempDir(), "absent.sock"), "DOCKER_CONFIG="+t.TempDir(), "PATH="+t.TempDir())
	p.command.Env = env
	p.command.Stdout = &p.stdout
	p.command.Stderr = &p.stderr
	if err := p.command.Start(); err != nil {
		t.Fatal(err)
	}
	go func() { p.done <- p.command.Wait() }()
	t.Cleanup(func() {
		if !p.finished {
			_ = p.command.Process.Kill()
			<-p.done
			p.finished = true
		}
	})
	deadline := time.NewTimer(15 * time.Second)
	defer deadline.Stop()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		for _, line := range strings.Split(p.stdout.text(), "\n") {
			var event struct {
				Event   string `json:"event"`
				CoreURL string `json:"coreUrl"`
				PID     int    `json:"pid"`
			}
			if json.Unmarshal([]byte(line), &event) == nil && event.Event == "app.listening" {
				if event.PID != p.command.Process.Pid {
					t.Fatal("unexpected Core process identity")
				}
				p.coreURL = event.CoreURL
				return p
			}
		}
		select {
		case err := <-p.done:
			p.finished = true
			t.Fatalf("Core failed before listening: %v; %s", err, p.stderr.text())
		case <-deadline.C:
			t.Fatal("Core did not announce listening")
		case <-tick.C:
		}
	}
}

func (p *walCoreProcess) stop(t *testing.T) int {
	t.Helper()
	if err := p.command.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-p.done:
		p.finished = true
		if err == nil {
			return 0
		}
		var exited *exec.ExitError
		if errors.As(err, &exited) {
			return exited.ExitCode()
		}
		t.Fatal(err)
	case <-time.After(15 * time.Second):
		t.Fatal("Core did not finish bounded shutdown")
	}
	return -1
}

func walProcessRequest(t *testing.T, base, path, method, token string, body any) map[string]any {
	t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, err := http.NewRequest(method, base+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	transport := &http.Transport{Proxy: nil}
	defer transport.CloseIdleConnections()
	client := &http.Client{Timeout: 3 * time.Second, Transport: transport}
	response, err := client.Do(req)
	if err != nil {
		t.Fatal("Core request failed", err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("Core request rejected", path, response.StatusCode)
	}
	var result map[string]any
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestCoreProcessCheckpointFailureAndWALReopen(t *testing.T) {
	// The product RPC port is fixed. Never stop or take over an existing Core.
	reservation, err := net.Listen("tcp4", "0.0.0.0:7172")
	if err != nil {
		t.Skip("Agent RPC 7172 belongs to another process; use an isolated network namespace")
	}
	reservation.Close()
	directory := filepath.Join(t.TempDir(), "core")
	uiPort, corePort := walProcessPort(t), walProcessPort(t)
	for corePort == uiPort || corePort == 7172 {
		corePort = walProcessPort(t)
	}
	for uiPort == 7172 {
		uiPort = walProcessPort(t)
	}
	p := startWALCoreProcess(t, directory, uiPort, corePort)
	login := walProcessRequest(t, p.coreURL, "/api/v1/login", "POST", "", map[string]string{"account": "wal-process-test", "password": "wal-process-synthetic-password"})
	token, ok := login["token"].(string)
	if !ok || token == "" {
		t.Fatal("Core did not create a login session")
	}
	marker, err := os.ReadFile(filepath.Join(directory, corestore.MarkerName))
	if err != nil {
		t.Fatal(err)
	}
	if code := p.stop(t); code != 0 {
		t.Fatal("normal shutdown failed", code)
	}
	p = startWALCoreProcess(t, directory, uiPort, corePort)
	walProcessRequest(t, p.coreURL, "/api/v1/me", "GET", token, nil)
	release := sqlitefixture.PartialWAL(t, filepath.Join(directory, corestore.DatabaseName))
	if code := p.stop(t); code == 0 {
		t.Fatal("checkpoint busy incorrectly exited zero")
	}
	if !strings.Contains(p.stderr.text(), "shutdown was not confirmed") {
		t.Fatal("missing safe shutdown diagnostic")
	}
	release()
	p = startWALCoreProcess(t, directory, uiPort, corePort)
	walProcessRequest(t, p.coreURL, "/api/v1/me", "GET", token, nil)
	db := sqlitefixture.Open(t, filepath.Join(directory, corestore.DatabaseName), true, false)
	var value string
	if err := db.QueryRow("SELECT value_json FROM control_metadata WHERE key='wal-fixture-00999'").Scan(&value); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if value != sqlitefixture.Value(999) {
		t.Fatal("reopened Core lost committed WAL data")
	}
	if code := p.stop(t); code != 0 {
		t.Fatal("recovered Core cannot shut down normally", code)
	}
	after, err := os.ReadFile(filepath.Join(directory, corestore.MarkerName))
	if err != nil || !bytes.Equal(marker, after) {
		t.Fatal("reopen changed storage marker", err)
	}
	for _, port := range []int{uiPort, corePort, 7172} {
		listener, err := net.Listen("tcp4", "0.0.0.0:"+strconv.Itoa(port))
		if err != nil {
			t.Fatal("Core retained a listener", port, err)
		}
		listener.Close()
	}
	t.Log("normal exit 0; blocked checkpoint nonzero; direct WAL reopen preserves login, committed value and marker; no host tools")
}
