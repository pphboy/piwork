//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"piwork/internal/client"
	"piwork/internal/contracts"
	"piwork/internal/identity"
	"piwork/internal/sessionhistory"
	"strings"
	"testing"
	"time"
)

func TestNativeLargeSessionHistory(t *testing.T) {
	a, base, auth, work, ctx := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + work
	status, created := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "large-history"})
	if status != 201 {
		t.Fatal(status, created)
	}
	session := created["sessionId"].(string)
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: path, ctx: ctx, session: session}
	program := `import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {populateLongHistory} from '/workspace/apps/agentd/dist/history-fixture.js';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';const work=` + stringMustJSON(work) + `,session=` + stringMustJSON(session) + `;const store=WorkStore.open('/var/data/work.sqlite');const sessions=new AgentSessionService(work,store,'/var/data/workspace','/var/data/sessions');const sdk=sessions.continue(session);const run=store.acceptRun({workId:work,sessionId:session,submissionKey:'synthetic-large',requestDigest:'fixture',promptDigest:'fixture'}).run;const value=populateLongHistory(sdk,run.runId,7*1024*1024);store.appendEvent(run.runId,'text',JSON.stringify({delta:value.finalText}));store.completeRun(run.runId,'succeeded',value.finalText,null);for(let i=0;i<1005;i++){const r=store.acceptRun({workId:work,sessionId:session,submissionKey:'synthetic-extra-'+i,requestDigest:'fixture',promptDigest:'fixture'}).run;store.completeRun(r.runId,'succeeded','saved '+i,null);}console.log(JSON.stringify({run:run.runId,hash:createHash('sha256').update(readFileSync(store.getSession(work,session).sdkHistoryPath)).digest('hex')}));store.close();`
	var seeded struct{ Run, Hash string }
	if raw := f.agentEval(program); json.Unmarshal([]byte(raw), &seeded) != nil || seeded.Run == "" {
		t.Fatal("seed", raw)
	}

	for _, role := range []string{"user", "admin"} {
		account := "history-" + role
		if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), account, "synthetic-history-pass", role); err != nil {
			t.Fatal(err)
		}
		login, err := a.Identity.Login(ctx, account, "synthetic-history-pass", "history-denial")
		if err != nil {
			t.Fatal(err)
		}
		expected := 404
		if role == "admin" {
			expected = 403
		}
		for _, resource := range []string{"history-capabilities", "sessions/" + session + "/history", "sessions/" + session + "/history?content=result&runId=" + seeded.Run} {
			modelNativeCall(t, base, "Bearer "+login.Token, path+"/"+resource, "GET", nil, expected)
		}
	}
	api, err := client.New(base, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	if ok, err := api.HasHistory(ctx, work); err != nil || !ok {
		t.Fatal(ok, err)
	}

	// Append through the real persistent store while a captured Run is running.
	appendSession := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "history-append"}, 201)["sessionId"].(string)
	appendProgram := `import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {appendAssistantMessage} from '/workspace/packages/pi-adapter/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const session=` + stringMustJSON(appendSession) + `;const run=s.acceptRun({workId:` + stringMustJSON(work) + `,sessionId:session,submissionKey:'appending',requestDigest:'x',promptDigest:'x'}).run;s.markRunRunning(run.runId);const sdk=new AgentSessionService(` + stringMustJSON(work) + `,s,'/var/data/workspace','/var/data/sessions').continue(session);sdk.appendCustomEntry('piwork-run',{runId:run.runId});appendAssistantMessage(sdk,'first');appendAssistantMessage(sdk,'second');console.log(JSON.stringify({run:run.runId}));s.close();`
	var appending struct{ Run string }
	if json.Unmarshal([]byte(f.agentEval(appendProgram)), &appending) != nil {
		t.Fatal("appending fixture")
	}
	captured, err := api.HistoryPage(ctx, work, appendSession, contracts.HistoryQuery{Direction: contracts.Supplied("newer"), Limit: contracts.Supplied(int64(1))})
	if err != nil {
		t.Fatal(err)
	}
	cursor, _ := sessionhistory.Next(captured)
	f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {appendAssistantMessage} from '/workspace/packages/pi-adapter/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite');const sdk=new AgentSessionService(` + stringMustJSON(work) + `,s,'/var/data/workspace','/var/data/sessions').continue(` + stringMustJSON(appendSession) + `);appendAssistantMessage(sdk,'third');s.completeRun(` + stringMustJSON(appending.Run) + `,'succeeded','third',null);s.close();`)
	frozen, err := api.HistoryPage(ctx, work, appendSession, contracts.HistoryQuery{Direction: contracts.Supplied("newer"), Cursor: contracts.Supplied(cursor)})
	if err != nil || len(frozen.Segments) != 1 || frozen.Segments[0].Text != "second" || frozen.HasMore {
		t.Fatal("append changed captured range", err)
	}
	fresh, err := api.HistoryPage(ctx, work, appendSession, contracts.HistoryQuery{Direction: contracts.Supplied("newer")})
	if err != nil || len(fresh.Segments) != 3 || fresh.Segments[2].Text != "third" {
		t.Fatal("fresh range missed append", err)
	}
	q := contracts.HistoryQuery{Direction: contracts.Supplied("newer")}
	entries := map[string]bool{}
	pages, maxBytes := 0, 0
	for {
		page, err := api.HistoryPage(ctx, work, session, q)
		if err != nil {
			t.Fatal(err)
		}
		if !q.Snapshot.Present {
			q.Snapshot = contracts.Supplied(page.SnapshotId)
		}
		for _, part := range page.Segments {
			entries[string(part.EntryId)] = true
		}
		raw, _ := json.Marshal(page)
		maxBytes = max(maxBytes, len(raw)+1)
		pages++
		next, err := sessionhistory.Next(page)
		if err != nil {
			t.Fatal(err)
		}
		if next == "" {
			break
		}
		q.Cursor = contracts.Supplied(next)
	}
	if len(entries) != 1459 {
		t.Fatal("missing messages/persisted result fallback", len(entries))
	}
	q.Cursor = contracts.Field[string]{}
	q.Content = contracts.Supplied("runs")
	runCount := 0
	for {
		page, err := api.HistoryPage(ctx, work, session, q)
		if err != nil {
			t.Fatal(err)
		}
		runCount += len(page.Runs)
		next, _ := sessionhistory.Next(page)
		if next == "" {
			break
		}
		q.Cursor = contracts.Supplied(next)
	}
	if runCount != 1006 {
		t.Fatal("fixed window truncated metadata", runCount)
	}
	var run json.RawMessage
	if err = api.Request(ctx, "GET", client.HistoryResponsePath(path+"/runs/"+seeded.Run), nil, &run); err != nil {
		t.Fatal(err)
	}
	if len(run) > 4096 || strings.Contains(string(run), "finalText") {
		t.Fatal("unbounded Run metadata")
	}
	complete, err := api.CompleteHistoryRun(ctx, run)
	if err != nil {
		t.Fatal(err)
	}
	var result struct{ FinalText string }
	if json.Unmarshal(complete, &result) != nil || len(result.FinalText) != 7*1024*1024 {
		t.Fatal("large result lost", err)
	}
	events, textBytes := 0, 0
	err = api.StreamHistory(ctx, path+"/runs/"+seeded.Run+"/events?after=0", func(raw json.RawMessage) error {
		events++
		var event struct {
			Kind struct{ Text struct{ Delta string } }
		}
		json.Unmarshal(raw, &event)
		textBytes += len(event.Kind.Text.Delta)
		return nil
	})
	if err != nil || textBytes != 7*1024*1024 {
		t.Fatal("large watch", err, events, textBytes)
	}
	expired := q
	expired.Cursor = contracts.Supplied("unknown")
	if _, err = api.HistoryPage(ctx, work, session, expired); err == nil {
		t.Fatal("unknown cursor accepted")
	}

	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: base, Token: api.Token, ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "fixture", Account: "admin", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
	binary, err := filepath.Abs("../../dist/go/piwork-cli")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.CommandContext(ctx, binary, "--core", base, "--json", "session", "show", work, session)
	command.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credential, "PATH=/nonexistent")
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err = command.Run(); err != nil {
		t.Fatal("native CLI", err, stderr.String())
	}
	var output struct {
		Messages []json.RawMessage
		Runs     []json.RawMessage
	}
	if json.Unmarshal(stdout.Bytes(), &output) != nil || len(output.Messages) != 1459 || len(output.Runs) != 1006 {
		t.Fatal("CLI truncated complete history", len(output.Messages), len(output.Runs))
	}

	imageSession := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "history-image"}, 201)["sessionId"].(string)
	imageBytes, err := os.ReadFile("../../fixtures/chat-images/png.png")
	if err != nil {
		t.Fatal(err)
	}
	f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {AgentSessionService} from '/workspace/apps/agentd/dist/sessions.js';import {appendAssistantMessage} from '/workspace/packages/pi-adapter/dist/index.js';import {chatInputDigest} from '/workspace/packages/contracts/dist/index.js';const s=WorkStore.open('/var/data/work.sqlite'),work=` + stringMustJSON(work) + `,session=` + stringMustJSON(imageSession) + `;const input={profile:'chat-images-v1',prompt:'look',images:[{mimeType:'image/png',data:` + stringMustJSON(base64.StdEncoding.EncodeToString(imageBytes)) + `}]};const run=s.acceptRun({workId:work,sessionId:session,submissionKey:'image',requestDigest:'fixture',promptDigest:chatInputDigest(input.prompt,input.images),privateInputJson:JSON.stringify(input)}).run;const sdk=new AgentSessionService(work,s,'/var/data/workspace','/var/data/sessions').continue(session);sdk.appendCustomEntry('piwork-run',{runId:run.runId});sdk.appendMessage({role:'user',content:[{type:'text',text:input.prompt},...input.images.map(image=>({type:'image',...image}))],timestamp:Date.now()});appendAssistantMessage(sdk,'Image history saved');s.completeRun(run.runId,'succeeded','Image history saved',null);s.releasePrivateInput(run.runId);s.close();`)
	imageCommand := exec.CommandContext(ctx, binary, "--core", base, "--json", "session", "show", work, imageSession)
	imageCommand.Env = command.Env
	var imageStdout, imageStderr bytes.Buffer
	imageCommand.Stdout, imageCommand.Stderr = &imageStdout, &imageStderr
	if err = imageCommand.Run(); err != nil {
		t.Fatal("native CLI image history", err, imageStderr.String())
	}
	var imageOutput struct {
		Messages []struct {
			Blocks []struct {
				Type  string
				Image struct {
					ImageIndex, ByteSize int
					SHA256               string
				}
			}
		}
	}
	if err = json.Unmarshal(imageStdout.Bytes(), &imageOutput); err != nil {
		t.Fatal(err)
	}
	imageHash := sha256.Sum256(imageBytes)
	images := 0
	for _, message := range imageOutput.Messages {
		for _, block := range message.Blocks {
			if block.Type == "image" {
				images++
				if block.Image.ImageIndex != 0 || block.Image.ByteSize != len(imageBytes) || block.Image.SHA256 != hex.EncodeToString(imageHash[:]) {
					t.Fatal("changed native image descriptor", block)
				}
			}
		}
	}
	if images != 1 || bytes.Contains(imageStdout.Bytes(), []byte(`"data"`)) {
		t.Fatal("native CLI lost image descriptors or exposed bytes", images)
	}
	t.Log("native CLI preserved SDK image descriptors after private input release")

	// Restart explicitly through the existing lifecycle; old snapshot handles expire.
	stop := modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "history-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	modelNativeCall(t, base, auth, path+"/sessions/"+session+"/history", "GET", nil, 503)
	start := modelNativeCall(t, base, auth, path+"/start", "POST", map[string]string{"idempotencyKey": "history-start"}, 202)
	waitWorkOperation(t, ctx, a, start["operationId"].(string))
	stale := path + "/sessions/" + session + "/history?snapshot=" + url.QueryEscape(q.Snapshot.Value)
	modelNativeCall(t, base, auth, stale, "GET", nil, 410)
	preserved := f.agentEval(`import {WorkStore} from '/workspace/packages/work-store/dist/index.js';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';const s=WorkStore.open('/var/data/work.sqlite');console.log(createHash('sha256').update(readFileSync(s.getSession(` + stringMustJSON(work) + `,` + stringMustJSON(session) + `).sdkHistoryPath)).digest('hex'));s.close();`)
	if strings.TrimSpace(preserved) != seeded.Hash {
		t.Fatal("readonly history changed SDK source")
	}

	// Export/import retains the original data while the recipient stays stopped.
	stop = modelNativeCall(t, base, auth, path+"/stop", "POST", map[string]string{"idempotencyKey": "history-export-stop"}, 202)
	waitWorkOperation(t, ctx, a, stop["operationId"].(string))
	archive, _ := modelNativeExport(t, ctx, a, base, auth, work, "history-export")
	file, err := os.Open(archive)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	info, _ := file.Stat()
	hash := sha256.New()
	io.Copy(hash, file)
	file.Seek(0, 0)
	request, _ := http.NewRequestWithContext(ctx, "POST", base+"/api/v1/work-packages", file)
	request.ContentLength = info.Size()
	request.Header.Set("Authorization", auth)
	request.Header.Set("Content-Type", snapshotMIME)
	request.Header.Set("X-Piwork-SHA256", hex.EncodeToString(hash.Sum(nil)))
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var uploaded map[string]any
	json.NewDecoder(response.Body).Decode(&uploaded)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal("history archive upload", response.StatusCode, uploaded)
	}
	imported := modelNativeCall(t, base, auth, "/api/v1/work-imports", "POST", map[string]any{"packageId": uploaded["packageId"], "name": "Imported large history", "idempotencyKey": "history-import"}, 202)
	waitWorkOperation(t, ctx, a, imported["operationId"].(string))
	target := imported["workId"].(string)
	record, err := a.Store.Work(ctx, target, false)
	if err != nil || record.DesiredState != "stopped" {
		t.Fatal("import implicitly started", err)
	}
	// Restart the actual Core, keeping its store and all durable Work intent.
	directory := a.options.DataDirectory
	options := a.options
	options.Initialization = Initialization{}
	options.DataDirectory = directory
	// The receipt precedes asynchronous helper cleanup. This restart scenario
	// begins after accepted jobs have finished their bookkeeping as well.
	settled := make(chan struct{})
	go func() { a.snapshotWG.Wait(); close(settled) }()
	select {
	case <-settled:
	case <-ctx.Done():
		t.Fatal("accepted fixture jobs did not settle", ctx.Err())
	}
	t.Log("snapshot helper bookkeeping completed")
	api.HTTP.CloseIdleConnections()
	if err = a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	t.Log("Core shutdown confirmed")
	b, newBase, _ := appFixture(t, options)
	restartCtx, restartCancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer restartCancel()
	for !b.Status().Ready {
		if restartCtx.Err() != nil {
			t.Fatal(b.Status(), b.Preparation())
		}
		time.Sleep(100 * time.Millisecond)
	}
	record, err = b.Store.Work(restartCtx, target, false)
	if err != nil || record.DesiredState != "stopped" {
		t.Fatal("Core restart started imported Work", err)
	}
	login, err := b.Identity.Login(restartCtx, "admin", "development-fixture-pass", "history-restart")
	if err != nil {
		t.Fatal(err)
	}
	newAuth := "Bearer " + login.Token
	targetPath := "/api/v1/works/" + target
	modelNativeCall(t, newBase, newAuth, targetPath+"/sessions/"+session+"/history", "GET", nil, 503)
	started := modelNativeCall(t, newBase, newAuth, targetPath+"/start", "POST", map[string]string{"idempotencyKey": "history-import-start"}, 202)
	waitWorkOperation(t, restartCtx, b, started["operationId"].(string))
	recipient, _ := client.New(newBase, login.Token)
	ref := contracts.HistoryResultRef{WorkId: contracts.Identifier(target), SessionId: contracts.Identifier(session), RunId: contracts.Identifier(seeded.Run), Content: "result"}
	answer, err := recipient.HistoryResult(restartCtx, ref)
	if err != nil || len(answer) != 7*1024*1024 {
		t.Fatal("imported large result", err, len(answer))
	}
	t.Log("stopped export/import and actual Core restart preserved the complete result without an implicit Start")
	t.Logf("real Core/mTLS Agent: %d messages, %d runs, %d pages, max JSON %d; 7 MiB result/watch; restart 410; original source unchanged", len(entries), runCount, pages, maxBytes)
}
