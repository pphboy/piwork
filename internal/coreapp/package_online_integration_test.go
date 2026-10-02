//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/client"
	"piwork/internal/dockerengine"
)

// This gate contacts the real registry. Missing image/network is a failure;
// the SDK model and all child responses remain deterministic and local.
func TestNativeOnlinePiSubagentsInstallApplyAndExecute(t *testing.T) {
	baseURL := "http://127.0.0.1:8080/v1"
	a, base, auth, id, ctx := nativeApplyFixture(t, RuntimeInput{Provider: "groq", Model: "llama-3.1-8b-instant", BaseURL: &baseURL, Credential: "online-acceptance-only"})
	accepted := func(path, key string, source map[string]string) string {
		t.Helper()
		status, result := packageHTTPCall(t, base, path, "POST", auth, map[string]any{"source": source, "idempotencyKey": key})
		if status != 202 {
			t.Fatal("package not accepted", status, result)
		}
		operation := result["operationId"].(string)
		waitWorkOperation(t, ctx, a, operation)
		return operation
	}
	accepted("/api/v1/admin/packages", "online-fixed-npm", map[string]string{"kind": "npm", "spec": "pi-subagents@0.71.0"})
	status, installed := packageHTTPCall(t, base, "/api/v1/admin/packages/pi-subagents", "GET", auth, nil)
	if status != 200 || installed["resolvedSource"] != "pi-subagents@0.71.0" {
		t.Fatal("registry version not frozen", status, installed)
	}
	path := "/api/v1/works/" + id
	accepted(path+"/packages", "online-copy", map[string]string{"kind": "core", "name": "pi-subagents"})
	status, applied := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "online-apply"})
	if status != 202 {
		t.Fatal(status, applied)
	}
	waitWorkOperation(t, ctx, a, applied["operationId"].(string))
	status, shown := packageHTTPCall(t, base, path+"/packages/pi-subagents", "GET", auth, nil)
	if status != 200 || shown["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal("online package not loaded", status, shown)
	}
	agent, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: id, Kind: "agent", LogicalID: "agentd"})
	if err != nil || agent == nil {
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
	_, file, _, _ := runtime.Caller(0)
	fixturePath := filepath.Join(filepath.Dir(file), "../../scripts/pi-package-online-model-fixture.mjs")
	labels := map[string]string{dockerengine.InstallationLabel: a.Store.InstallationID(), "piwork.test_fixture": "true"}
	fixture, err := raw.ContainerCreate(ctx, client.ContainerCreateOptions{Config: &container.Config{Image: agent.Image, Entrypoint: []string{"node"}, Cmd: []string{"/fixture.mjs"}, Env: []string{"PIWORK_FIXTURE_MODEL_KEY=online-acceptance-only"}, Labels: labels}, HostConfig: &container.HostConfig{NetworkMode: container.NetworkMode("container:" + agent.ID), ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, Mounts: []mount.Mount{{Type: mount.TypeBind, Source: fixturePath, Target: "/fixture.mjs", ReadOnly: true}}}})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := raw.ContainerRemove(cleanup, fixture.ID, client.ContainerRemoveOptions{Force: true})
		if err != nil {
			t.Error(err)
		}
	}()
	if _, err = raw.ContainerStart(ctx, fixture.ID, client.ContainerStartOptions{}); err != nil {
		t.Fatal(err)
	}
	events := func() ([]map[string]any, error) {
		program := `fetch('http://127.0.0.1:8080/events').then(r=>r.json()).then(v=>console.log(JSON.stringify(v)))`
		created, err := raw.ExecCreate(ctx, fixture.ID, client.ExecCreateOptions{Cmd: []string{"node", "-e", program}, AttachStdout: true, AttachStderr: true})
		if err != nil {
			return nil, err
		}
		attached, err := raw.ExecAttach(ctx, created.ID, client.ExecAttachOptions{})
		if err != nil {
			return nil, err
		}
		defer attached.Close()
		stop := context.AfterFunc(ctx, func() { attached.Close() })
		defer stop()
		var output bytes.Buffer
		if err := dockerengine.Demultiplex(ctx, attached.Reader, &output, io.Discard); err != nil {
			return nil, err
		}
		var value []map[string]any
		err = json.Unmarshal(output.Bytes(), &value)
		return value, err
	}
	waitEvent := func(kind, mode string) {
		t.Helper()
		for deadline := time.Now().Add(30 * time.Second); time.Now().Before(deadline); {
			observed, err := events()
			if err == nil {
				if kind == "ready" {
					return
				}
				for _, event := range observed {
					if event["kind"] == kind && event["mode"] == mode {
						return
					}
				}
			}
			time.Sleep(200 * time.Millisecond)
		}
		t.Fatal("model fixture event missing", kind, mode)
	}
	waitEvent("ready", "")
	chat := func(prompt, key string) {
		t.Helper()
		status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 201 {
			t.Fatal(status, session)
		}
		status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": key, "prompt": prompt})
		if status != 202 {
			t.Fatal(status, submitted)
		}
		runID := submitted["run"].(map[string]any)["runId"].(string)
		request, _ := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events?after=0", nil)
		request.Header.Set("Authorization", auth)
		response, err := (&http.Client{Timeout: 90 * time.Second}).Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal(response.Status)
		}
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 4096), 2<<20)
		successfulTools := map[string]bool{}
		terminal := false
		for scanner.Scan() {
			var event map[string]any
			if json.Unmarshal(scanner.Bytes(), &event) != nil {
				t.Fatal("invalid event")
			}
			kind, _ := event["kind"].(map[string]any)
			if kind["$case"] == "tool" {
				tool := kind["tool"].(map[string]any)
				if tool["phase"] == "tool-end" && tool["isError"] != true {
					name, _ := tool["toolName"].(string)
					successfulTools[name] = true
					if name == "subagent" && strings.Contains(prompt, "BACKGROUND_HOLD") {
						return // Observing a background job must not wait for it before Stop.
					}
				}
			}
			if kind["$case"] == "state" {
				state := kind["state"].(map[string]any)
				if state["state"] == float64(4) {
					terminal = true
				}
			}
		}
		if err := scanner.Err(); err != nil {
			t.Fatal(err)
		}
		if !terminal || !successfulTools["subagent"] {
			t.Fatal("real subagent invocation failed", prompt, terminal, successfulTools)
		}
		if strings.Contains(prompt, "FOREGROUND") {
			status, detail := packageHTTPCall(t, base, path+"/sessions/"+session["sessionId"].(string), "GET", auth, nil)
			encoded, _ := json.Marshal(detail)
			if status != 200 || !bytes.Contains(encoded, []byte("child-ok:foreground")) {
				t.Fatal("child result missing from durable Session", status)
			}
		}
	}
	chat("ONLINE_FOREGROUND invoke the subagent tool", "foreground")
	waitEvent("child-completed", "foreground")
	chat("ONLINE_BACKGROUND_COMPLETE invoke the subagent tool", "background-complete")
	waitEvent("child-completed", "background")
	// The tool returns while the child remains active. Stop must reclaim it.
	chat("ONLINE_BACKGROUND_HOLD invoke the subagent tool", "background-hold")
	waitEvent("child-holding", "background")
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "online-stop"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	waitEvent("child-disconnected", "background")
	state, err := raw.ContainerInspect(ctx, agent.ID, client.ContainerInspectOptions{})
	if err != nil || state.Container.State.Running {
		t.Fatal("Stop left child runtime running", err)
	}
	for _, item := range agent.Mounts {
		if item.Destination == "/var/run/docker.sock" || strings.HasPrefix(item.Destination, "/core") {
			t.Fatal("Agent exposed host platform", item.Destination)
		}
	}
	t.Log("real npm pi-subagents@0.71.0 frozen, copied, applied; foreground child completed, background completed and stopped")
}
