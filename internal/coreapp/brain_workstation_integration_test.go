//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"github.com/moby/moby/client"
	"io"
	"net/http"
	"os"
	"os/exec"
	"piwork/internal/dockerengine"
	"strings"
	"testing"
	"time"
)

type brainAcceptance struct {
	t                      *testing.T
	a                      *Application
	base, auth, work, path string
	ctx                    context.Context
	session                string
}

func (f *brainAcceptance) read(path string) map[string]any {
	f.t.Helper()
	status, v := packageHTTPCall(f.t, f.base, path, "GET", f.auth, nil)
	if status != 200 {
		if status == 500 && strings.Contains(path, "agent-requests") {
			f.t.Log("feedback contract diagnosis", f.agentEval("import {WorkStore} from '@piwork/work-store';import {AgentRequestPageSchema} from '@piwork/contracts';import {Value} from '@sinclair/typebox/value';const s=WorkStore.open('/var/data/work.sqlite');try{const page=s.feedback.listRequests("+stringMustJSON(f.work)+",{limit:100});console.log(JSON.stringify([...Value.Errors(AgentRequestPageSchema,{...page,checkedAt:new Date().toISOString(),availability:'available'})].map(e=>({path:e.path,message:e.message}))));}catch(e){console.log(e.message)}finally{s.close()}"))
		}
		f.t.Fatal(path, status, v)
	}
	return v
}
func (f *brainAcceptance) chat(prompt, key string) map[string]any {
	f.t.Helper()
	if f.session == "" {
		status, v := packageHTTPCall(f.t, f.base, f.path+"/sessions", "POST", f.auth, map[string]string{"idempotencyKey": "brain-chat-" + key})
		if status != 201 {
			f.t.Fatal("create manual Session", f.work, prompt, status, v)
		}
		f.session = v["sessionId"].(string)
	}
	status, v := packageHTTPCall(f.t, f.base, f.path+"/runs", "POST", f.auth, map[string]string{"sessionId": f.session, "submissionKey": key, "prompt": prompt})
	if status != 202 {
		f.t.Fatal("submit manual Run", f.work, prompt, status, v)
	}
	id := v["run"].(map[string]any)["runId"].(string)
	for {
		run := f.read(f.path + "/runs/" + id)
		if state := int(run["state"].(float64)); state >= 4 {
			if state != 4 {
				f.t.Fatal("SDK run failed", prompt, run)
			}
			return run
		}
		if f.ctx.Err() != nil {
			f.t.Fatal(f.ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
}
func (f *brainAcceptance) requests() []any {
	return f.read(f.path + "/agent-requests?limit=100")["items"].([]any)
}
func (f *brainAcceptance) brainPackage() map[string]any {
	f.t.Helper()
	for _, p := range f.read(f.path + "/packages")["packages"].([]any) {
		v := p.(map[string]any)
		if v["name"] == brainPackageName {
			return v
		}
	}
	f.t.Fatal("brain package projection missing")
	return nil
}
func (f *brainAcceptance) request(goal, state string) map[string]any {
	f.t.Helper()
	deadline := time.Now().Add(120 * time.Second)
	var found map[string]any
	for time.Now().Before(deadline) && f.ctx.Err() == nil {
		for _, v := range f.requests() {
			r := v.(map[string]any)
			if r["disposition"] == "live" && strings.Contains(r["goal"].(string), goal) {
				found = r
				if r["state"] == state {
					return f.read(f.path + "/agent-requests/" + r["requestId"].(string))
				}
				if r["state"] == "failed" || r["state"] == "needs_attention" {
					f.t.Fatal("automatic goal failed", r)
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	f.t.Fatal("request did not reach state", goal, state, found)
	return nil
}
func (f *brainAcceptance) serviceURL(names ...string) string {
	f.t.Helper()
	name := "workstation"
	if len(names) == 1 {
		name = names[0]
	}
	var id string
	if err := f.a.Store.Read(f.ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT service_id FROM service_heads WHERE work_id=? AND name=? AND tombstoned_at IS NULL", f.work, name).Scan(&id)
	}); err != nil {
		f.t.Fatal(err)
	}
	network, err := f.a.dockerRuntime.EnsureNetwork(f.ctx, f.work)
	if err != nil {
		f.t.Fatal(err)
	}
	address, err := f.a.dockerRuntime.ContainerAddress(f.ctx, serviceContainerIdentity(f.work, id, 0), network.Name)
	if err != nil {
		f.t.Fatal(err)
	}
	return "http://" + address + ":8080"
}
func (f *brainAcceptance) servicePost(path string, body string) map[string]any {
	f.t.Helper()
	req, err := http.NewRequestWithContext(f.ctx, "POST", f.serviceURL()+path, strings.NewReader(body))
	if err != nil {
		f.t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		f.t.Fatal(err)
	}
	defer response.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	var value map[string]any
	if response.StatusCode != 200 || json.Unmarshal(raw, &value) != nil {
		f.t.Fatal(path, response.StatusCode, string(raw))
	}
	return value
}
func (f *brainAcceptance) apply(key string) {
	f.t.Helper()
	status, v := packageHTTPCall(f.t, f.base, f.path+"/configuration/apply", "POST", f.auth, map[string]string{"idempotencyKey": key})
	if status != 202 {
		f.t.Fatal(status, v)
	}
	waitWorkOperation(f.t, f.ctx, f.a, v["operationId"].(string))
	f.session = ""
}
func (f *brainAcceptance) agentEval(program string) string {
	f.t.Helper()
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		f.t.Fatal(err)
	}
	defer raw.Close()
	var id string
	if err := f.a.Store.Read(f.ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT runtime_id FROM resource_bindings WHERE work_id=? AND resource_kind='agent' AND logical_id=?", f.work, f.work+"/agentd").Scan(&id)
	}); err != nil {
		f.t.Fatal(err)
	}
	job, err := raw.ExecCreate(f.ctx, id, client.ExecCreateOptions{Cmd: []string{"node", "--no-warnings", "--input-type=module", "-e", program}, AttachStdout: true, AttachStderr: true, User: "10001:10001"})
	if err != nil {
		f.t.Fatal(err)
	}
	attached, err := raw.ExecAttach(f.ctx, job.ID, client.ExecAttachOptions{})
	if err != nil {
		f.t.Fatal(err)
	}
	defer attached.Close()
	var out bytes.Buffer
	if err := dockerengine.Demultiplex(f.ctx, attached.Reader, &out, &out); err != nil {
		f.t.Fatal(err)
	}
	return out.String()
}
func TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal(err)
	} // Development-only browser driver; product host PATH is removed by fixture.
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	// The complete locked environment is shared through three exports and two
	// independent imports. Allow the test driver to finish those disk round trips;
	// each Service readiness and automatic Run/Goal keeps its product deadline.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}

	status, models := packageHTTPCall(t, base, f.path+"/models", "GET", auth, nil)
	if status != 200 {
		view, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"})
		if err == nil && view != nil {
			logs, _ := a.dockerRuntime.Logs(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"}, 10, view.ID)
			t.Log("model debug", logs.Text)
		}
		t.Fatal(status, models)
	}
	deployed := f.chat("deploy deterministic workstation", "deploy-station")
	if !strings.Contains(deployed["finalText"].(string), "workstation-deployed:") {
		t.Fatal(deployed)
	}
	program := `import {chromium,expect} from '@playwright/test'; const browser=await chromium.launch({headless:true,channel:'chromium'});try{const page=await browser.newPage();page.on('pageerror',e=>console.error('Application error:',e.message));await page.goto(process.argv[1]);await page.getByLabel('Todo title',{exact:true}).fill('Go Core closed loop');await page.getByRole('button',{name:'Add Todo',exact:true}).click();await expect(page.getByText('Go Core closed loop',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Complete',exact:true}).click();await expect(page.getByText('Completed',{exact:true})).toBeVisible();await page.getByRole('link',{name:'Personal review'}).click();await expect(page.getByText('Completed Todos: 0',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Report missing completed Todos',exact:true}).click();console.log('real React browser and FastAPI created/completed Todo and submitted feedback');}finally{await browser.close()}`
	command := exec.CommandContext(ctx, node, "--input-type=module", "-e", program, f.serviceURL())
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatal("workstation browser", err, string(output))
	}
	t.Log(string(output))
	detail := f.request("personal review omits", "completed")
	if len(detail["evidence"].(map[string]any)["items"].([]any)) == 0 {
		t.Fatal("completion lacks real Service evidence", detail)
	}
	cognition := f.chat("inspect piwork brain cognition for personal review", "adopt-experience")
	if !strings.HasSuffix(cognition["finalText"].(string), ":true") || cognition["adoptedExperienceVersion"].(float64) < 1 {
		t.Fatal("next SDK execution did not adopt committed experience", cognition)
	}
	originalRun := f.read(f.path + "/runs/" + deployed["runId"].(string))
	if originalRun["adoptedExperienceVersion"] != deployed["adoptedExperienceVersion"] {
		t.Fatal("experience adoption changed an accepted Run snapshot", originalRun)
	}
	f.servicePost("/ui/feedback", `{"reason":"export_review","goal":"Export the personal review and verify the original export Job"}`)
	waiting := f.request("Export the personal", "waiting_result")
	if waiting["request"].(map[string]any)["waitRef"].(map[string]any)["kind"] != "job" {
		t.Fatal(waiting)
	}
	// A waiting automatic goal releases the Run slot for manual Chat.
	f.chat("inspect piwork brain cognition", "chat-while-job-waits")
	f.request("Export the personal", "completed")
	manualCandidate := f.chat("prepare workstation brain candidate go-native-candidate", "candidate-intent")
	candidate := f.request("go-native-candidate", "waiting_apply")
	req := candidate["request"].(map[string]any)
	if req["waitRef"].(map[string]any)["kind"] != "apply" {
		t.Fatal(candidate)
	}
	packages := f.read(f.path + "/packages")["packages"].([]any)
	var brain map[string]any
	for _, p := range packages {
		v := p.(map[string]any)
		if v["name"] == "piwork-brain" {
			brain = v
		}
	}
	if brain == nil || brain["candidate"].(map[string]any)["active"] == true {
		t.Fatal("candidate changed active without Apply", packages)
	}
	// A stopped interval must retain the original candidate and first Apply deadline;
	// startup performs readonly reconciliation without another prepare or model Run.
	beforeID := req["requestId"].(string)
	beforeWait := req["waitRef"].(map[string]any)
	beforeCount := req["autoRunCount"]
	f.control("stop", "candidate-wait-stop")
	f.control("start", "candidate-wait-start")
	after := f.read(f.path + "/agent-requests/" + beforeID)["request"].(map[string]any)
	if after["autoRunCount"] != beforeCount || after["expiresAt"] != req["expiresAt"] || after["waitRef"].(map[string]any)["id"] != beforeWait["id"] || after["waitRef"].(map[string]any)["deadlineAt"] != beforeWait["deadlineAt"] {
		t.Fatal("candidate recovery replayed work or reset its original deadline", beforeWait, after)
	}
	f.apply("adopt-candidate")
	status, refused := packageHTTPCall(t, base, f.path+"/runs", "POST", auth, map[string]string{"sessionId": manualCandidate["sessionId"].(string), "submissionKey": "old-context-must-not-run", "prompt": "identify current model"})
	if status != 503 || refused["code"] != "WORK_UNAVAILABLE" {
		t.Fatal("old captured Session must fail explicitly without a Run or fallback", status, refused)
	}
	verified := f.request("go-native-candidate", "completed")
	hasSDK := false
	for _, e := range verified["evidence"].(map[string]any)["items"].([]any) {
		v := e.(map[string]any)
		if v["kind"] == "sdk" && v["verified"] == true {
			hasSDK = true
		}
	}
	if !hasSDK {
		t.Fatal("loaded package did not produce actual SDK proof", verified)
	}
	f.shareCopies()
	f.chat("prepare broken workstation brain candidate go-native-broken", "broken-candidate-intent")
	brokenWaiting := f.request("go-native-broken", "waiting_apply")
	brokenID := brokenWaiting["request"].(map[string]any)["requestId"].(string)
	prior, err := a.Store.Work(ctx, work, false)
	if err != nil {
		t.Fatal(err)
	}
	// Saving unrelated configuration creates a different context with identical
	// candidate bytes. Its actual failing Apply must still settle the original goal.
	configuration := f.read(f.path + "/configuration")["desired"].(map[string]any)
	unrelatedAgents := configuration["agentsMd"].(string) + "\nUnrelated workstation note retained after candidate failure.\n"
	if status, saved := packageHTTPCall(t, base, f.path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": unrelatedAgents}); status != 200 || saved["pendingApply"] != true {
		t.Fatal("unrelated Save", status, saved)
	}
	afterSave, err := a.Store.Work(ctx, work, false)
	if err != nil || afterSave.DesiredContextID == nil || prior.DesiredContextID == nil || *afterSave.DesiredContextID == *prior.DesiredContextID {
		t.Fatal("unrelated Save did not create a new captured context", afterSave, err)
	}
	status, failedApply := packageHTTPCall(t, base, f.path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "load-broken-candidate"})
	if status != 202 {
		t.Fatal(status, failedApply)
	}
	waitApplyFailure(t, ctx, a, failedApply["operationId"].(string))
	restored, err := a.Store.Work(ctx, work, false)
	if err != nil || restored.ObservedState != "ready" || restored.ActiveContextID == nil || prior.ActiveContextID == nil || *restored.ActiveContextID != *prior.ActiveContextID {
		t.Fatal("failed candidate load did not restore prior active", prior, restored, err)
	}
	f.session = ""
	brokenFailure := f.request("go-native-broken", "needs_attention")
	if brokenFailure["request"].(map[string]any)["requestId"] != brokenID {
		t.Fatal("wrong failed-load request", brokenFailure)
	}
	brokenApply := f.brainPackage()["candidate"].(map[string]any)["apply"].(map[string]any)
	if brokenApply["availability"] != "available" || brokenApply["operationId"] != failedApply["operationId"] || brokenApply["state"] != "failed" {
		t.Fatal("failed Apply after unrelated Save was lost", brokenApply, failedApply)
	}
	if f.read(f.path + "/configuration")["desired"].(map[string]any)["agentsMd"] != unrelatedAgents {
		t.Fatal("candidate failure discarded unrelated Save")
	}
	f.chat("restore workstation brain source", "restore-after-failed-load")
	f.chat("prepare bad behavior workstation brain candidate go-native-bad", "bad-candidate-intent")
	badWaiting := f.request("go-native-bad", "waiting_apply")
	badID := badWaiting["request"].(map[string]any)["requestId"].(string)
	if badID == brokenID {
		t.Fatal("bad behavior must have its own live request")
	}
	badTarget := f.brainPackage()["candidate"].(map[string]any)["verification"].(map[string]any)["toolName"].(string)
	beforeBad, err := a.Store.Work(ctx, work, false)
	if err != nil || beforeBad.DesiredContextID == nil {
		t.Fatal("bad candidate not captured", beforeBad, err)
	}
	experienceProgram := "import {WorkStore} from '@piwork/work-store';const s=WorkStore.open('/var/data/work.sqlite');try{console.log(JSON.stringify(s.feedback.experienceSnapshot(" + stringMustJSON(work) + ")));}finally{s.close()}"
	experienceBefore := f.agentEval(experienceProgram)
	f.apply("load-bad-behavior")
	attention := f.request("go-native-bad", "needs_attention")
	badRequest := attention["request"].(map[string]any)
	if badRequest["requestId"] != badID || badRequest["disposition"] != "live" || badRequest["error"].(map[string]any)["code"] != "VERIFICATION_REQUIRED" {
		t.Fatal("this candidate lacks its own behavior failure", attention)
	}
	var failedProof map[string]any
	for _, e := range attention["evidence"].(map[string]any)["items"].([]any) {
		proof := e.(map[string]any)
		if proof["kind"] == "sdk" && proof["verified"] == false && proof["objectRef"] == badTarget && strings.Contains(proof["summary"].(string), "failed") {
			failedProof = proof
		}
	}
	if failedProof == nil || failedProof["runId"] == nil {
		t.Fatal("this candidate lacks actual failed SDK checks", attention)
	}
	failedRun := f.read(f.path + "/runs/" + failedProof["runId"].(string))
	if failedRun["source"].(map[string]any)["requestId"] != badID {
		t.Fatal("failed SDK proof belongs to another Run/request", failedRun, failedProof)
	}
	current, err := a.Store.Work(ctx, work, false)
	if err != nil || current.ObservedState != "ready" || current.ActiveContextID == nil || *current.ActiveContextID != *beforeBad.DesiredContextID {
		t.Fatal("behavior failure falsely rolled back runtime", current, err)
	}
	loadedBad := f.brainPackage()
	loadedCandidate := loadedBad["candidate"].(map[string]any)
	if loadedCandidate["requestId"] != badID || loadedCandidate["active"] != true || loadedCandidate["adoption"] != "failed" || loadedBad["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal("bad candidate must remain actually active and loaded", loadedBad)
	}
	if experienceAfter := f.agentEval(experienceProgram); experienceAfter != experienceBefore {
		t.Fatal("failed behavior committed effective experience", experienceBefore, experienceAfter)
	}
	t.Log("Current failed SDK checks", badID, failedProof["runId"], failedProof["summary"], "active context", *current.ActiveContextID, "experience unchanged")
	t.Log("Go Core + real SDK/MCP + FastAPI/React: facts, automatic repair, Job continuation, committed experience, explicit Apply, actual matching behavior proof and loaded failure all observed")
	// Check public graph and private credentials remain separated.
	raw, _ := json.Marshal(f.requests())
	if strings.Contains(string(raw), "credentialRef") || strings.Contains(string(raw), "/etc/piwork") {
		t.Fatal("private execution material escaped")
	}
}

func (f *brainAcceptance) control(action, key string) {
	f.t.Helper()
	status, v := packageHTTPCall(f.t, f.base, f.path+"/"+action, "POST", f.auth, map[string]string{"idempotencyKey": key})
	if status != 202 {
		f.t.Fatal(action, status, v)
	}
	waitWorkOperation(f.t, f.ctx, f.a, v["operationId"].(string))
	f.session = ""
}
func (f *brainAcceptance) shareCopies() {
	f.t.Helper()
	f.control("stop", "share-source-stop")
	status, exported := packageHTTPCall(f.t, f.base, f.path+"/exports", "POST", f.auth, map[string]string{"idempotencyKey": "share-complete-brain"})
	if status != 202 {
		f.t.Fatal(status, exported)
	}
	waitWorkOperation(f.t, f.ctx, f.a, exported["operationId"].(string))
	request, err := http.NewRequestWithContext(f.ctx, "GET", f.base+"/api/v1/work-snapshots/"+exported["snapshotId"].(string)+"/content", nil)
	if err != nil {
		f.t.Fatal(err)
	}
	request.Header.Set("Authorization", f.auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		f.t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		f.t.Fatal("snapshot content", response.StatusCode)
	}
	file, err := os.CreateTemp(f.t.TempDir(), "brain-*.work")
	if err != nil {
		f.t.Fatal(err)
	}
	defer file.Close()
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, hash), response.Body)
	if err != nil {
		f.t.Fatal(err)
	}
	response.Body.Close()
	if _, err := file.Seek(0, 0); err != nil {
		f.t.Fatal(err)
	}
	request, err = http.NewRequestWithContext(f.ctx, "POST", f.base+"/api/v1/work-packages", file)
	if err != nil {
		f.t.Fatal(err)
	}
	request.ContentLength = size
	request.Header.Set("Authorization", f.auth)
	request.Header.Set("Content-Type", snapshotMIME)
	request.Header.Set("X-Piwork-SHA256", hex.EncodeToString(hash.Sum(nil)))
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		f.t.Fatal(err)
	}
	var uploaded map[string]any
	if err := json.NewDecoder(response.Body).Decode(&uploaded); err != nil {
		f.t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 201 && response.StatusCode != 200 {
		f.t.Fatal("upload current history", response.StatusCode, uploaded)
	}
	seen := map[string]bool{f.work: true}
	for _, key := range []string{"copy-one", "copy-two"} {
		status, accepted := packageHTTPCall(f.t, f.base, "/api/v1/work-imports", "POST", f.auth, map[string]string{"packageId": uploaded["packageId"].(string), "name": "Brain " + key, "idempotencyKey": key})
		if status != 202 {
			f.t.Fatal(status, accepted)
		}
		waitWorkOperation(f.t, f.ctx, f.a, accepted["operationId"].(string))
		work := accepted["workId"].(string)
		if seen[work] {
			f.t.Fatal("import reused Work identity")
		}
		seen[work] = true
		target := brainAcceptance{t: f.t, a: f.a, base: f.base, auth: f.auth, work: work, path: "/api/v1/works/" + work, ctx: f.ctx}
		state := target.read(target.path)
		if state["desiredState"] != "stopped" {
			f.t.Fatal("import started itself", state)
		}
		target.control("start", key+"-start")
		for _, r := range target.requests() {
			if r.(map[string]any)["disposition"] != "historical" {
				f.t.Fatal("source feedback replayed after import", r)
			}
		}
		target.servicePost("/ui/feedback", `{"reason":"review_missing","goal":"The personal review omits completed Todos. Verify this independent copied workstation."}`)
		fresh := target.request("independent copied workstation", "completed")
		if fresh["request"].(map[string]any)["disposition"] != "live" {
			f.t.Fatal(fresh)
		}
		target.chat("prepare workstation brain candidate "+key, key+"-candidate")
		target.request("prepare workstation brain candidate "+key, "waiting_apply")
		target.apply(key + "-apply")
		proof := target.request("prepare workstation brain candidate "+key, "completed")
		if proof["request"].(map[string]any)["disposition"] != "live" {
			f.t.Fatal("imported historical proof substituted new proof", proof)
		}
		sdk := false
		for _, e := range proof["evidence"].(map[string]any)["items"].([]any) {
			v := e.(map[string]any)
			sdk = sdk || v["kind"] == "sdk" && v["verified"] == true
		}
		if !sdk {
			f.t.Fatal("copy lacks its own actual SDK proof", proof)
		}
		target.control("stop", key+"-stop")
		status, reexported := packageHTTPCall(f.t, f.base, target.path+"/exports", "POST", f.auth, map[string]string{"idempotencyKey": key + "-reexport"})
		if status != 202 {
			f.t.Fatal("recipient reexport", status, reexported)
		}
		waitWorkOperation(f.t, f.ctx, f.a, reexported["operationId"].(string))
	}
	f.control("start", "share-source-start")
	f.t.Log("Full schema-5/Memory-1 .work produced two independently identified Work copies; old feedback stayed historical and each copy produced its own new feedback, candidate Apply and actual SDK proof")
}

// Crash after the actual business Action was durably accepted, before the SDK
// registers a wait. Recovery must query that original effect rather than replay it.
func TestNativeBrainAcceptedActionGapRecovery(t *testing.T) {
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 9*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	f.chat("deploy deterministic workstation", "recovery-deploy")
	for index, mode := range []string{"terminal", "running", "unprovable"} {
		f.chat("configure workstation recovery "+mode, "recovery-config-"+mode)
		goal := "Export the personal review. Interrupt before registering wait: " + mode
		f.servicePost("/ui/feedback", stringMustJSON(map[string]string{"reason": "export_review", "goal": goal}))
		var request map[string]any
		var original map[string]any
		deadline := time.Now().Add(time.Minute)
		for time.Now().Before(deadline) {
			for _, item := range f.requests() {
				r := item.(map[string]any)
				if r["goal"] != goal {
					continue
				}
				request = f.read(f.path + "/agent-requests/" + r["requestId"].(string))["request"].(map[string]any)
				program := "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/var/data/work.sqlite',{readOnly:true});const row=db.prepare('SELECT action_refs_json FROM agent_requests WHERE request_id=?').get(" + stringMustJSON(r["requestId"]) + ");console.log(row.action_refs_json);db.close();"
				raw := f.agentEval(program)
				var refs []map[string]any
				if json.Unmarshal([]byte(strings.TrimSpace(raw)), &refs) == nil && len(refs) == 1 && refs[0]["status"] == "known" {
					original = refs[0]
				}
			}
			if original != nil {
				break
			}
			time.Sleep(100 * time.Millisecond)
		}
		if original == nil || request["state"] != "running" || request["waitRef"] != nil {
			t.Fatal("missed accepted Action gap", mode, request, original)
		}
		count := request["autoRunCount"]
		view, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"})
		if err != nil || view == nil {
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
		_, err = raw.ContainerKill(ctx, view.ID, client.ContainerKillOptions{Signal: "SIGKILL"})
		raw.Close()
		if err != nil {
			t.Fatal(err)
		}
		recovered := false
		for deadline := time.Now().Add(45 * time.Second); time.Now().Before(deadline); time.Sleep(200 * time.Millisecond) {
			var state string
			var retries int
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				return tx.QueryRowContext(ctx, "SELECT state,retry_count FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1", work).Scan(&state, &retries)
			}); err != nil {
				t.Fatal(err)
			}
			if state == "ready" && retries >= index+1 {
				status, _ := packageHTTPCall(t, base, f.path+"/agent-requests", "GET", auth, nil)
				if status == 200 {
					recovered = true
					break
				}
			}
		}
		if !recovered {
			t.Fatal("Go runtime did not recover owned Agent", mode)
		}
		expected := "completed"
		if mode == "unprovable" {
			expected = "needs_attention"
		}
		done := f.request(mode, expected)["request"].(map[string]any)
		if expected == "needs_attention" && done["autoRunCount"] != count {
			t.Fatal("readonly failure consumed another model Run", done)
		}
		program := "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync('/var/data/workspace/data/workstation/workstation.sqlite',{readOnly:true});console.log(JSON.stringify(db.prepare('SELECT action_id,id AS job_id FROM ws_jobs').all()));db.close();"
		jobs := f.agentEval(program)
		if strings.Count(jobs, stringMustJSON(original["actionId"])) != 1 || strings.Count(jobs, stringMustJSON(original["jobId"])) != 1 {
			t.Fatal("original business effect replayed or lost", mode, jobs, original)
		}
		t.Log("actual Agent interruption recovered original Action", mode, expected)
	}
}

func stringMustJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(raw)
}
