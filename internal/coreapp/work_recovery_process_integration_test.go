//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeCoreCrashAdoptsExistingAgent(t *testing.T) {
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if image == "" {
		t.Skip("set PIWORK_TEST_NATIVE_AGENT_IMAGE to a built acceptance image")
	}
	_, source, _, _ := runtime.Caller(0)
	binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-serve")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("make build-go is required", err)
	}
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
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
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	initial, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}
	start := func() (*exec.Cmd, string, *bytes.Buffer) {
		cmd := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
		cmd.Env = []string{
			"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + host, "DOCKER_CONFIG=" + t.TempDir(),
			"PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass",
			"PIWORK_AGENT_IMAGE=" + image, "PIWORK_MODEL_PROVIDER=piwork-deterministic", "PIWORK_MODEL=fixture-v1", "PIWORK_API_KEY=acceptance-only",
		}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = cmd.Process.Kill() })
		line := make(chan []byte, 1)
		go func() {
			scanner := bufio.NewScanner(stdout)
			if scanner.Scan() {
				line <- append([]byte(nil), scanner.Bytes()...)
			} else {
				line <- nil
			}
		}()
		var announcement struct{ Event, URL string }
		select {
		case rawLine := <-line:
			if json.Unmarshal(rawLine, &announcement) != nil || announcement.Event != "core.listening" || announcement.URL == "" {
				t.Fatal("Core did not announce its listener", stderr.String())
			}
		case <-time.After(45 * time.Second):
			t.Fatal("Core listener startup timed out", stderr.String())
		}
		for deadline := time.Now().Add(45 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
			if status, _ := httpCall(t, announcement.URL, "/readyz", http.MethodGet, "", nil); status == 200 {
				return cmd, announcement.URL, &stderr
			}
		}
		t.Fatal("Core recovery did not become ready", stderr.String())
		return nil, "", nil
	}
	first, base, firstErrors := start()
	status, login := httpCall(t, base, "/api/v1/login", http.MethodPost, "", map[string]any{"account": "admin", "password": "development-fixture-pass"})
	if status != 200 {
		t.Fatal("first Core login failed", status, login)
	}
	authorization := "Bearer " + login["token"].(string)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/v1/works", bytes.NewBufferString(`{"name":"Crash Recovery","idempotencyKey":"crash-recovery-create"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", authorization)
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 90 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var accepted map[string]any
	if err := json.NewDecoder(response.Body).Decode(&accepted); err != nil || response.StatusCode != 202 {
		response.Body.Close()
		t.Fatal("Work create was not accepted", response.StatusCode, accepted, err)
	}
	response.Body.Close()
	workID := accepted["workId"].(string)
	created := false
	for deadline := time.Now().Add(90 * time.Second); time.Now().Before(deadline); time.Sleep(250 * time.Millisecond) {
		status, operation := httpCall(t, base, "/api/v1/operations/"+accepted["operationId"].(string), http.MethodGet, authorization, nil)
		if status != 200 {
			t.Fatal("create Operation disappeared", status, operation)
		}
		if operation["state"] == "succeeded" {
			created = true
			break
		}
		if operation["state"] == "failed" || operation["state"] == "superseded" {
			t.Fatal("Work create failed before crash", operation)
		}
	}
	if !created {
		t.Fatal("Work create did not finish before the crash fixture deadline")
	}
	containers, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		t.Fatal(err)
	}
	instance := ""
	for _, item := range containers.Items {
		if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.WorkLabel] == workID && item.Labels[dockerengine.KindLabel] == "agent" {
			instance = item.ID
		}
	}
	if instance == "" {
		t.Fatal("created Work had no managed Agent")
	}
	if err := first.Process.Signal(syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	_ = first.Wait()
	orphan, err := raw.ContainerCreate(ctx, client.ContainerCreateOptions{
		Name: scope.ID() + "-unknown-agent",
		Config: &container.Config{Image: image, Labels: map[string]string{
			dockerengine.InstallationLabel: scope.ID(), dockerengine.ManagedLabel: "true",
			dockerengine.WorkLabel: "work-unknown", dockerengine.KindLabel: "agent", dockerengine.LogicalLabel: "agentd",
		}},
	})
	if err != nil {
		t.Fatal("could not create an unrelated managed orphan", err)
	}
	if firstErrors.Len() != 0 {
		t.Log("first Core diagnostic:", firstErrors.String())
	}
	second, secondBase, secondErrors := start()
	if _, err := raw.ContainerInspect(ctx, orphan.ID, client.ContainerInspectOptions{}); err != nil {
		t.Fatal("Core startup deleted an unknown managed Agent", err)
	}
	if !strings.Contains(secondErrors.String(), "orphaned managed Agent for Work work-unknown") {
		t.Fatal("Core startup did not diagnose the retained orphan safely", secondErrors.String())
	}
	if status, sessions := httpCall(t, secondBase, "/api/v1/works/"+workID+"/sessions", http.MethodGet, authorization, nil); status != 200 || sessions["sessions"] == nil {
		t.Fatal("restarted Core did not adopt Agent route", status, sessions)
	}
	containers, err = raw.ContainerList(ctx, client.ContainerListOptions{All: true})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, item := range containers.Items {
		if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.WorkLabel] == workID && item.Labels[dockerengine.KindLabel] == "agent" {
			count++
			if item.ID != instance {
				t.Fatal("Core crash recovery created a second Agent instance")
			}
		}
	}
	if count != 1 {
		t.Fatal("Core crash recovery lost or duplicated Agent", count)
	}
	if err := second.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := second.Wait(); err != nil {
		t.Fatal("Core did not shut down cleanly after adoption", err, secondErrors.String())
	}
}
