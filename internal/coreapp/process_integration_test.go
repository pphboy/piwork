//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestNativeCoreProcessHealthIdentityRestartWithoutHostTools(t *testing.T) {
	_, source, _, _ := runtime.Caller(0)
	binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-core")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("make build-go is required", err)
	}
	directory := t.TempDir()
	dockerConfig := t.TempDir()
	dockerHost := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if dockerHost == "" {
		dockerHost = "unix:///var/run/docker.sock"
	}
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if image == "" {
		image = "piwork-agentd:go-migration-acceptance"
	}
	binary = processFixtureBinary(t, image, image, os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"))
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	start := func() (string, func()) {
		cmd := exec.CommandContext(ctx, binary, processStartupArgs(t, directory)...)
		cmd.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools"), "DOCKER_HOST=" + dockerHost, "DOCKER_CONFIG=" + dockerConfig}
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Start(); err != nil {
			t.Fatal(err)
		}
		wait := make(chan error, 1)
		t.Cleanup(func() { cmd.Process.Kill() })
		line := make(chan []byte, 1)
		go func() {
			scanner := bufio.NewScanner(stdout)
			if scanner.Scan() {
				line <- append([]byte(nil), scanner.Bytes()...)
			} else {
				line <- nil
			}
		}()
		var listening struct {
			Event string
			URL   string `json:"coreUrl"`
		}
		select {
		case raw := <-line:
			if json.Unmarshal(raw, &listening) != nil || listening.Event != "app.listening" || listening.URL == "" {
				cmd.Process.Kill()
				cmd.Wait()
				t.Fatal("native Core did not listen", stderr.String())
			}
		case <-time.After(45 * time.Second):
			cmd.Process.Kill()
			cmd.Wait()
			t.Fatal("native Core startup timeout", stderr.String())
		}
		stop := func() {
			if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
				t.Fatal(err)
			}
			go func() { wait <- cmd.Wait() }()
			select {
			case err := <-wait:
				if err != nil {
					t.Fatal("native Core did not exit cleanly", err, stderr.String())
				}
			case <-time.After(5 * time.Second):
				cmd.Process.Kill()
				<-wait
				t.Fatal("empty-workload shutdown exceeded fixture bound")
			}
			// Preparation has structured performance diagnostics. Accept only
			// their bounded safe projection, rather than requiring silent stderr.
			scanner := bufio.NewScanner(bytes.NewReader(stderr.Bytes()))
			for scanner.Scan() {
				if strings.HasPrefix(scanner.Text(), "Could not open a browser. Open http://") && strings.HasSuffix(scanner.Text(), " manually.") {
					continue
				}
				var entry map[string]any
				if json.Unmarshal(scanner.Bytes(), &entry) != nil || entry["event"] != "performance" || (entry["phase"] != "image-inspection" && entry["phase"] != "environment-probe") || (entry["outcome"] != "started" && entry["outcome"] != "succeeded" && entry["outcome"] != "cancelled") {
					t.Fatal("native Core emitted a failure or an unexpected diagnostic")
				}
				for key := range entry {
					if key != "event" && key != "phase" && key != "outcome" && key != "timestamp" && key != "correlationId" && key != "durationMs" && key != "cacheState" {
						t.Fatal("native Core preparation diagnostic exposed an unexpected field", key)
					}
				}
				if duration, ok := entry["durationMs"].(float64); !ok || duration < 0 {
					t.Fatal("invalid preparation duration")
				}
				stamp, ok := entry["timestamp"].(string)
				if _, err := time.Parse(time.RFC3339Nano, stamp); !ok || err != nil {
					t.Fatal("invalid preparation timestamp")
				}
			}
			if err := scanner.Err(); err != nil {
				t.Fatal("invalid preparation diagnostic stream", err)
			}
		}
		return listening.URL, stop
	}
	base, stop := start()
	// A second actual process must fail on the directory lock before binding.
	second := exec.CommandContext(ctx, binary, processStartupArgs(t, directory)...)
	second.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools")}
	var secondOutput, secondError bytes.Buffer
	second.Stdout, second.Stderr = &secondOutput, &secondError
	if err := second.Run(); err == nil || secondOutput.Len() != 0 || !strings.Contains(secondError.String(), "another Core") {
		t.Fatal("second native owner was not rejected before listen")
	}
	operatorBytes, err := os.ReadFile(filepath.Join(directory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	operatorAuth := "Operator " + strings.TrimSpace(string(operatorBytes))
	control := func(method, path string, body any, want int) map[string]any {
		t.Helper()
		status, result := httpCall(t, base, "/control/"+path, method, operatorAuth, body)
		if status != want {
			t.Fatalf("operator %s: %d", path, status)
		}
		return result
	}
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 503 || body["reason"] != "ADMIN_REQUIRED" {
		t.Fatal(status, body)
	}
	control("POST", "admin/bootstrap", map[string]any{"account": "admin", "password": "native-fixture-password"}, 201)
	control("POST", "admin/bootstrap", map[string]any{"account": "replacement", "password": "replacement-fixture-password"}, 409)
	status, login := httpCall(t, base, "/api/v1/login", "POST", "", map[string]any{"account": "admin", "password": "native-fixture-password"})
	if status != 200 {
		t.Fatal(status)
	}
	token := login["token"].(string)
	// Real Go Core -> Engine save -> static native image checks. No Agent/Work
	// is created in this startup/identity fixture and no real model is called.
	if result := control("PUT", "runtime", map[string]any{"provider": "piwork-deterministic", "model": "fixture-v1", "credential": "native-deterministic-fixture"}, 200); result["configured"] != true {
		t.Fatal("operator runtime write failed")
	}

	// Saving the runtime confirms persistence; dependency preparation is
	// asynchronous and must be observed before asserting a ready status.
	awaitReady := func() {
		readyDeadline := time.Now().Add(time.Minute)
		for {
			status, body := httpCall(t, base, "/readyz", "GET", "", nil)
			if status == 200 {
				break
			}
			if time.Now().After(readyDeadline) || ctx.Err() != nil {
				t.Fatal("runtime preparation did not become ready", status, body)
			}
			time.Sleep(50 * time.Millisecond)
		}
	}
	awaitReady()
	if control("GET", "status", nil, 200)["ready"] != true {
		t.Fatal("operator status failed")
	}
	if control("GET", "runtime", nil, 200)["configured"] != true {
		t.Fatal("operator runtime read failed")
	}
	control("PUT", "default-work", map[string]any{"patch": map[string]any{"skills": []any{}}}, 200)
	if len(control("GET", "default-work", nil, 200)["configuration"].(map[string]any)["skills"].([]any)) != 0 {
		t.Fatal("operator defaults failed")
	}
	awaitReady()
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 200 || body["reason"] != "READY" {
		t.Fatal(status, body)
	}
	stop()
	base, stop = start()
	if status, body := httpCall(t, base, "/api/v1/me", "GET", "Bearer "+token, nil); status != 200 || body["account"] != "admin" {
		t.Fatal("token did not persist through real process restart", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/logout", "POST", "Bearer "+token, nil); status != 204 {
		t.Fatal(status)
	}
	stop()
	dockerHost = "unix://" + filepath.Join(t.TempDir(), "absent-engine.sock")
	base, stop = start()
	for deadline := time.Now().Add(10 * time.Second); ; time.Sleep(50 * time.Millisecond) {
		status, body := httpCall(t, base, "/readyz", "GET", "", nil)
		if status != 503 || body["ready"] != false {
			t.Fatal("unavailable Engine was advertised as ready", status)
		}
		if body["reason"] == "RUNTIME_UNAVAILABLE" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("missing Engine failure did not become observable", status, body)
		}
	}
	if status, body := httpCall(t, base, "/healthz", "GET", "", nil); status != 200 || body["status"] != "healthy" {
		t.Fatal("dependency failure stopped Core health")
	}
	stop()
	t.Log("native Core and operator HTTP initialized online, checked native image, reopened same session and exited; no host interpreter or Docker command available")
}
