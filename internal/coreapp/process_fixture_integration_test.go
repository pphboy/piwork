//go:build integration

package coreapp

import (
	"encoding/base64"
	"encoding/json"
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
	cmd := exec.Command("go", "build", "-mod=readonly", "-trimpath", "-ldflags", "-X piwork/internal/distribution.EncodedImages="+base64.RawStdEncoding.EncodeToString(images), "-o", binary, "./cmd/piwork-core")
	cmd.Dir = filepath.Join(filepath.Dir(source), "../..")
	cmd.Env = append(os.Environ(), "CGO_ENABLED=0")
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("fixture build: %v: %s", err, output)
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
	for _, flag := range []string{"--ui-port", "--core-port"} {
		listener, err := net.Listen("tcp4", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		listeners = append(listeners, listener)
		args = append(args, flag, strconv.Itoa(listener.Addr().(*net.TCPAddr).Port))
	}
	return args
}
