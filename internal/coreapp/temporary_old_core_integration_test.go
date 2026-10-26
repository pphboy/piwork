//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/testsupport"
)

// The binary is built from the pre-change revision with the current Agent
// image selected by its fixture build; no production downgrade is performed.
func TestNativeNewAgentRejectsTemporaryModeAgainstOldCore(t *testing.T) {
	binary, image := os.Getenv("PIWORK_TEST_OLD_CORE_BINARY"), os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if binary == "" || image == "" {
		t.Skip("set PIWORK_TEST_OLD_CORE_BINARY and PIWORK_TEST_NATIVE_AGENT_IMAGE")
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("old Core installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	store, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	seedProcessRuntime(t, directory, image)
	cmd := exec.CommandContext(ctx, binary, processStartupArgs(t, directory)...)
	cmd.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + host, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass"}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	stderr, err := os.Create(filepath.Join(t.TempDir(), "old-core.log"))
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = stderr.Close() })
	line := make(chan []byte, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		if scanner.Scan() {
			line <- append([]byte(nil), scanner.Bytes()...)
		} else {
			line <- nil
		}
	}()
	var announcement struct {
		Event string
		URL   string `json:"coreUrl"`
	}
	select {
	case rawLine := <-line:
		if json.Unmarshal(rawLine, &announcement) != nil || announcement.Event != "app.listening" || announcement.URL == "" {
			t.Fatal("old Core did not announce its listener")
		}
	case <-time.After(45 * time.Second):
		t.Fatal("old Core did not start")
	}
	base := announcement.URL
	deadline := time.Now().Add(45 * time.Second)
	for {
		if status, _ := httpCall(t, base, "/readyz", http.MethodGet, "", nil); status == 200 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("old Core did not become ready")
		}
		time.Sleep(200 * time.Millisecond)
	}
	status, login := httpCall(t, base, "/api/v1/login", http.MethodPost, "", map[string]any{"account": "admin", "password": "development-fixture-pass"})
	if status != 200 {
		t.Fatal("old Core login rejected", status)
	}
	auth := "Bearer " + login["token"].(string)
	status, accepted := httpCall(t, base, "/api/v1/works", http.MethodPost, auth, map[string]any{"name": "Old Core fixture", "idempotencyKey": "old-core-work"})
	if status != 202 {
		t.Fatal("old Core Work rejected", status)
	}
	deadline = time.Now().Add(90 * time.Second)
	for {
		status, op := httpCall(t, base, "/api/v1/operations/"+accepted["operationId"].(string), http.MethodGet, auth, nil)
		if status == 200 && op["state"] == "succeeded" {
			break
		}
		if time.Now().After(deadline) || op["state"] == "failed" {
			t.Fatal("old Core Work failed", status, op)
		}
		time.Sleep(200 * time.Millisecond)
	}
	workID := accepted["workId"].(string)
	path := "/api/v1/works/" + workID
	status, session := httpCall(t, base, path+"/sessions", http.MethodPost, auth, map[string]string{"idempotencyKey": "old-core-session"})
	if status != 201 {
		t.Fatal("old Core session rejected", status)
	}
	status, submitted := httpCall(t, base, path+"/runs", http.MethodPost, auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "old-core-temp-attempt", "prompt": "force temporary unsupported fixture"})
	if status != 202 {
		t.Fatal("old Core Run rejected", status)
	}
	runID := submitted["run"].(map[string]any)["runId"].(string)
	deadline = time.Now().Add(45 * time.Second)
	for {
		status, run := httpCall(t, base, path+"/runs/"+runID, http.MethodGet, auth, nil)
		if status == 200 && run["state"] == float64(4) {
			encoded, _ := json.Marshal(run)
			if !strings.Contains(string(encoded), "temporary-probe-unavailable") {
				t.Fatal("new Agent did not report old Core capability absence", string(encoded))
			}
			break
		}
		if time.Now().After(deadline) || run["state"] == float64(5) {
			t.Fatal("old Core Run did not finish", status, run)
		}
		time.Sleep(200 * time.Millisecond)
	}
	status, services := httpCall(t, base, path+"/services", http.MethodGet, auth, nil)
	if status != 200 || len(services["services"].([]any)) != 0 {
		t.Fatal("unsupported temporary request created a durable Service", status, services)
	}
	if _, err := os.Stat(filepath.Join(directory, ".run-temporary-services-v1")); !os.IsNotExist(err) {
		t.Fatal("unsupported Core unexpectedly wrote temporary state", err)
	}
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal("old Core did not stop cleanly", err)
	}
	// Once the new implementation persists temporary ownership, the older
	// binary must reject the installation instead of ignoring that state.
	store, err = corestore.Open(ctx, corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-upgrade-guard", Generation: 1, InstanceID: "agent-upgrade-guard"}
	if _, err := store.OpenTemporaryRunLease(ctx, owner, time.Now().UTC().Format(time.RFC3339Nano)); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	oldContext, stopOld := context.WithTimeout(ctx, 10*time.Second)
	defer stopOld()
	oldAgain := exec.CommandContext(oldContext, binary, processStartupArgs(t, directory)...)
	oldAgain.Env = cmd.Env
	output, err := oldAgain.CombinedOutput()
	if err == nil || oldContext.Err() != nil || !strings.Contains(string(output), "CORE_STORAGE_FORMAT_UNSUPPORTED") {
		t.Fatal("old Core did not reject the guarded installation", err, string(output))
	}
}
