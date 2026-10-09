//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
	"time"
)

func TestNativeKanbanSpecBeforeImplementationSharedUIActionsAndActualEval(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	}
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	trace := func(run map[string]any, prompt string) []map[string]any {
		t.Helper()
		raw := f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {readFileSync} from 'node:fs';const s=WorkStore.open('/var/data/work.sqlite');const r=s.getRun(` + stringMustJSON(run["runId"]) + `);const session=s.getSession(` + stringMustJSON(work) + `,r.sessionId);const entries=readFileSync(session.sdkHistoryPath,'utf8').trim().split('\n').map(JSON.parse);const prompt=` + stringMustJSON(prompt) + `;const userText=m=>typeof m.content==='string'?m.content:m.content?.filter(c=>c.type==='text').map(c=>c.text).join('');const start=entries.findLastIndex(e=>e.message?.role==='user'&&userText(e.message)===prompt);if(start<0)throw Error('accepted SDK prompt missing');const end=entries.findIndex((e,i)=>i>start&&e.message?.role==='user');const args=new Map(entries.slice(start,end<0?undefined:end).flatMap(e=>e.message?.content??[]).filter(c=>c.type==='toolCall').map(c=>[c.id,c.arguments]));console.log(JSON.stringify(s.readEvents(r.runId).filter(e=>e.eventType==='tool-start'||e.eventType==='tool-end').map(e=>{const v=JSON.parse(e.payloadJson);return {sequence:e.sequence,type:e.eventType,...v,...(args.has(v.toolCallId)?{args:args.get(v.toolCallId)}:{})}})));s.close();`)

		var items []map[string]any
		if json.Unmarshal([]byte(strings.TrimSpace(raw)), &items) != nil {
			t.Fatal("invalid real SDK events", raw)
		}
		return items
	}
	specBeforeCode := func(events []map[string]any) {
		t.Helper()
		var spec, implementation float64
		for _, e := range events {
			if e["type"] != "tool-start" || e["toolName"] != "write" {
				continue
			}
			args, ok := e["args"].(map[string]any)
			if !ok {
				continue
			}
			if args["path"] == "apps/kanban/SPEC.md" {
				spec = e["sequence"].(float64)
			} else if args["path"] == "apps/kanban/app.py" || args["path"] == "apps/kanban/columns.json" {
				if implementation == 0 {
					implementation = e["sequence"].(float64)
				}
			}
		}
		if spec == 0 || implementation == 0 || spec >= implementation {
			t.Fatal("Spec was not written before implementation", events)
		}
	}
	created := f.chat("deploy deterministic kanban", "kanban-create")
	specBeforeCode(trace(created, "deploy deterministic kanban"))
	browser := `const {chromium}=require('playwright');(async()=>{const b=await chromium.launch({headless:true});try{const p=await b.newPage();await p.goto(process.argv[1]);await p.waitForFunction(()=>document.querySelector('#card').textContent==='Todo');await p.click('#move');await p.waitForFunction(()=>document.querySelector('#card').textContent==='Doing');console.log('actual-browser-card:Doing')}finally{await b.close()}})().catch(e=>{console.error(e);process.exit(1)})`
	output, err := exec.CommandContext(ctx, node, "-e", browser, f.serviceURL("kanban")).CombinedOutput()
	if err != nil || !strings.Contains(string(output), "actual-browser-card:Doing") {
		t.Fatal("actual Kanban UI", err, string(output))
	}
	moved := f.chat("move deterministic kanban card Done", "kanban-operate")
	if moved["finalText"] != "kanban-card:Done" {
		t.Fatal(moved)
	}
	for _, e := range trace(moved, "move deterministic kanban card Done") {
		if e["toolName"] == "write" || e["toolName"] == "bash" || e["toolName"] == "read" {
			t.Fatal("ordinary Action entered development", e)
		}
	}
	modified := f.chat("modify deterministic kanban", "kanban-modify")
	events := trace(modified, "modify deterministic kanban")
	specBeforeCode(events)
	// These are actual saved host Query results, including the failed review test
	// before its minimal implementation and the unchanged case passing afterward.
	results := f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');console.log(JSON.stringify(s.readEvents(` + stringMustJSON(modified["runId"]) + `).filter(e=>e.eventType==='tool-end').map(e=>JSON.parse(e.payloadJson)).filter(e=>e.toolName==='brain_service').map(e=>JSON.parse(e.result.text).result)));s.close();`)
	var checks []struct {
		Value struct {
			ExitCode int `json:"exitCode"`
		} `json:"value"`
		Checks []struct {
			Passed bool `json:"passed"`
		} `json:"checks"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(results)), &checks) != nil || len(checks) != 2 || checks[0].Value.ExitCode == 0 || checks[0].Checks[0].Passed || checks[1].Value.ExitCode != 0 || !checks[1].Checks[0].Passed {
		t.Fatal("missing actual failed/passed tests", results)
	}
	verified := f.chat("move deterministic kanban card Review", "kanban-review")
	if verified["finalText"] != "kanban-card:Review" {
		t.Fatal(verified)
	}
	t.Log("Actual SDK Spec-first create/modify, UI/Agent parity, failed and passed Python unittest:", created["runId"], moved["runId"], modified["runId"], verified["runId"])
}
