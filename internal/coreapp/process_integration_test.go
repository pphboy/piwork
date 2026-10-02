//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
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
	binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-serve")
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
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	start := func() (string, func()) {
		cmd := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
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
		var listening struct{ Event, URL string }
		select {
		case raw := <-line:
			if json.Unmarshal(raw, &listening) != nil || listening.Event != "core.listening" || listening.URL == "" {
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
			if stderr.Len() != 0 {
				t.Fatal("native Core emitted an unexpected diagnostic", stderr.String())
			}
		}
		return listening.URL, stop
	}
	base, stop := start()
	// A second actual process must fail on the directory lock before binding.
	second := exec.CommandContext(ctx, binary, "serve", "--data-dir", directory, "--listen", "127.0.0.1:0", "--agent-grpc-listen", "0.0.0.0:0")
	second.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools")}
	var secondOutput, secondError bytes.Buffer
	second.Stdout, second.Stderr = &secondOutput, &secondError
	if err := second.Run(); err == nil || secondOutput.Len() != 0 || !strings.Contains(secondError.String(), "another Core") {
		t.Fatal("second native owner was not rejected before listen")
	}
	invoke := func(program string, args []string, secret string, want int) map[string]any {
		command := exec.CommandContext(ctx, program, append([]string{"--core", base, "--data-dir", directory, "--json"}, args...)...)
		command.Env = []string{"PATH=" + filepath.Join(t.TempDir(), "no-host-tools")}
		command.Stdin = strings.NewReader(secret)
		var stdout, stderr bytes.Buffer
		command.Stdout, command.Stderr = &stdout, &stderr
		err := command.Run()
		code := 0
		if err != nil {
			if exited, ok := err.(*exec.ExitError); ok {
				code = exited.ExitCode()
			} else {
				t.Fatal("native operator could not execute")
			}
		}
		if code != want || secret != "" && strings.Contains(stdout.String()+stderr.String(), secret) {
			t.Fatal("unexpected operator exit or secret leak", code, want)
		}
		if want != 0 {
			if stdout.Len() != 0 || stderr.Len() == 0 {
				t.Fatal("invalid operator failure projection")
			}
			return nil
		}
		if stderr.Len() != 0 {
			t.Fatal("successful operator emitted diagnostic")
		}
		decoder := json.NewDecoder(&stdout)
		var result map[string]any
		if decoder.Decode(&result) != nil {
			t.Fatal("operator stdout was not JSON")
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			t.Fatal("operator printed multiple results")
		}
		return result
	}
	alias := filepath.Join(filepath.Dir(binary), "piwork")
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 503 || body["reason"] != "ADMIN_REQUIRED" {
		t.Fatal(status, body)
	}
	if result := invoke(binary, []string{"admin", "bootstrap", "--account", "admin", "--password-stdin"}, "native-fixture-password", 0); result["account"] != "admin" {
		t.Fatal("native operator did not bootstrap")
	}
	invoke(alias, []string{"admin", "bootstrap", "--account", "replacement", "--password-stdin"}, "replacement-fixture-password", 6)
	invoke(alias, []string{"login"}, "", 2)
	status, login := httpCall(t, base, "/api/v1/login", "POST", "", map[string]any{"account": "admin", "password": "native-fixture-password"})
	if status != 200 {
		t.Fatal(status)
	}
	token := login["token"].(string)
	// Real Go Core -> Engine save -> static native image checks. No Agent/Work
	// is created in this startup/identity fixture and no real model is called.
	if result := invoke(binary, []string{"config", "set", "--agent-image", image, "--model-provider", "piwork-deterministic", "--model", "fixture-v1", "--api-key-stdin"}, "native-deterministic-fixture", 0); result["configured"] != true {
		t.Fatal("native operator did not save runtime")
	}
	if result := invoke(alias, []string{"status"}, "", 0); result["ready"] != true {
		t.Fatal("native alias did not read status")
	}
	if result := invoke(binary, []string{"config", "show"}, "", 0); result["configured"] != true {
		t.Fatal("native operator did not read runtime")
	}
	if result := invoke(alias, []string{"config", "default-work", "set", "--no-skills"}, "", 0); len(result["configuration"].(map[string]any)["skills"].([]any)) != 0 {
		t.Fatal("native alias did not save default Work")
	}
	if result := invoke(binary, []string{"config", "default-work", "show"}, "", 0); len(result["configuration"].(map[string]any)["skills"].([]any)) != 0 {
		t.Fatal("native operator did not read updated default Work")
	}
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
	if status, body := httpCall(t, base, "/readyz", "GET", "", nil); status != 503 || body["reason"] != "RUNTIME_UNAVAILABLE" {
		t.Fatal("unavailable Engine was advertised as ready", status, body)
	}
	if status, body := httpCall(t, base, "/healthz", "GET", "", nil); status != 200 || body["status"] != "healthy" {
		t.Fatal("dependency failure stopped Core health")
	}
	stop()
	t.Log("native Core and operator/alias initialized online, checked native image, reopened same session and exited; no host interpreter or Docker command available")
}
