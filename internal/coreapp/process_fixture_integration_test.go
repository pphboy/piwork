//go:build integration

package coreapp

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"testing"
)

// Image selection belongs to the fixture build, never to a product argument.
func processFixtureBinary(t *testing.T, agent, packageHelper, fileHelper, snapshotHelper string) string {
	t.Helper()
	if agent == "" {
		agent = "piwork-agentd:go-migration-acceptance"
	}
	if packageHelper == "" {
		packageHelper = agent
	}
	if fileHelper == "" {
		fileHelper = "piwork-file-helper:go-migration-acceptance"
	}
	if snapshotHelper == "" {
		snapshotHelper = "piwork-snapshot-helper:go-migration-acceptance"
	}
	images, _ := json.Marshal(map[string]string{"agent": agent, "packageHelper": packageHelper, "fileHelper": fileHelper, "snapshotHelper": snapshotHelper})
	_, source, _, _ := runtime.Caller(0)
	binary := filepath.Join(t.TempDir(), "piwork-core")
	if prepared := os.Getenv("PIWORK_TEST_CORE_FIXTURE_BIN"); prepared != "" {
		data, err := os.ReadFile(prepared)
		if err != nil {
			t.Fatal(err)
		}
		if fmt.Sprintf("%x", sha256.Sum256(data)) != os.Getenv("PIWORK_TEST_CORE_FIXTURE_SHA256") {
			t.Fatal("prepared Core fixture identity changed")
		}
		if err := os.WriteFile(binary, data, 0700); err != nil {
			t.Fatal(err)
		}
	} else {
		cmd := exec.Command("go", "build", "-mod=readonly", "-trimpath", "-o", binary, "./scripts/corefixture")
		cmd.Dir = filepath.Join(filepath.Dir(source), "../..")
		cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("fixture build: %v: %s", err, output)
		}
	}
	config := append([]byte(`{"images":`), images...)
	config = append(config, '}')
	if err := os.WriteFile(binary+".fixture.json", config, 0600); err != nil {
		t.Fatal(err)
	}
	return binary
}
func processStartupArgs(t *testing.T, directory string) []string {
	t.Helper()
	listeners := []net.Listener{}
	defer func() {
		for _, listener := range listeners {
			listener.Close()
		}
	}()
	args := []string{"--data-dir", directory}
	var lease struct{ Port int }
	if raw, err := os.ReadFile(directory + ".test-rpc.json"); err == nil {
		if err := json.Unmarshal(raw, &lease); err != nil {
			t.Fatal("invalid fixture RPC receipt", err)
		}
	}
	for _, flag := range []string{"--ui-port", "--core-port"} {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		for attempt := 0; listener.Addr().(*net.TCPAddr).Port == lease.Port; attempt++ {
			listener.Close()
			if attempt == 127 {
				t.Fatal("HTTP port allocation conflicts with retained RPC lease")
			}
			listener, err = net.Listen("tcp4", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
		}
		listeners = append(listeners, listener)
		args = append(args, flag, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	}
	return args
}
