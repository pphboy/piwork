//go:build integration

package coreapp

import (
	"context"
	"os"
	"strconv"
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

func TestNativeSchema5UpgradeRollbackAndDowngradeFence(t *testing.T) {
	checkNativeHistoryUpgrade(t, os.Getenv("PIWORK_TEST_NATIVE_HISTORY5_IMAGE"), 5, false)
}

func TestNativeSchema4ConversationUpgradeRollbackAndDowngradeFence(t *testing.T) {
	checkNativeHistoryUpgrade(t, os.Getenv("PIWORK_TEST_NATIVE_HISTORY4_IMAGE"), 4, false)
}

func TestNativeSchema4ExperienceUpgradeRollbackAndDowngradeFence(t *testing.T) {
	checkNativeHistoryUpgrade(t, os.Getenv("PIWORK_TEST_NATIVE_HISTORY4_IMAGE"), 4, true)
}

func checkNativeHistoryUpgrade(t *testing.T, oldImage string, originalSchema int, seedExperience bool) {
	t.Helper()
	nextImage := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if nextImage == "" || oldImage == "" {
		t.Skip("source and schema-6 acceptance images required")
	}
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", oldImage)
	a, base, auth, work, _ := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 12*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	f.chat("Synthetic history before upgrade", "before-upgrade")
	if seedExperience {
		f.agentEval(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/var/data/work.sqlite');const work=` + stringMustJSON(work) + `,now='2026-10-08T00:00:00.000Z';
for(const [id,state] of [['completed','completed'],['failed','failed'],['waiting','pending']])d.prepare("INSERT INTO agent_requests(work_id,request_id,submission_key,request_digest,source_kind,goal,state,disposition,phase,expires_at,created_at,updated_at) VALUES(?,?,?,?,'chat','Synthetic memory goal',?,'live','handling',?,?,?)").run(work,id,id,id,state,now,now,now);
d.prepare("UPDATE agent_requests SET disposition='historical',expires_at='2099-01-01T00:00:00.000Z' WHERE request_id='waiting'").run();
for(const [id,verified] of [['completed',1],['failed',0],['waiting',0]])d.prepare("INSERT INTO agent_evidence(work_id,evidence_id,request_id,kind,object_ref,observed_at,summary,verified,details_json) VALUES(?,?,?,'query','summary',?,'Synthetic check',?,?)").run(work,'proof-'+id,id,now,verified,JSON.stringify({checks:[{name:'state',passed:verified===1}]}));
for(const [version,id,status,source] of [[1,'rule','effective','completed'],[2,'rule','effective','completed'],[3,'failure','failed','failed'],[4,'candidate','staged','waiting']])d.prepare("INSERT INTO brain_experience_revisions VALUES(?, ?,?,'work',?,?,?, ?,?)").run(work,version,id,'Rule '+id,JSON.stringify(['proof-'+source]),source,status,now);
d.prepare("INSERT INTO brain_experience_heads VALUES(?,2,?) ON CONFLICT(work_id) DO UPDATE SET version=2,updated_at=excluded.updated_at").run(work,now);d.close();`)
	}
	readExperience := func() string {
		return strings.TrimSpace(f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const snap=s.feedback.experienceSnapshot(` + stringMustJSON(work) + `);console.log(JSON.stringify({version:snap.version,entries:snap.entries.map(({kind,createdAt,...entry})=>entry)}));s.close();`))
	}
	oldExperience := ""
	if seedExperience {
		oldExperience = readExperience()
		if !strings.Contains(oldExperience, "Rule rule") {
			t.Fatal("synthetic experience is missing", oldExperience)
		}
	}
	readSchema := func() string {
		return strings.TrimSpace(f.agentEval(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/var/data/work.sqlite');console.log(JSON.stringify({schema:d.prepare('SELECT version FROM schema_migrations').get().version,runs:d.prepare('SELECT COUNT(*) AS n FROM runs').get().n}));d.close();`))
	}
	old := readSchema()
	if !strings.Contains(old, `"schema":`+strconv.Itoa(originalSchema)) {
		t.Fatal("unexpected source schema", old)
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
	status, value := packageHTTPCall(t, base, f.path+"/configuration", "PUT", auth, map[string]any{"configuration": candidate})
	if status != 200 {
		t.Fatal(status, value)
	}
	status, value = packageHTTPCall(t, base, f.path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "schema6-failed"})
	if status != 202 {
		t.Fatal(status, value)
	}
	waitApplyFailure(t, ctx, a, value["operationId"].(string))
	if got := readSchema(); got != old {
		t.Fatal("failed upgrade did not restore source schema", old, got)
	}
	if seedExperience {
		if got := readExperience(); got != oldExperience {
			t.Fatal("rollback lost experience", oldExperience, got)
		}
	}
	candidate["mcpServers"] = prior["mcpServers"]
	status, value = packageHTTPCall(t, base, f.path+"/configuration", "PUT", auth, map[string]any{"configuration": candidate})
	if status != 200 {
		t.Fatal(status, value)
	}
	f.apply("schema6-success")
	if got := readSchema(); !strings.Contains(got, `"schema":6`) || !strings.Contains(got, `"runs":1`) {
		t.Fatal("upgrade lost history", got)
	}
	if seedExperience {
		if got := readExperience(); got != oldExperience {
			t.Fatal("upgrade changed experience", oldExperience, got)
		}
		candidates := f.agentEval(`import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/var/data/memory.sqlite');console.log(JSON.stringify(d.prepare('SELECT candidate_version,status FROM memory_candidates ORDER BY candidate_version').all()));d.close();`)
		if !strings.Contains(candidates, `"candidate_version":3,"status":"failed"`) || !strings.Contains(candidates, `"candidate_version":4,"status":"staged"`) {
			t.Fatal("upgrade lost candidate experience", candidates)
		}
	}
	status, value = packageHTTPCall(t, base, f.path+"/configuration", "PUT", auth, map[string]any{"configuration": prior})
	if status != 200 {
		t.Fatal(status, value)
	}
	status, value = packageHTTPCall(t, base, f.path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "schema5-downgrade"})
	if status != 202 {
		t.Fatal(status, value)
	}
	failed := waitApplyFailure(t, ctx, a, value["operationId"].(string))
	if failed.ErrorJSON == nil || !strings.Contains(*failed.ErrorJSON, "CONTEXT_FORMAT_UNSUPPORTED") {
		t.Fatal("downgrade not fenced", failed)
	}
}
