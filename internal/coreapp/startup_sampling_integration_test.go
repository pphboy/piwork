//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeStartupSamplerUsesRealUIAgentAndService(t *testing.T) {
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	fileImage, snapshotImage := os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE")
	if image == "" || fileImage == "" || snapshotImage == "" {
		t.Skip("set the native Agent, file helper and snapshot helper image fixtures")
	}
	_, source, _, _ := runtime.Caller(0)
	root := filepath.Join(filepath.Dir(source), "../..")
	dist := filepath.Join(root, "dist")
	if err := os.MkdirAll(dist, 0755); err != nil {
		t.Fatal(err)
	}
	fixture, err := os.MkdirTemp(dist, "startup-sampling-fixture-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(fixture) })
	directory := filepath.Join(fixture, "data")
	script := filepath.Join(root, "scripts", "core-startup-sampling.mjs")
	init := exec.Command("node", script, "init", "--data-dir", directory)
	init.Dir = root
	if output, err := init.CombinedOutput(); err != nil {
		t.Fatalf("sampler fixture initialization: %v: %s", err, output)
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
	t.Cleanup(func() {
		defer raw.Close()
		cleanup, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := scope.Cleanup(cleanup, raw); err != nil {
			t.Error(err)
		}
	})
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	model := RuntimeInput{AgentImage: image, Provider: testsupport.DeterministicProvider, Model: testsupport.DeterministicModel, Credential: "synthetic-sampling-model"}
	a, base, _ := appFixture(t, Options{DataDirectory: directory, AgentGRPCListen: "0.0.0.0:0", PackageHelperImage: image, FileHelperImage: fileImage, SnapshotHelperImage: snapshotImage, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"sampleadmin", "synthetic-sampling-password"}, Runtime: &model}})
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()
	login, err := a.Identity.Login(ctx, "sampleadmin", "synthetic-sampling-password", "sampler-setup")
	if err != nil {
		t.Fatal(err)
	}
	auth := "Bearer " + login.Token
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Sampling Work", "idempotencyKey": "sampling-work"})
	if status != 202 {
		t.Fatal(status, created)
	}
	workID := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	definition := map[string]any{"name": "sample", "image": map[string]string{"reference": image}, "command": "node", "args": []string{"-e", `require('http').createServer((req,res)=>res.end('sample-ready')).listen(8099,'0.0.0.0')`}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/", "deadlineMs": 10000}}
	status, service := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "sampling-service"})
	if status != 202 {
		t.Fatal(status, service)
	}
	waitWorkOperation(t, ctx, a, service["operationId"].(string))
	serviceID := service["serviceId"].(string)
	// MicroVM keeps Core stdout in the Guest journal. Verify the external
	// sampler can establish a boot baseline from the actual log-export format.
	archivePath := filepath.Join(fixture, "baseline.zip")
	indexPath := filepath.Join(fixture, "baseline.json")
	exporter := exec.Command("node", script, "export-log", "--core", base, "--output", archivePath)
	exporter.Dir = root
	exporter.Env = append(os.Environ(), "PIWORK_STARTUP_ACCOUNT=sampleadmin", "PIWORK_STARTUP_PASSWORD=synthetic-sampling-password")
	if output, err := exporter.CombinedOutput(); err != nil {
		t.Fatalf("actual Core log export failed: %v: %s", err, output)
	}
	collector := exec.Command("python3", filepath.Join(root, "scripts", "core-startup-log-extract.py"), "baseline", "--archive", archivePath, "--index", indexPath)
	if output, err := collector.CombinedOutput(); err != nil {
		t.Fatalf("actual Core log export could not establish a boot baseline: %v: %s", err, output)
	}
	index, err := os.ReadFile(indexPath)
	var baseline struct {
		BootIDs []string `json:"bootIds"`
	}
	if err != nil || json.Unmarshal(index, &baseline) != nil || len(baseline.BootIDs) == 0 {
		t.Fatalf("actual Core log baseline is missing a boot: %s %v", index, err)
	}
	closeCtx, stop := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(closeCtx); err != nil {
		stop()
		t.Fatal(err)
	}
	stop()
	binary := processFixtureBinary(t, image, image, fileImage, snapshotImage)
	imageID := func(ref string) string {
		t.Helper()
		output, err := exec.Command("docker", "--host", host, "image", "inspect", "--format", "{{.Id}}", ref).Output()
		if err != nil {
			t.Fatal("fixture image identity unavailable")
		}
		return strings.TrimSpace(string(output))
	}
	ports := processStartupArgs(t, directory)
	resultFile := filepath.Join(dist, "startup-sampling-"+scope.ID()+".json")
	command := exec.CommandContext(ctx, "node", script, "sample-core", "--data-dir", directory, "--core-bin", binary, "--ui-port", ports[3], "--core-port", ports[5], "--work", workID, "--service", "/services/"+workID+"/"+serviceID+"/8099/", "--agent-image-id", imageID(image), "--file-image-id", imageID(fileImage), "--snapshot-image-id", imageID(snapshotImage), "--samples", "1", "--timeout-ms", "30000", "--output", resultFile)
	command.Dir = root
	command.Env = append(os.Environ(), "DOCKER_HOST="+host, "PIWORK_STARTUP_ACCOUNT=sampleadmin", "PIWORK_STARTUP_PASSWORD=synthetic-sampling-password", "PIWORK_STARTUP_SERVICE_RESPONSE=sample-ready")
	output, runErr := command.CombinedOutput()
	// One retained sample cannot satisfy the required 20-sample group, so a
	// nonzero aggregate exit is expected even when that sample succeeds.
	if runErr == nil {
		t.Fatal("one sample incorrectly passed the 20-sample acceptance group")
	}
	content, err := os.ReadFile(resultFile)
	if err != nil {
		t.Fatalf("sampler did not preserve its result: %v, output=%s", err, output)
	}
	var result struct {
		Samples []struct {
			Success bool           `json:"success"`
			Reason  string         `json:"reason"`
			Counts  map[string]int `json:"counts"`
			Stages  map[string]any `json:"stagesMs"`
		} `json:"samples"`
	}
	if err := json.Unmarshal(content, &result); err != nil || len(result.Samples) != 1 {
		t.Fatal("invalid sampling result", err)
	}
	sample := result.Samples[0]
	if !sample.Success || len(sample.Stages) != 4 || sample.Counts["imageExport"] != 0 || sample.Counts["imageScan"] != 0 || sample.Counts["environmentProbe"] != 0 || sample.Counts["agentHit"] < 1 || sample.Counts["fileHit"] < 1 || sample.Counts["snapshotHit"] < 1 || sample.Counts["environmentHit"] < 1 || sample.Counts["workVerified"] < 1 {
		t.Fatalf("real sample did not meet its component checks: %+v, output=%s", sample, output)
	}
	t.Log("isolated real restart sample saved:", resultFile)
}
