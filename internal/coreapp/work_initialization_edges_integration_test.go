//go:build integration

package coreapp

import (
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
)

func TestNativeInitialSkillFailureTransientApplyRetryAndMCPRemoval(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	status, initial := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, initial)
	}
	initialRaw, _ := json.Marshal(initial["desired"])
	var initialConfig contracts.WorkConfig
	if err := json.Unmarshal(initialRaw, &initialConfig); err != nil {
		t.Fatal(err)
	}
	initialConfig.McpServers = defaults.Configuration.McpServers
	status, initial = packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": initialConfig})
	if status != 200 {
		t.Fatal(status, initial)
	}
	status, enabled := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "enable-service-mcp"})
	if status != 202 {
		t.Fatal(status, enabled)
	}
	waitWorkOperation(t, ctx, a, enabled["operationId"].(string))
	bad := filepath.Join(t.TempDir(), "bad-sdk-skill")
	if err := os.MkdirAll(bad, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bad, "SKILL.md"), []byte("---\nname: bad-sdk-skill\ndescription: [unterminated\n---\nprivate content\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := a.importSkill(ctx, identity.OperatorPrincipal(), bad, "bad-sdk-skill", false); err != nil {
		t.Fatal("Core must accept regular Skill content without substituting SDK validation", err)
	}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Initial SDK failure", "skills": []string{"bad-sdk-skill"}, "idempotencyKey": "initial-bad-skill"})
	if status != 202 {
		t.Fatal(status, created)
	}
	badWork := created["workId"].(string)
	failed := waitApplyFailure(t, ctx, a, created["operationId"].(string))
	if failed.ErrorJSON == nil || !strings.Contains(*failed.ErrorJSON, "SKILL_LOAD_FAILED") || !strings.Contains(*failed.ErrorJSON, "bad-sdk-skill") {
		t.Fatal(failed)
	}
	status, configuration := packageHTTPCall(t, base, "/api/v1/works/"+badWork+"/configuration", "GET", auth, nil)
	if status != 200 || configuration["active"] != nil || configuration["desired"] == nil || configuration["pendingApply"] != true {
		t.Fatal(configuration)
	}
	status, blocked := packageHTTPCall(t, base, "/api/v1/works/"+badWork+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "must-not-accept"})
	if status == 201 {
		t.Fatal("failed initialization accepted Session", blocked)
	}
	mutate := func(action, key string) string {
		t.Helper()
		status, result := packageHTTPCall(t, base, path+"/"+action, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		return result["operationId"].(string)
	}
	state, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	prior := *state.ActiveContextID
	status, saved := packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": "# Retry this captured context"})
	if status != 200 {
		t.Fatal(status, saved)
	}
	state, err = a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	candidate := *state.DesiredContextID
	root := filepath.Join(a.options.DataDirectory, "works", id, "contexts", candidate)
	manifest := filepath.Join(root, "packages", contracts.PackageNameKey("piwork-brain"), "skills", "deploy-work-service", "SKILL.md")
	if err := os.Chmod(filepath.Dir(manifest), 0755); err != nil {
		t.Fatal(err)
	}
	hidden := manifest + ".fixture-hidden"
	if err := os.Rename(manifest, hidden); err != nil {
		t.Fatal(err)
	}
	first := mutate("configuration/apply", "transient-first")
	waitApplyFailure(t, ctx, a, first)
	state, err = a.Store.Configuration(ctx, id)
	if err != nil || *state.ActiveContextID != prior || *state.DesiredContextID != candidate {
		t.Fatal("transient failure lost captured context", state, err)
	}
	if err := os.Rename(hidden, manifest); err != nil {
		t.Fatal(err)
	}
	if replay := mutate("configuration/apply", "transient-first"); replay != first {
		t.Fatal("failed key retried execution")
	}
	retry := mutate("configuration/apply", "transient-retry")
	if retry == first {
		t.Fatal("new key did not create new Operation")
	}
	waitWorkOperation(t, ctx, a, retry)
	state, err = a.Store.Configuration(ctx, id)
	if err != nil || *state.ActiveContextID != candidate {
		t.Fatal("same recovered candidate not activated", state, err)
	}
	if replay := mutate("configuration/apply", "transient-retry"); replay != retry {
		t.Fatal("successful retry key did not replay")
	}
	status, saved = packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": "# AGENTS failure"})
	if status != 200 {
		t.Fatal(status, saved)
	}
	state, err = a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	agents := filepath.Join(a.options.DataDirectory, "works", id, "contexts", *state.DesiredContextID, "AGENTS.md")
	if err := os.Chmod(agents, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(agents, []byte(strings.Repeat("x", 256*1024+1)), 0600); err != nil {
		t.Fatal(err)
	}
	agentsFailure := waitApplyFailure(t, ctx, a, mutate("configuration/apply", "agents-failure"))
	if agentsFailure.ErrorJSON == nil || !strings.Contains(*agentsFailure.ErrorJSON, "AGENTS.md") {
		t.Fatal("AGENTS failure is not actionable", agentsFailure)
	}
	state, err = a.Store.Configuration(ctx, id)
	if err != nil || *state.ActiveContextID != candidate {
		t.Fatal("invalid AGENTS replaced active", state, err)
	}
	// Saving valid content creates another owned context; explicit MCP removal
	// must reach the real daemon rather than falling back to Core defaults.
	status, saved = packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": "# Remove service tools"})
	if status != 200 {
		t.Fatal(status, saved)
	}
	status, configuration = packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, configuration)
	}
	raw, _ := json.Marshal(configuration["desired"])
	var config contracts.WorkConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		t.Fatal(err)
	}
	config.McpServers = []contracts.McpServer{}
	status, saved = packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 {
		t.Fatal(status, saved)
	}
	waitWorkOperation(t, ctx, a, mutate("configuration/apply", "remove-mcp"))
	work, err := a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	var generation int64
	var instance string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT generation,instance_id FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, id).Scan(&generation, &instance)
	}); err != nil {
		t.Fatal(err)
	}
	agent, _, err := a.agentRoutes.Admission(internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: id, Generation: generation, InstanceID: instance}, *work.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := agent.ObserveReadiness(ctx, *work.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range ready.GetResolvedTools() {
		if strings.HasPrefix(name, "work-services") {
			t.Fatal("removed MCP tools reintroduced", name)
		}
	}
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "after-mcp-removal"})
	if status != 201 || session["sessionId"] == nil {
		t.Fatal("validated MCP-free context cannot create Session", status, session)
	}
	t.Log("SDK-invalid initial selection failed before Session; same captured candidate retried after dependency restoration; AGENTS failure retained prior active; explicit MCP removal reached daemon")
}

func TestNativeRemovedServiceMCPRemainsAbsentAcrossSnapshot(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	mutate := func(action, key string) string {
		t.Helper()
		status, result := packageHTTPCall(t, base, path+"/"+action, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		return result["operationId"].(string)
	}
	state, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	var configuration contracts.WorkConfig
	if json.Unmarshal([]byte(state.DesiredConfigJSON), &configuration) != nil {
		t.Fatal("configuration")
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	configuration.McpServers = defaults.Configuration.McpServers
	if len(configuration.McpServers) == 0 {
		t.Fatal("missing baseline MCP")
	}
	status, result := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": configuration})
	if status != 200 {
		t.Fatal(status, result)
	}
	waitWorkOperation(t, ctx, a, mutate("configuration/apply", "activate-mcp"))
	configuration.McpServers = []contracts.McpServer{}
	status, result = packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": configuration})
	if status != 200 {
		t.Fatal(status, result)
	}
	waitWorkOperation(t, ctx, a, mutate("configuration/apply", "remove-mcp"))
	waitWorkOperation(t, ctx, a, mutate("stop", "stop-mcp-free"))
	exported := mutate("exports", "export-mcp-free")
	waitWorkOperation(t, ctx, a, exported)
	var pack string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT package_id FROM snapshot_jobs WHERE operation_id=?`, exported).Scan(&pack)
	}); err != nil {
		t.Fatal(err)
	}
	status, imported := packageHTTPCall(t, base, "/api/v1/work-imports", "POST", auth, map[string]string{"packageId": pack, "idempotencyKey": "import-mcp-free"})
	if status != 202 {
		t.Fatal(status, imported)
	}
	waitWorkOperation(t, ctx, a, imported["operationId"].(string))
	copyID := imported["workId"].(string)
	status, started := packageHTTPCall(t, base, "/api/v1/works/"+copyID+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-mcp-free"})
	if status != 202 {
		t.Fatal(status, started)
	}
	waitWorkOperation(t, ctx, a, started["operationId"].(string))
	copyWork, err := a.Store.Work(ctx, copyID, false)
	if err != nil {
		t.Fatal(err)
	}
	copyGeneration, copyInstance, err := a.selectAgentGeneration(ctx, copyWork)
	if err != nil {
		t.Fatal(err)
	}
	copyDaemon, _, err := a.agentRoutes.Admission(internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: copyID, Generation: copyGeneration, InstanceID: copyInstance}, *copyWork.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	copyReady, err := copyDaemon.ObserveReadiness(ctx, *copyWork.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range copyReady.GetResolvedTools() {
		if strings.HasPrefix(name, "work-services") {
			t.Fatal("import reintroduced removed service tools", name)
		}
	}

}
