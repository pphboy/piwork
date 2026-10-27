//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeCredentialCoreCrashAdoptsInflightRun(t *testing.T) {
	port, err := net.Listen("tcp4", "0.0.0.0:7172")
	if err != nil {
		t.Fatal("Agent RPC port is unavailable for the isolated Core fixture", err)
	}
	port.Close()
	gateway, image := nativeModelGateway(t)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-process-old"
	gateway.mu.Unlock()
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
	t.Cleanup(func() { raw.Close() })
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Minute)
	defer cancel()
	initial, err := corestore.Open(ctx, corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	files, err := initial.OpenPlatformFiles()
	if err != nil {
		t.Fatal(err)
	}
	baseURL := gateway.URL + "/v1"
	if _, err := NewSettings(initial, files).ConfigureRuntime(RuntimeInput{AgentImage: image, Provider: "openai", Model: "gpt-5.1", BaseURL: &baseURL, Credential: "synthetic-process-old"}); err != nil {
		t.Fatal(err)
	}
	files.Close()
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}
	binary := processFixtureBinary(t, image, image, os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"))
	startCore := func() (*exec.Cmd, string) {
		cmd := exec.CommandContext(ctx, binary, processStartupArgs(t, directory)...)
		cmd.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + host, "DOCKER_CONFIG=" + t.TempDir(), "PIWORK_ADMIN_ACCOUNT=admin", "PIWORK_ADMIN_PASSWORD=development-fixture-pass"}
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
		var announce struct {
			Event string
			URL   string `json:"coreUrl"`
		}
		select {
		case value := <-line:
			if json.Unmarshal(value, &announce) != nil || announce.Event != "app.listening" || announce.URL == "" {
				t.Fatal("Core did not announce its listener", stderr.String())
			}
		case <-time.After(45 * time.Second):
			t.Fatal("Core listener timed out")
		}
		for deadline := time.Now().Add(60 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
			if status, _ := httpCall(t, announce.URL, "/readyz", "GET", "", nil); status == 200 {
				return cmd, announce.URL
			}
		}
		t.Fatal("Core did not become ready", stderr.String())
		return nil, ""
	}
	waitOperation := func(base, auth, id string) {
		for {
			status, operation := httpCall(t, base, "/api/v1/operations/"+id, "GET", auth, nil)
			if status != 200 || operation["state"] == "failed" || operation["state"] == "superseded" || ctx.Err() != nil {
				t.Fatal("Work operation failed", status, operation["state"], ctx.Err())
			}
			if operation["state"] == "succeeded" {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	containerID := func(workID string) string {
		items, err := raw.ContainerList(ctx, client.ContainerListOptions{All: true})
		if err != nil {
			t.Fatal(err)
		}
		id := ""
		for _, item := range items.Items {
			if item.Labels[dockerengine.InstallationLabel] == scope.ID() && item.Labels[dockerengine.WorkLabel] == workID && item.Labels[dockerengine.KindLabel] == "agent" {
				if id != "" {
					t.Fatal("multiple managed Agents")
				}
				id = item.ID
			}
		}
		return id
	}
	first, base := startCore()
	login := modelNativeCall(t, base, "", "/api/v1/login", "POST", map[string]any{"account": "admin", "password": "development-fixture-pass"}, 200)
	auth := "Bearer " + login["token"].(string)
	created := modelNativeCall(t, base, auth, "/api/v1/works", "POST", map[string]any{"name": "Credential crash", "idempotencyKey": "credential-crash-create"}, 202)
	workID := created["workId"].(string)
	waitOperation(base, auth, created["operationId"].(string))
	instance := containerID(workID)
	if instance == "" {
		t.Fatal("running Agent missing")
	}
	models := modelNativeCall(t, base, auth, "/api/v1/admin/models", "GET", nil, 200)["models"].([]any)
	if len(models) != 1 {
		t.Fatal("expected one fixture model")
	}
	modelID := models[0].(map[string]any)["id"].(string)
	path := "/api/v1/works/" + workID
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "credential-crash-session"}, 201)["sessionId"].(string)
	held, started := make(chan struct{}), make(chan struct{})
	var once sync.Once
	release := func() { once.Do(func() { close(held) }) }
	t.Cleanup(release)
	gateway.mu.Lock()
	gateway.hold, gateway.started = held, started
	gateway.mu.Unlock()
	accepted := modelNativeCall(t, base, auth, path+"/runs", "POST", map[string]any{"sessionId": session, "submissionKey": "credential-held", "prompt": "Reply with the selected model.", "inputMode": "text"}, 202)
	runID := accepted["run"].(map[string]any)["runId"].(string)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("model request never reached the fixture")
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/models/"+modelID, "PATCH", map[string]any{"credential": "synthetic-process-new"}, 200)
	gateway.mu.Lock()
	gateway.allowedKey = "synthetic-process-new"
	gateway.mu.Unlock()
	if err := first.Process.Signal(syscall.SIGKILL); err != nil {
		t.Fatal(err)
	}
	_ = first.Wait()
	second, secondBase := startCore()
	for {
		status, _ := httpCall(t, secondBase, path+"/sessions", "GET", auth, nil)
		if status == http.StatusOK {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("Core did not restore the original route", status)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if containerID(workID) != instance || gateway.count() != 1 {
		t.Fatal("Core recovery replaced the running Agent or replayed the request")
	}
	release()
	for {
		result := modelNativeCall(t, secondBase, auth, path+"/runs/"+runID, "GET", nil, 200)
		state := int(result["state"].(float64))
		if state == 4 {
			break
		}
		if state >= 5 || ctx.Err() != nil {
			t.Fatal("in-flight Run did not survive Core recovery", state)
		}
		time.Sleep(50 * time.Millisecond)
	}
	modelNativeRun(t, ctx, secondBase, auth, workID, session, "credential-after-crash")
	if gateway.count() != 2 || gateway.last().Key != "synthetic-process-new" {
		t.Fatal("new Run did not use the rotated credential")
	}
	modelNativeCall(t, secondBase, auth, "/api/v1/admin/models/"+modelID+"/disable", "POST", map[string]any{}, 200)
	modelNativeCall(t, secondBase, auth, path+"/runs", "POST", map[string]any{"sessionId": session, "submissionKey": "credential-disabled", "prompt": "Do not execute.", "inputMode": "text"}, 409)
	modelNativeCall(t, secondBase, auth, "/api/v1/admin/models/"+modelID+"/enable", "POST", map[string]any{}, 200)
	stopped := modelNativeCall(t, secondBase, auth, "/api/v1/works", "POST", map[string]any{"name": "Deliberately stopped", "idempotencyKey": "credential-stopped-create"}, 202)
	stoppedID := stopped["workId"].(string)
	waitOperation(secondBase, auth, stopped["operationId"].(string))
	stoppedOperation := modelNativeCall(t, secondBase, auth, "/api/v1/works/"+stoppedID+"/stop", "POST", map[string]string{"idempotencyKey": "credential-stopped-stop"}, 202)
	waitOperation(secondBase, auth, stoppedOperation["operationId"].(string))
	if err := second.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := second.Wait(); err != nil {
		t.Fatal("Core did not shut down cleanly", err)
	}
	third, thirdBase := startCore()
	for {
		status, work := httpCall(t, thirdBase, path, "GET", auth, nil)
		if status == 200 && work["desiredState"] == "running" && work["observedState"] == "ready" {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("desired-running Work did not restore", status)
		}
		time.Sleep(100 * time.Millisecond)
	}
	status, work := httpCall(t, thirdBase, "/api/v1/works/"+stoppedID, "GET", auth, nil)
	if status != 200 || work["desiredState"] != "stopped" || work["observedState"] != "stopped" {
		t.Fatal("deliberately stopped Work was restored", status)
	}
	if err := third.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatal(err)
	}
	if err := third.Wait(); err != nil {
		t.Fatal("final Core shutdown failed", err)
	}
}
