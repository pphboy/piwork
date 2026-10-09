package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func dockerReleaseFixture(t *testing.T) (string, DockerRelease) {
	t.Helper()
	var release DockerRelease
	release.Version = 1
	release.Release.Version = "0.0.1"
	release.Release.Commit = strings.Repeat("a", 40)
	release.Release.SourceInputHash = strings.Repeat("b", 64)
	release.Images.Agent = "registry.example/piwork-agentd:0.0.1-candidate"
	release.Images.PackageHelper = release.Images.Agent
	release.Images.FileHelper = "registry.example/piwork-file-helper:0.0.1-candidate"
	release.Images.SnapshotHelper = "registry.example/piwork-snapshot-helper:0.0.1-candidate"
	data, err := json.Marshal(release)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "docker-release.json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	return path, release
}

func TestDockerReleaseRejectsInvalidOrSensitiveDefaultsSafely(t *testing.T) {
	path, expected := dockerReleaseFixture(t)
	release, err := ReadDockerRelease(path)
	if err != nil || release != expected {
		t.Fatal("valid nonsecret defaults rejected", err)
	}
	data, _ := os.ReadFile(path)
	for _, contents := range []string{
		strings.Replace(string(data), `"version":1`, `"version":2`, 1),
		strings.Replace(string(data), `"version":1`, `"version":1,"password":"synthetic-canary"`, 1),
		strings.Replace(string(data), expected.Images.Agent, "https://synthetic-canary@invalid", 1),
		strings.Replace(string(data), expected.Images.Agent, "registry.example/agent:latest", 1),
		strings.Replace(string(data), expected.Release.Commit, "unknown", 1),
		string(data) + `{}`, string(data) + strings.Repeat(" ", 64<<10),
	} {
		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := ReadDockerRelease(path); !errors.Is(err, ErrDockerRelease) || strings.Contains(err.Error(), "synthetic-canary") {
			t.Fatal("invalid defaults accepted or leaked", err)
		}
	}
	link := filepath.Join(t.TempDir(), "link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadDockerRelease(link); !errors.Is(err, ErrDockerRelease) {
		t.Fatal("symlink accepted", err)
	}
}

func TestDockerReleaseDefaultsDoNotCreateIncompleteUserInitialization(t *testing.T) {
	path, release := dockerReleaseFixture(t)
	values := map[string]string{"PIWORK_RELEASE_CONFIG_PATH": path}
	merged, err := ApplyDockerReleaseDefaults(values)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := merged["PIWORK_AGENT_IMAGE"]; exists {
		t.Fatal("built-in Agent became submitted user initialization")
	}
	if _, exists := values["PIWORK_FILE_HELPER_IMAGE"]; exists {
		t.Fatal("defaults changed the caller environment map")
	}
	initialization, err := InitializationFromEnvironment(merged)
	if err != nil || initialization.Administrator != nil || initialization.Runtime != nil || merged["PIWORK_FILE_HELPER_IMAGE"] != release.Images.FileHelper {
		t.Fatal("unconfigured defaults incorrectly initialized a user", err)
	}
	a, err := New(context.Background(), Options{DataDirectory: t.TempDir(), Initialization: initialization})
	if err != nil {
		t.Fatal(err)
	}
	defer closeSettingsApp(t, a)
	bound, err := a.Listen(ListenAddress{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	for _, probe := range []struct {
		path   string
		status int
	}{{"/healthz", 200}, {"/readyz?profile=docker-delivery", 503}} {
		response, err := http.Get(bound.URL() + probe.path)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != probe.status {
			t.Fatal("unconfigured health/readiness contract changed", response.StatusCode)
		}
	}
}

func TestDockerReleaseDefaultsRespectExplicitInputAndAliases(t *testing.T) {
	path, release := dockerReleaseFixture(t)
	values := dockerInitializationEnvironment()
	delete(values, "PIWORK_AGENT_IMAGE")
	values["PIWORK_RELEASE_CONFIG_PATH"] = path
	merged, err := ApplyDockerReleaseDefaults(values)
	if err != nil || merged["PIWORK_AGENT_IMAGE"] != release.Images.Agent {
		t.Fatal("release Agent default not selected", err)
	}
	initialization, err := InitializationFromEnvironment(merged)
	if err != nil || ValidateRuntime(*initialization.Runtime) != nil {
		t.Fatal("complete model initialization rejected", err)
	}
	if _, present := merged["PIWORK_MODEL_BASE_URL"]; present {
		t.Fatal("unset optional Base URL became empty")
	}
	values["PIWORK_MODEL_ID"], values["PIWORK_MODEL_API_KEY"] = values["PIWORK_MODEL"], values["PIWORK_API_KEY"]
	delete(values, "PIWORK_MODEL")
	delete(values, "PIWORK_API_KEY")
	values["PIWORK_AGENT_IMAGE"] = "fixture/explicit:valid"
	values["PIWORK_FILE_HELPER_IMAGE"] = ""
	merged, err = ApplyDockerReleaseDefaults(values)
	if err != nil || merged["PIWORK_AGENT_IMAGE"] != "fixture/explicit:valid" || merged["PIWORK_FILE_HELPER_IMAGE"] != "" {
		t.Fatal("explicit override was replaced", err)
	}
	initialization, err = InitializationFromEnvironment(merged)
	if err != nil || ValidateRuntime(*initialization.Runtime) != nil {
		t.Fatal("compatible aliases rejected", err)
	}
	values["PIWORK_AGENT_IMAGE"] = " "
	merged, _ = ApplyDockerReleaseDefaults(values)
	initialization, _ = InitializationFromEnvironment(merged)
	if ValidateRuntime(*initialization.Runtime) == nil {
		t.Fatal("invalid explicit Agent silently fell back")
	}
	delete(values, "PIWORK_AGENT_IMAGE")
	delete(values, "PIWORK_MODEL_PROVIDER")
	merged, _ = ApplyDockerReleaseDefaults(values)
	if _, err := InitializationFromEnvironment(merged); err == nil {
		t.Fatal("partial model input accepted")
	}
	if _, err := ApplyDockerReleaseDefaults(map[string]string{}); err != nil {
		t.Fatal("native initialization unexpectedly requires image defaults", err)
	}
}

func TestDockerReleaseChangedDefaultsDoNotReplacePersistedInitialization(t *testing.T) {
	path, release := dockerReleaseFixture(t)
	values := dockerInitializationEnvironment()
	delete(values, "PIWORK_AGENT_IMAGE")
	values["PIWORK_RELEASE_CONFIG_PATH"] = path
	merged, _ := ApplyDockerReleaseDefaults(values)
	initialization, _ := InitializationFromEnvironment(merged)
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory, Initialization: initialization})
	if err != nil {
		t.Fatal(err)
	}
	first, _, _ := a.Settings.LoadRuntime()
	installationID := a.Store.InstallationID()
	login, err := a.Identity.Login(context.Background(), "admin", "private-initial-password", "release-defaults-test")
	if err != nil {
		t.Fatal(err)
	}
	closeSettingsApp(t, a)
	release.Images.Agent = "registry.example/piwork-agentd:next-candidate"
	release.Images.PackageHelper = release.Images.Agent
	data, _ := json.Marshal(release)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	values["PIWORK_ADMIN_PASSWORD"] = "private-replacement-password"
	values["PIWORK_MODEL"] = "model-two"
	merged, _ = ApplyDockerReleaseDefaults(values)
	initialization, _ = InitializationFromEnvironment(merged)
	b, err := New(context.Background(), Options{DataDirectory: directory, Initialization: initialization})
	if err != nil {
		t.Fatal(err)
	}
	defer closeSettingsApp(t, b)
	second, _, _ := b.Settings.LoadRuntime()
	if first.AgentImage != second.AgentImage || first.Revision != second.Revision || first.Model.ID != second.Model.ID || b.Store.InstallationID() != installationID {
		t.Fatal("new release defaults replaced durable initialization")
	}
	if _, err := b.Identity.Authenticate(context.Background(), login.Token); err != nil {
		t.Fatal("release recreation changed the existing user session", err)
	}
}
