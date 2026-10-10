//go:build integration

package coreapp

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

func TestNativeLegacyMemoryUpgradeRollbackAndDowngradeFence(t *testing.T) {
	nextImage := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	legacyImage := os.Getenv("PIWORK_TEST_NATIVE_HISTORY4_IMAGE")
	if legacyImage == "" {
		legacyImage = "piwork-memory-history4:acceptance"
	}
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", legacyImage)
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	f.chat("deploy deterministic workstation", "legacy-deploy")
	f.servicePost("/ui/feedback", `{"reason":"review_missing","goal":"The personal review omits completed Todos. Verify legacy experience before migration."}`)
	f.request("legacy experience before migration", "completed")
	old := strings.TrimSpace(f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const snap=s.feedback.experienceSnapshot(` + stringMustJSON(work) + `);console.log(JSON.stringify({version:snap.version,entries:snap.entries.map(({kind,createdAt,...entry})=>entry)}));s.close();`))
	if !strings.Contains(old, "review") {
		t.Fatal("missing verified legacy experience", old)
	}
	prior := f.read(f.path + "/configuration")["desired"].(map[string]any)
	if _, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: nextImage, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"}); err != nil {
		t.Fatal(err)
	}
	if err := a.ScheduleRuntimeRefresh(); err != nil {
		t.Fatal(err)
	}
	for a.Status().State != "READY" {
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(100 * time.Millisecond)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration == nil {
		t.Fatal(err)
	}
	candidate := f.read(f.path + "/configuration")["desired"].(map[string]any)
	candidate["agentImage"] = map[string]any{"catalogId": defaults.Configuration.AgentImage.CatalogId}
	candidate["mcpServers"] = []any{map[string]any{"serverId": "unavailable", "transport": "stdio", "required": true, "command": "/no-such-piwork-mcp", "args": []string{}, "timeoutMs": 1000}}
	status, v := packageHTTPCall(t, base, f.path+"/configuration", "PUT", auth, map[string]any{"configuration": candidate})
	if status != 200 {
		t.Fatal(status, v)
	}
	status, v = packageHTTPCall(t, base, f.path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "migration-failed-load"})
	if status != 202 {
		t.Fatal(status, v)
	}
	failed := waitApplyFailure(t, ctx, a, v["operationId"].(string))
	t.Log("failed candidate and restored old runtime", failed.ID, stringMustJSON(failed.ErrorJSON), stringMustJSON(failed.ResultJSON))
	if got := strings.TrimSpace(f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const snap=s.feedback.experienceSnapshot(` + stringMustJSON(work) + `);console.log(JSON.stringify({version:snap.version,entries:snap.entries.map(({kind,createdAt,...entry})=>entry)}));s.close();`)); got != old {
		t.Fatal("rollback lost legacy experience", old, got)
	}
	candidate["mcpServers"] = prior["mcpServers"]
	status, v = packageHTTPCall(t, base, f.path+"/configuration", "PUT", auth, map[string]any{"configuration": candidate})
	if status != 200 {
		t.Fatal(status, v)
	}
	f.apply("migration-valid")
	if got := strings.TrimSpace(f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const snap=s.feedback.experienceSnapshot(` + stringMustJSON(work) + `);console.log(JSON.stringify({version:snap.version,entries:snap.entries.map(({kind,createdAt,...entry})=>entry)}));s.close();`)); got != old {
		t.Fatal("migration changed existing semantics", old, got)
	}
	t.Log("actual history/Memory pairing", f.agentEval(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/var/data/work.sqlite');d.prepare('ATTACH DATABASE ? AS memory').run('/var/data/memory.sqlite');console.log(JSON.stringify({schema:d.prepare('SELECT version FROM schema_migrations').get(),binding:d.prepare('SELECT * FROM work_memory_binding').get(),memory:d.prepare('SELECT * FROM memory.memory_meta').get()}));d.close();`))
	status, v = packageHTTPCall(t, base, f.path+"/configuration", "PUT", auth, map[string]any{"configuration": prior})
	if status != 200 {
		t.Fatal(status, v)
	}
	status, v = packageHTTPCall(t, base, f.path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "reject-history-downgrade"})
	if status != 202 {
		t.Fatal(status, v)
	}
	failed = waitApplyFailure(t, ctx, a, v["operationId"].(string))
	if failed.ErrorJSON == nil || !strings.Contains(*failed.ErrorJSON, "CONTEXT_FORMAT_UNSUPPORTED") {
		t.Fatal("downgrade was not fenced", failed)
	}
	f.chat(`invoke package tool brain_experience with {"operation":"recall","query":"review","serviceName":"workstation"}`, "migrated-recall")
}
