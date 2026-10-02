//go:build integration

package dockerengine

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestRealEngineWithNoDockerCLI(t *testing.T) {
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-tools"))
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	t.Logf("local Engine negotiated API %s; no resources created", engine.APIVersion)
}
