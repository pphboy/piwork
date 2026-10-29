//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestNativePreparationRecordsPermitOldCoreRollbackAndUpgrade(t *testing.T) {
	baseline := os.Getenv("PIWORK_TEST_PREPARATION_OLD_CORE")
	if baseline == "" || os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE") == "" {
		t.Skip("set PIWORK_TEST_PREPARATION_OLD_CORE and the native Agent fixture")
	}
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "rollback-history"})
	if status != 201 {
		t.Fatal("session creation failed", status, session)
	}
	sessionID := session["sessionId"].(string)
	modelNativeRun(t, ctx, base, auth, workID, sessionID, "rollback-run")
	status, history := packageHTTPCall(t, base, path+"/sessions/"+sessionID, "GET", auth, nil)
	if status != 200 || len(history["runs"].([]any)) != 1 {
		t.Fatal("fixture history was not created", status, history)
	}
	status, configuration := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 {
		t.Fatal("fixture configuration unavailable", status)
	}
	active := configuration["active"]
	installation := a.Store.InstallationID()
	var records int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM control_metadata WHERE key GLOB 'internal_preparation_v1/*'`).Scan(&records)
	}); err != nil || records == 0 {
		t.Fatal("new Core did not persist preparation records", err)
	}
	directory, options := a.options.DataDirectory, a.options
	closeCtx, closeCancel := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(closeCtx); err != nil {
		closeCancel()
		t.Fatal(err)
	}
	closeCancel()
	cmd := exec.CommandContext(ctx, baseline, processStartupArgs(t, directory)...)
	cmd.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + options.DockerOptions.DockerHost, "DOCKER_CONFIG=" + t.TempDir()}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	logFile, err := os.Create(filepath.Join(t.TempDir(), "baseline.log"))
	if err != nil {
		t.Fatal(err)
	}
	defer logFile.Close()
	cmd.Stderr = logFile
	if err := cmd.Start(); err != nil {
		t.Fatal("baseline Core did not start", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill() })
	lines := make(chan []byte, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		if scanner.Scan() {
			lines <- append([]byte(nil), scanner.Bytes()...)
		} else {
			lines <- nil
		}
	}()
	var listening struct {
		Event string
		URL   string `json:"coreUrl"`
	}
	select {
	case line := <-lines:
		if json.Unmarshal(line, &listening) != nil || listening.Event != "app.listening" || listening.URL == "" {
			t.Fatal("baseline did not announce its listener")
		}
	case <-time.After(45 * time.Second):
		t.Fatal("baseline listener timeout")
	}
	deadline := time.Now().Add(90 * time.Second)
	for {
		status, _ := packageHTTPCall(t, listening.URL, "/readyz", "GET", "", nil)
		if status == 200 {
			break
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			t.Fatal("baseline Core did not recover the installation")
		}
		time.Sleep(100 * time.Millisecond)
	}
	check := func(target string) {
		t.Helper()
		status, me := packageHTTPCall(t, target, "/api/v1/me", "GET", auth, nil)
		if status != 200 || me["account"] != "admin" {
			t.Fatal("login identity changed", status)
		}
		status, work := packageHTTPCall(t, target, path, "GET", auth, nil)
		if status != 200 || work["desiredState"] != "running" || work["observedState"] != "ready" {
			t.Fatal("Work intent or recovery changed", status, work)
		}
		status, current := packageHTTPCall(t, target, path+"/configuration", "GET", auth, nil)
		if status != 200 || !reflect.DeepEqual(active, current["active"]) {
			t.Fatal("active configuration changed", status)
		}
		status, current = packageHTTPCall(t, target, path+"/sessions/"+sessionID, "GET", auth, nil)
		if status != 200 || !reflect.DeepEqual(history["runs"], current["runs"]) {
			t.Fatal("session history changed or a Run was replayed", status)
		}
	}
	check(listening.URL)
	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatal("baseline shutdown failed", err)
	}
	if err := logFile.Sync(); err != nil {
		t.Fatal(err)
	}
	log, err := os.ReadFile(logFile.Name())
	if err != nil {
		t.Fatal(err)
	}
	// The old Core has no durable success cache. Its owner preparation span
	// confirms it performed a fresh image inspection despite the new records.
	inspected := false
	for _, line := range strings.Split(string(log), "\n") {
		var event struct{ Event, Phase, Outcome, CacheState string }
		if json.Unmarshal([]byte(line), &event) == nil && event.Event == "performance" && event.Phase == "image-inspection" && event.Outcome == "succeeded" && event.CacheState == "prepare" {
			inspected = true
		}
	}
	if !inspected {
		t.Fatal("baseline did not perform its own image inspection")
	}
	next, nextBase, _ := appFixture(t, Options{DataDirectory: directory, AgentGRPCListen: "0.0.0.0:0", PackageHelperImage: options.PackageHelperImage, FileHelperImage: options.FileHelperImage, SnapshotHelperImage: options.SnapshotHelperImage, DockerOptions: options.DockerOptions})
	if next.Store.InstallationID() != installation {
		t.Fatal("installation identity changed")
	}
	check(nextBase)
	var remaining int
	if err := next.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT count(*) FROM control_metadata WHERE key GLOB 'internal_preparation_v1/*'`).Scan(&remaining)
	}); err != nil || remaining < records {
		t.Fatal("derived records disappeared during rollback", records, remaining, err)
	}
}
