//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

func waitDefaultReady(t *testing.T, ctx context.Context, a *Application) {
	t.Helper()
	for !a.Status().Ready {
		select {
		case <-ctx.Done():
			t.Fatal("default preparation did not finish", a.Preparation())
		case <-time.After(20 * time.Millisecond):
		}
	}
}

func TestNativeLatencyColdConcurrentLargePackageAndSlowMCP(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixtureConfig(t, true)
	report := map[string]any{"version": 1, "excludedFromDefaultBudget": true}
	production := os.Getenv("PIWORK_TEST_PRODUCTION_AGENT_IMAGE")
	if production == "" {
		production = "piwork-agentd:go-migration-production"
	}
	image, err := a.engine.InspectImage(ctx, production)
	if err != nil {
		t.Fatal(err)
	}
	checks, probes := a.inspector.PreparationStats().Preparations, a.environmentCache.Stats().Preparations
	start := time.Now()
	var group sync.WaitGroup
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := a.inspector.InspectNativeAgent(ctx, image.ID); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	report["coldImageConcurrentMs"] = float64(time.Since(start)) / float64(time.Millisecond)
	start = time.Now()
	for range 8 {
		group.Add(1)
		go func() {
			defer group.Done()
			if _, err := a.probePackageEnvironment(ctx, image.ID); err != nil {
				t.Error(err)
			}
		}()
	}
	group.Wait()
	report["coldEnvironmentConcurrentMs"] = float64(time.Since(start)) / float64(time.Millisecond)
	if a.inspector.PreparationStats().Preparations-checks != 1 || a.environmentCache.Stats().Preparations-probes != 1 {
		t.Fatal("real concurrent cold preparation was duplicated")
	}
	report["concurrentCallers"], report["coldImageChecks"], report["coldEnvironmentProbes"] = 8, 1, 1
	const payloadBytes = 20 * 1024 * 1024
	const name = "latency-large"
	mcp := `import readline from 'node:readline';
const input=readline.createInterface({input:process.stdin});
input.on('line',line=>{const m=JSON.parse(line);const reply=result=>console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
if(m.method==='initialize')setTimeout(()=>reply({protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'latency-slow',version:'1.0.0'}}),1500);
else if(m.method==='tools/list')reply({tools:[]});});`
	packed := packageZip(t, map[string]string{"package.json": `{"name":"latency-large","version":"1.0.0","type":"module","pi":{"skills":["skills/payload/SKILL.md"]}}`, "skills/payload/SKILL.md": "---\nname: latency-payload\ndescription: Synthetic payload for measuring package capture and loading.\n---\nRead the synthetic package payload when requested.\n", "payload.dat": strings.Repeat("x", payloadBytes), "mcp.mjs": mcp})
	sum := sha256.Sum256(packed)
	request, err := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/admin/package-uploads", bytes.NewReader(packed))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	request.Header.Set("Content-Type", "application/zip")
	request.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
	request.Header.Set("X-Piwork-Package-Source", "zip")
	request.Header.Set("X-Piwork-Package-Name", "latency-large.zip")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded map[string]any
	err = json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	if err != nil || response.StatusCode != 201 {
		t.Fatal(response.StatusCode, err)
	}
	status, installed := packageHTTPCall(t, base, "/api/v1/admin/packages", "POST", auth, map[string]any{"source": map[string]any{"kind": "upload", "uploadId": uploaded["uploadId"]}, "idempotencyKey": "latency-large-install", "addToDefaults": false})
	if status != 202 {
		t.Fatal(status, installed)
	}
	waitWorkOperation(t, ctx, a, installed["operationId"].(string))
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	configuration := *defaults.Configuration
	configuration.Packages = append(append(contracts.PiPackageSelection{}, configuration.Packages...), contracts.PiPackageSelectionEntry{Name: name, Enabled: true})
	create := func(label string, configuration contracts.WorkConfig) map[string]any {
		t.Helper()
		start := time.Now()
		status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": label, "configuration": configuration, "idempotencyKey": label})
		accepted := time.Now()
		if status != 202 {
			t.Fatal(status, created)
		}
		waitWorkOperation(t, ctx, a, created["operationId"].(string))
		return map[string]any{"acceptanceMs": float64(accepted.Sub(start)) / float64(time.Millisecond), "afterAcceptanceMs": float64(time.Since(accepted)) / float64(time.Millisecond)}
	}
	report["largePackageBytes"] = payloadBytes
	report["largePackage"] = create("Latency large package", configuration)
	configuration.McpServers = append(append([]contracts.McpServer{}, configuration.McpServers...), contracts.McpServer{ServerId: "latency-slow", Transport: "stdio", Required: true, Command: contracts.Supplied("node"), Args: contracts.Supplied([]string{"/run/piwork/packages/" + contracts.PackageNameKey(name) + "/mcp.mjs"}), TimeoutMs: contracts.Supplied(int64(10_000))})
	report["slowMcpDelayMs"] = 1500
	report["largePackageWithSlowMcp"] = create("Latency large package slow MCP", configuration)
	status, racing := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Stop cached creation while starting", "configuration": configuration, "idempotencyKey": "latency-stop-starting"})
	if status != 202 {
		t.Fatal(status, racing)
	}
	racingID := racing["workId"].(string)
	for {
		container, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: racingID, Kind: "agent", LogicalID: "agentd"})
		if err != nil {
			t.Fatal(err)
		}
		if container != nil && container.State != nil && container.State.Running {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("Agent did not reach Starting")
		case <-time.After(20 * time.Millisecond):
		}
	}
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+racingID+"/stop", "POST", auth, map[string]any{"idempotencyKey": "latency-stop-before-ready"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	original, err := a.Store.Operation(ctx, racing["operationId"].(string))
	if err != nil || original.State != "superseded" {
		t.Fatal("cached creation ignored newer Stop", original.State, err)
	}
	stoppedWork, err := a.Store.Work(ctx, racingID, false)
	if err != nil || stoppedWork.ObservedState != "stopped" {
		t.Fatal(stoppedWork, err)
	}
	report["stopDuringCachedCreation"] = "superseded-and-stopped"
	if a.inspector.PreparationStats().Preparations-checks != 1 || a.environmentCache.Stats().Preparations-probes != 1 {
		t.Fatal("large package or MCP path repeated image-level preparation")
	}
	if target := os.Getenv("PIWORK_TEST_LATENCY_REPORT"); target != "" {
		if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			t.Fatal(err)
		}
		raw, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, append(raw, '\n'), 0600); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(report)
	t.Log(string(raw))
}

func TestNativeWarmDefaultCreationRetainedStartAndRestart(t *testing.T) {
	a, base, auth, first, ctx := nativeApplyFixtureConfig(t, true, RuntimeInput{Provider: "openai", Model: "gpt-4.1-mini", Credential: "latency-fixture-key"})
	expected := uint64(1)
	if a.options.FileHelperImage != "" {
		expected++
	}
	if a.options.SnapshotHelperImage != "" {
		expected++
	}
	if stats := a.inspector.PreparationStats(); stats.Preparations != expected {
		t.Fatal("first default Work repeated image checks", stats, expected)
	}
	if stats := a.environmentCache.Stats(); stats.Preparations != 1 {
		t.Fatal("first default Work repeated environment probe", stats)
	}
	imageChecks, probes := a.inspector.PreparationStats().Preparations, a.environmentCache.Stats().Preparations
	for _, action := range []string{"stop", "start"} {
		status, result := packageHTTPCall(t, base, "/api/v1/works/"+first+"/"+action, "POST", auth, map[string]any{"idempotencyKey": "latency-" + action})
		if status != 202 {
			t.Fatal(status, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
	}
	if a.inspector.PreparationStats().Preparations != imageChecks || a.environmentCache.Stats().Preparations != probes {
		t.Fatal("retained Start repeated shared preparation")
	}
	// Keep the default brain enabled for this restart: its seed is already
	// installed, so only the explicit prewarm path can prepare the environment.
	{
		if err := a.Close(context.Background()); err != nil {
			t.Fatal(err)
		}
		options := a.options
		options.Initialization = Initialization{}
		a, base, _ = appFixture(t, options)
		if a.environmentCache.Stats().Preparations != 1 {
			t.Fatal("installed brain skipped default environment prewarm", a.environmentCache.Stats())
		}
		login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "installed-brain-restart")
		if err != nil {
			t.Fatal(err)
		}
		auth = "Bearer " + login.Token
		imageChecks, probes = a.inspector.PreparationStats().Preparations, a.environmentCache.Stats().Preparations
		status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Installed brain first after restart", "idempotencyKey": "latency-installed-brain-restart"})
		if status != 202 {
			t.Fatal(status, created)
		}
		waitWorkOperation(t, ctx, a, created["operationId"].(string))
		if a.inspector.PreparationStats().Preparations != imageChecks || a.environmentCache.Stats().Preparations != probes {
			t.Fatal("first default with installed brain repeated preparation")
		}
	}
	production := os.Getenv("PIWORK_TEST_PRODUCTION_AGENT_IMAGE")
	if production == "" {
		production = "piwork-agentd:go-migration-production"
	}
	status, view := packageHTTPCall(t, base, "/api/v1/admin/default-work", "PATCH", auth, map[string]any{"baseImage": production, "packages": []string{}})
	if status != 200 {
		t.Fatal(status, view)
	}
	waitDefaultReady(t, ctx, a)
	selected, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	image, _, err := a.resolveWorkImage(ctx, selected.Configuration.AgentImage.CatalogId)
	if err != nil {
		t.Fatal(err)
	}
	if image.Labels["io.piwork.agent.variant"] != "production" {
		t.Fatal("prewarm used global runtime image instead of actual defaults")
	}
	if a.environmentCache.Stats().Preparations != probes {
		t.Fatal("empty defaults required a new environment probe")
	}
	imageChecks = a.inspector.PreparationStats().Preparations
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Independent production default", "idempotencyKey": "latency-independent-default"})
	if status != 202 {
		t.Fatal(status, created)
	}
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	if a.inspector.PreparationStats().Preparations != imageChecks || a.environmentCache.Stats().Preparations != probes {
		t.Fatal("actual default was not warmed")
	}
	oldWork, err := a.Store.Work(ctx, first, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	options := a.options
	options.Initialization = Initialization{}
	restarted, newBase, newOperator := appFixture(t, options)
	if !restarted.Status().Ready {
		t.Fatal("restarted Core did not warm installed defaults")
	}
	retainedDefaults, err := restarted.Store.DefaultWork(ctx)
	if err != nil || len(retainedDefaults.Configuration.Packages) != 0 || restarted.environmentCache.Stats().Preparations != 0 {
		t.Fatal("restart re-enabled empty defaults or required an environment probe", err, restarted.environmentCache.Stats())
	}
	after, err := restarted.Store.Work(ctx, first, false)
	if err != nil || after.ActiveContextID == nil || *after.ActiveContextID != *oldWork.ActiveContextID {
		t.Fatal("restart changed captured Work context", after, err)
	}
	login, err := restarted.Identity.Login(ctx, "admin", "development-fixture-pass", "latency-restart")
	if err != nil {
		t.Fatal(err)
	}
	_ = newOperator
	imageChecks, probes = restarted.inspector.PreparationStats().Preparations, restarted.environmentCache.Stats().Preparations
	status, created = packageHTTPCall(t, newBase, "/api/v1/works", "POST", "Bearer "+login.Token, map[string]any{"name": "First after Core restart", "idempotencyKey": "latency-first-after-restart"})
	if status != 202 {
		t.Fatal(status, created)
	}
	waitWorkOperation(t, ctx, restarted, created["operationId"].(string))
	if restarted.inspector.PreparationStats().Preparations != imageChecks || restarted.environmentCache.Stats().Preparations != probes {
		t.Fatal("first Work after restart was not warmed")
	}
	t.Log("default first create, retained Start, independent production default, empty packages and restart reused shared preparation")
}
