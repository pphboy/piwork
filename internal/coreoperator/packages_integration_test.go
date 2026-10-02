//go:build integration

package coreoperator

import (
	"archive/zip"
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/coreapp"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/pipackage"
	"piwork/internal/testsupport"
)

func TestNativeOperatorPackageAndSkillCommandsAgainstCore(t *testing.T) {
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if image == "" {
		t.Fatal("set PIWORK_TEST_NATIVE_AGENT_IMAGE to native acceptance image")
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	api, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("native operator installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, api); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	a, err := coreapp.New(context.Background(), coreapp.Options{DataDirectory: directory, PackageHelperImage: image, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: coreapp.Initialization{Administrator: &struct{ Account, Password string }{"admin", fixturePassword}, Runtime: &coreapp.RuntimeInput{AgentImage: image, Provider: testsupport.DeterministicProvider, Model: testsupport.DeterministicModel, Credential: "acceptance-only"}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := a.Close(ctx); err != nil {
			t.Error(err)
		}
	})
	address, err := a.Listen(coreapp.ListenAddress{Host: "127.0.0.1"})
	if err != nil || !a.Status().Ready {
		t.Fatal(a.Status(), err)
	}
	_, source, _, _ := runtime.Caller(0)
	repository := filepath.Join(filepath.Dir(source), "..", "..")
	binary := filepath.Join(repository, "dist/go/piwork-serve")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("build Go binaries before integration", err)
	}
	invoke := func(expected int, args ...string) map[string]any {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		cmd := exec.CommandContext(ctx, binary, append([]string{"--core", address.URL(), "--data-dir", directory, "--json"}, args...)...)
		cmd.Dir = t.TempDir()
		cmd.Env = []string{"PATH=/no-host-platform-tools"}
		var stderr strings.Builder
		cmd.Stderr = &stderr
		output, err := cmd.Output()
		code := 0
		if err != nil {
			if exit, ok := err.(*exec.ExitError); ok {
				code = exit.ExitCode()
			} else {
				t.Fatal(err)
			}
		}
		if code != expected {
			t.Fatal(args, code, string(output), stderr.String())
		}
		if strings.Contains(string(output)+stderr.String(), directory) || strings.Contains(string(output)+stderr.String(), fixturePassword) {
			t.Fatal("unsafe command output")
		}
		if len(output) == 0 {
			return nil
		}
		return singleJSON(t, string(output))
	}
	skill := filepath.Join(t.TempDir(), "native-review")
	if err := os.Mkdir(skill, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skill, "SKILL.md"), []byte("---\nname: native-review\ndescription: Review task results.\n---\nReview the result.\n"), 0644); err != nil {
		t.Fatal(err)
	}
	if result := invoke(0, "skills", "add", "--path", skill); result["name"] != "native-review" {
		t.Fatal(result)
	}
	invoke(0, "skills", "list")
	invoke(0, "skills", "show", "native-review")
	invoke(0, "skills", "update", "native-review", "--path", skill)
	invoke(0, "skills", "disable", "native-review")
	invoke(0, "skills", "enable", "native-review")
	invoke(0, "skills", "remove", "native-review")
	result := invoke(0, "packages", "install", filepath.Join(repository, "fixtures/pi-packages/tools-v1"), "--default", "--wait", "--verbose")
	if result["state"] != "succeeded" || result["result"].(map[string]any)["name"] != "@piwork/fixture-tools" {
		t.Fatal(result)
	}
	name := result["result"].(map[string]any)["name"].(string)
	operationID := result["operationId"].(string)
	if entry := invoke(0, "packages", "show", name); entry["enabled"] != true || entry["isDefault"] != true {
		t.Fatal(entry)
	}
	invoke(0, "packages", "list")
	invoke(0, "operation", "show", operationID)
	invoke(6, "packages", "disable", name)
	invoke(0, "config", "default-work", "set", "--no-packages")
	invoke(0, "packages", "disable", name)
	tree, err := pipackage.OpenTree(context.Background(), filepath.Join(repository, "fixtures/pi-packages/tools-v2"))
	if err != nil {
		t.Fatal(err)
	}
	archive := filepath.Join(t.TempDir(), "tools.zip")
	_, err = pipackage.PackArchive(context.Background(), tree, archive)
	tree.Close()
	if err != nil {
		t.Fatal(err)
	}
	if view := invoke(0, "packages", "update", name, "--source", archive, "--wait"); view["state"] != "succeeded" {
		t.Fatal(view)
	}
	if entry := invoke(0, "packages", "show", name); entry["version"] != "2.0.0" || entry["enabled"] != false || entry["isDefault"] != false {
		t.Fatal(entry)
	}
	invoke(0, "packages", "enable", name)
	badZip := filepath.Join(t.TempDir(), "failure.zip")
	file, err := os.Create(badZip)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	entry, err := writer.Create("package.json")
	if err != nil {
		t.Fatal(err)
	}
	entry.Write([]byte(`{"name":"failure-tools","version":"1.0.0","scripts":{"postinstall":"node -e 'process.exit(1)'"}}`))
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	file.Close()
	failed := invoke(6, "packages", "install", badZip, "--wait", "--verbose")
	if failed["state"] != "failed" || failed["error"].(map[string]any)["code"] != "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED" {
		t.Fatal(failed)
	}
	if view := invoke(0, "operation", "show", failed["operationId"].(string)); view["state"] != "failed" {
		t.Fatal(view)
	}
	if failed := invoke(6, "packages", "update", name, "--source", badZip, "--wait"); failed["error"].(map[string]any)["code"] != "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED" {
		t.Fatal(failed)
	}
	if entry := invoke(0, "packages", "show", name); entry["version"] != "2.0.0" || entry["enabled"] != true {
		t.Fatal("failed update changed previous head", entry)
	}
	invoke(0, "packages", "remove", name)
	if view := invoke(2, "work", "list"); view != nil {
		t.Fatal(view)
	}
}
