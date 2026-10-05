//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/testsupport"
)

func TestGoCoreHTTPToRealTSAgentConversation(t *testing.T) {
	imageRef := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if imageRef == "" {
		t.Skip("set PIWORK_TEST_NATIVE_AGENT_IMAGE to a built acceptance image")
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
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
	defer raw.Close()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	dataDir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	initial, err := corestore.Open(ctx, corestore.Options{Directory: dataDir, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}
	a, base, _ := appFixture(t, Options{AgentGRPCListen: "0.0.0.0:0", DataDirectory: dataDir, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"},
		Runtime:       &RuntimeInput{AgentImage: imageRef, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"},
	}})
	if a.Status().State != "READY" || a.workRuntime == nil {
		t.Fatal("Go Core runtime did not initialize", a.Status())
	}
	image, err := a.engine.InspectImage(ctx, imageRef)
	if err != nil {
		t.Fatal(err)
	}
	profile, configured, err := a.Settings.LoadRuntime()
	if err != nil || !configured {
		t.Fatal("captured runtime profile unavailable", err)
	}
	profileJSON, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	profileText := string(profileJSON)
	revision := int64(1)
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	workID, contextID, instanceID := "work-http-agent-1", "context-http-agent-1", "agent-http-1"
	contextDir := filepath.Join(dataDir, "works", workID, "contexts", contextID)
	for _, path := range []string{contextDir, filepath.Join(contextDir, "skills"), filepath.Join(contextDir, "packages")} {
		if err := os.MkdirAll(path, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	configuration := `{"agentImage":{"catalogId":"agent-image-0001"},"skills":[],"packages":[],"agentsMd":"","modelRef":"model-reference-1","mcpServers":[],"resources":{"cpuMillis":2000,"memoryBytes":1610612736,"agentCpuMillis":1000,"agentMemoryBytes":805306368,"maxServices":4,"maxRetainedVolumes":2},"tools":{"allowed":[],"denied":[]}}`
	configuration = strings.Replace(configuration, "model-reference-1", string(runtimeModelCatalogID(profile.Revision)), 1)
	metadata := `{"version":1,"snapshotId":"` + contextID + `","workId":"` + workID + `","imageIdentity":"` + image.ID + `","skills":[],"packageContractVersion":1,"packageBindings":[],"createdAt":"2026-09-30T00:00:00.000Z"}`
	for name, value := range map[string]string{"config.json": configuration, "metadata.json": metadata, "AGENTS.md": ""} {
		if err := os.WriteFile(filepath.Join(contextDir, name), []byte(value), 0644); err != nil {
			t.Fatal(err)
		}
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: workID, OwnerUserID: string(owner.Id), Name: "HTTP Agent", DesiredState: "running", ObservedState: "provisioning", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return err
		}
		if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: workID, Revision: 1, ConfigJSON: configuration, RuntimeProfileJSON: &profileText, CreatedByUserID: string(owner.Id), CreatedAt: now}); err != nil {
			return err
		}
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: contextID, WorkID: workID, InternalRevision: &revision, ConfigurationJSON: configuration, ImageIdentity: image.ID, CreatedByUserID: string(owner.Id), CreatedAt: now}); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE works SET desired_context_id=? WHERE id=?`, contextID, workID)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	started, err := a.startCapturedWork(ctx, workID, 1, instanceID)
	if err != nil {
		t.Fatal("Go Core could not start captured Work:", err)
	}
	defer started.Client.Close()
	login, err := a.Identity.Login(ctx, "owner", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	authorization := "Bearer " + login.Token
	path := "/api/v1/works/" + workID
	if actionStatus, accepted := httpCall(t, base, path+"/start", "POST", authorization, map[string]any{"idempotencyKey": "already-ready-start"}); actionStatus != 202 {
		t.Fatal("already-ready Start was not accepted", actionStatus, accepted)
	} else {
		waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	}
	status, session := httpCall(t, base, path+"/sessions", "POST", authorization, map[string]any{"idempotencyKey": "http-session-1"})
	if status != 201 || session["sessionId"] == nil {
		t.Fatal("Core Session HTTP route failed", status, session)
	}
	if status, capabilities := httpCall(t, base, path+"/chat-capabilities", "GET", authorization, nil); status != 200 || capabilities["contractVersion"] != float64(1) {
		t.Fatal("optional chat capabilities", status, capabilities)
	}
	if status, models := httpCall(t, base, path+"/chat-models", "GET", authorization, nil); status != 200 || models["defaultModel"].(map[string]any)["defaultThinkingLevel"] != "off" {
		t.Fatal("chat models", status, models)
	}
	if status, commands := httpCall(t, base, path+"/commands", "GET", authorization, nil); status != 200 || commands["commands"] == nil {
		t.Fatal("command catalog", status, commands)
	}
	if status, options := httpCall(t, base, path+"/sessions/"+session["sessionId"].(string)+"/chat-options", "PATCH", authorization, map[string]any{"modelRef": nil, "thinkingLevel": "off"}); status != 200 || options["thinkingLevel"] != "off" {
		t.Fatal("complete options", status, options)
	}
	if status, lookup := httpCall(t, base, path+"/sessions/submissions/http-session-1", "GET", authorization, nil); status != 200 || lookup["session"].(map[string]any)["sessionId"] != session["sessionId"] {
		t.Fatal("original Session key", status, lookup)
	}
	if status, lookup := httpCall(t, base, path+"/runs/submissions/not-yet-found", "GET", authorization, nil); status != 200 || lookup["status"] != "not-found" {
		t.Fatal("lookup created a Run", status, lookup)
	}
	if repeatedStatus, repeated := httpCall(t, base, path+"/sessions", "POST", authorization, map[string]any{"idempotencyKey": "http-session-1"}); repeatedStatus != 201 || repeated["sessionId"] != session["sessionId"] {
		t.Fatal("Session idempotency created a duplicate", repeatedStatus, repeated)
	}
	status, submitted := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-run-1", "prompt": "hello"})
	if status != 202 || submitted["run"] == nil {
		t.Fatal("Core Run HTTP route failed", status, submitted)
	}
	runID := submitted["run"].(map[string]any)["runId"].(string)
	request, _ := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events?after=0", nil)
	request.Header.Set("Authorization", authorization)
	response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "application/x-ndjson" {
		t.Fatal("Core Run stream unavailable", response.Status)
	}
	scanner := bufio.NewScanner(response.Body)
	var sawText, sawTerminal bool
	var firstSequence uint64
	for scanner.Scan() {
		var event map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		sequence, err := strconv.ParseUint(event["sequence"].(string), 10, 64)
		if err != nil || sequence == 0 {
			t.Fatal("invalid NDJSON sequence", event)
		}
		if firstSequence == 0 {
			firstSequence = sequence
		}
		kind, _ := event["kind"].(map[string]any)
		if kind["$case"] == "text" {
			sawText = true
		}
		if kind["$case"] == "state" {
			state, _ := kind["state"].(map[string]any)
			if state["state"] == float64(4) {
				sawTerminal = true
			}
		}
	}
	if err := scanner.Err(); err != nil || !sawText || !sawTerminal {
		t.Fatal("Core Run stream lost TS Agent events", err, sawText, sawTerminal)
	}
	resumeRequest, _ := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events?after="+strconv.FormatUint(firstSequence, 10), nil)
	resumeRequest.Header.Set("Authorization", authorization)
	resumeResponse, err := (&http.Client{Timeout: 5 * time.Second}).Do(resumeRequest)
	if err != nil || resumeResponse.StatusCode != 200 {
		t.Fatal("Run cursor resume failed", err)
	}
	defer resumeResponse.Body.Close()
	resumeScanner := bufio.NewScanner(resumeResponse.Body)
	var replayed int
	for resumeScanner.Scan() {
		var event map[string]any
		if err := json.Unmarshal(resumeScanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		sequence, err := strconv.ParseUint(event["sequence"].(string), 10, 64)
		if err != nil || sequence <= firstSequence {
			t.Fatal("cursor replayed an already observed event", event)
		}
		replayed++
	}
	if err := resumeScanner.Err(); err != nil || replayed == 0 {
		t.Fatal("Run cursor did not resume retained events", err, replayed)
	}
	status, completed := httpCall(t, base, path+"/runs/"+runID, "GET", authorization, nil)
	if status != 200 || completed["state"] != float64(4) || completed["finalText"] != "skill-read:none" {
		t.Fatal("Core Run projection disagrees with TS Agent", status, completed)
	}
	if repeatedStatus, repeated := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-run-1", "prompt": "hello"}); repeatedStatus != 202 || repeated["reused"] != true || repeated["run"].(map[string]any)["runId"] != runID {
		t.Fatal("Run idempotency re-executed prompt", repeatedStatus, repeated)
	}
	if conflictStatus, conflict := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-run-1", "prompt": "changed prompt"}); conflictStatus != 409 {
		t.Fatal("Run submission key accepted changed content", conflictStatus, conflict)
	}
	if cancelStatus, cancelled := httpCall(t, base, path+"/runs/"+runID+"/cancel", "POST", authorization, map[string]string{"idempotencyKey": "cancel-already-succeeded"}); cancelStatus != 200 || cancelled["state"] != float64(4) || cancelled["finalText"] != completed["finalText"] {
		t.Fatal("late cancellation changed successful Run", cancelStatus, cancelled)
	}
	status, waiting := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-run-wait", "prompt": "wait for abort"})
	if status != 202 || waiting["run"] == nil {
		t.Fatal("deterministic cancellable Run was not accepted", status, waiting)
	}
	waitID := waiting["run"].(map[string]any)["runId"].(string)
	if secondStatus, second := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-run-while-busy", "prompt": "hello"}); secondStatus != 429 || second["code"] != "RATE_LIMITED" {
		t.Fatal("second active Run was accepted", secondStatus, second)
	}
	if cancelStatus, cancelResult := httpCall(t, base, path+"/runs/"+waitID+"/cancel", "POST", authorization, map[string]any{"idempotencyKey": "http-cancel-wait"}); cancelStatus != 200 || cancelResult["runId"] != waitID {
		t.Fatal("explicit Run cancel failed", cancelStatus, cancelResult)
	}
	for {
		currentStatus, current := httpCall(t, base, path+"/runs/"+waitID, "GET", authorization, nil)
		if currentStatus != 200 {
			t.Fatal("cancelled Run became unreadable", currentStatus, current)
		}
		if current["state"] == float64(6) {
			break
		}
		if err := ctx.Err(); err != nil {
			t.Fatal("cancelled Run never terminated", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	continuedStatus, continued := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-run-continued", "prompt": "hello again"})
	if continuedStatus != 202 || continued["run"] == nil {
		t.Fatal("persisted Session could not continue after cancelled Run", continuedStatus, continued)
	}
	continuedID := continued["run"].(map[string]any)["runId"].(string)
	for {
		currentStatus, current := httpCall(t, base, path+"/runs/"+continuedID, "GET", authorization, nil)
		if currentStatus != 200 {
			t.Fatal("continued Run became unreadable", currentStatus, current)
		}
		if current["state"] == float64(4) {
			break
		}
		if err := ctx.Err(); err != nil {
			t.Fatal("continued Session Run did not complete", err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if status, list := httpCall(t, base, path+"/sessions", "GET", authorization, nil); status != 200 || len(list["sessions"].([]any)) != 1 {
		t.Fatal("Core Session list did not use TS history", status, list)
	}
	if status, history := httpCall(t, base, path+"/sessions/"+session["sessionId"].(string), "GET", authorization, nil); status != 200 || history["session"] == nil || len(history["messages"].([]any)) < 2 {
		t.Fatal("Core Session history unavailable", status, history)
	}
	if got := strings.TrimSpace(completed["finalText"].(string)); got != "skill-read:none" {
		t.Fatal(got)
	}
	watcher, err := a.Identity.Login(ctx, "owner", "development-fixture-pass", "second-browser")
	if err != nil {
		t.Fatal(err)
	}
	waitStatus, waitRun := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-observer-wait", "prompt": "wait for abort"})
	if waitStatus != 202 {
		t.Fatal("observer fixture Run was not accepted", waitStatus, waitRun)
	}
	observerRunID := waitRun["run"].(map[string]any)["runId"].(string)
	watchCtx, stopObserver := context.WithTimeout(ctx, 5*time.Second)
	defer stopObserver()
	watchRequest, _ := http.NewRequestWithContext(watchCtx, "GET", base+path+"/runs/"+observerRunID+"/events?after=0", nil)
	watchRequest.Header.Set("Authorization", "Bearer "+watcher.Token)
	watchResponse, err := (&http.Client{}).Do(watchRequest)
	if err != nil || watchResponse.StatusCode != 200 {
		t.Fatal("second observer could not watch Run", err)
	}
	watchScanner := bufio.NewScanner(watchResponse.Body)
	if !watchScanner.Scan() {
		t.Fatal("second observer received no initial event", watchScanner.Err())
	}
	primaryRequest, _ := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+observerRunID+"/events?after=0", nil)
	primaryRequest.Header.Set("Authorization", authorization)
	primaryResponse, err := (&http.Client{}).Do(primaryRequest)
	if err != nil || primaryResponse.StatusCode != 200 {
		t.Fatal("primary observer could not watch same Run", err)
	}
	defer primaryResponse.Body.Close()
	primaryScanner := bufio.NewScanner(primaryResponse.Body)
	if !primaryScanner.Scan() {
		t.Fatal("primary observer received no initial event", primaryScanner.Err())
	}
	if err := a.Identity.Logout(ctx, watcher.Token); err != nil {
		t.Fatal(err)
	}
	observerDone := make(chan struct{})
	go func() {
		for watchScanner.Scan() {
		}
		close(observerDone)
	}()
	select {
	case <-observerDone:
	case <-time.After(3 * time.Second):
		t.Fatal("revoked observer stream remained open")
	}
	watchResponse.Body.Close()
	currentStatus, current := httpCall(t, base, path+"/runs/"+observerRunID, "GET", authorization, nil)
	if currentStatus != 200 || current["state"] == float64(6) || current["state"] == float64(7) {
		t.Fatal("observer logout cancelled accepted Run", currentStatus, current)
	}
	if cancelStatus, _ := httpCall(t, base, path+"/runs/"+observerRunID+"/cancel", "POST", authorization, map[string]any{"idempotencyKey": "cancel-observer-fixture"}); cancelStatus != 200 {
		t.Fatal("observer fixture cleanup Run cancel failed", cancelStatus)
	}
	var primaryTerminal bool
	for primaryScanner.Scan() {
		var event map[string]any
		if err := json.Unmarshal(primaryScanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		kind, _ := event["kind"].(map[string]any)
		if kind["$case"] == "state" {
			state, _ := kind["state"].(map[string]any)
			if state["state"] == float64(6) {
				primaryTerminal = true
			}
		}
	}
	if err := primaryScanner.Err(); err != nil || !primaryTerminal {
		t.Fatal("surviving observer lost Run terminal event", err, primaryTerminal)
	}
	revokeStatus, revokeRun := httpCall(t, base, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "http-revoke-wait", "prompt": "wait for abort"})
	if revokeStatus != 202 {
		t.Fatal("route revocation fixture Run was not accepted", revokeStatus, revokeRun)
	}
	revokeRunID := revokeRun["run"].(map[string]any)["runId"].(string)
	revokeRequest, _ := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+revokeRunID+"/events?after=0", nil)
	revokeRequest.Header.Set("Authorization", authorization)
	revokeResponse, err := (&http.Client{}).Do(revokeRequest)
	if err != nil || revokeResponse.StatusCode != 200 {
		t.Fatal("route revocation observer could not start", err)
	}
	defer revokeResponse.Body.Close()
	revokeScanner := bufio.NewScanner(revokeResponse.Body)
	if !revokeScanner.Scan() {
		t.Fatal("route revocation observer received no event", revokeScanner.Err())
	}
	if a.agentRoutes.Revoke(workID) != started.Client {
		t.Fatal("route revocation did not close current generation")
	}
	revokeDone := make(chan struct{})
	go func() {
		for revokeScanner.Scan() {
		}
		close(revokeDone)
	}()
	select {
	case <-revokeDone:
	case <-time.After(3 * time.Second):
		t.Fatal("revoked Work route left observation open")
	}
	revokeResponse.Body.Close()
	stillRunning, err := started.Client.GetRun(ctx, revokeRunID)
	if err != nil || stillRunning.GetState() == 6 || stillRunning.GetState() == 7 {
		t.Fatal("route revocation cancelled TS Agent Run", err, stillRunning)
	}
	if _, err := started.Client.CancelRun(ctx, revokeRunID, "cleanup-revoked-observer"); err != nil {
		t.Fatal("explicit cleanup cancel after route revocation:", err)
	}
	if err := a.stopCapturedWork(ctx, workID, 3*time.Second, 10*time.Second); err != nil {
		t.Fatal("confirmed Work stop failed:", err)
	}
	stopped, err := a.Store.Work(ctx, workID, false)
	if err != nil || stopped.ObservedState != "stopped" || stopped.DesiredState != "running" || stopped.ActiveContextID == nil || *stopped.ActiveContextID != contextID {
		t.Fatal("Work stop lost its captured context or desired state", err, stopped)
	}
	if status, body := httpCall(t, base, path+"/runs/"+runID, "GET", authorization, nil); status != 503 || body["code"] != "WORK_UNAVAILABLE" {
		t.Fatal("stopped Work still admitted conversation", status, body)
	}
	ownerSession, err := a.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	actor := ownerSession.Principal()
	acceptedStop, err := a.acceptWorkAction(ctx, actor, workID, "stop", "http-stop-once")
	if err != nil || acceptedStop.Reused {
		t.Fatal("durable Work stop was not accepted", err, acceptedStop)
	}
	if replay, err := a.acceptWorkAction(ctx, actor, workID, "stop", "http-stop-once"); err != nil || !replay.Reused || replay.OperationID != acceptedStop.OperationID {
		t.Fatal("Work stop idempotency created a duplicate", err, replay)
	}
	waitWorkOperation(t, ctx, a, acceptedStop.OperationID)
	acceptedStart, err := a.acceptWorkAction(ctx, actor, workID, "start", "http-start-once")
	if err != nil {
		t.Fatal("durable Work start was not accepted", err)
	}
	waitWorkOperation(t, ctx, a, acceptedStart.OperationID)
	if status, list := httpCall(t, base, path+"/sessions", "GET", authorization, nil); status != 200 || len(list["sessions"].([]any)) != 1 {
		t.Fatal("stopped and resumed Work lost TS Agent Session", status, list)
	}
	if err := a.Close(ctx); err != nil {
		t.Fatal("Go Core did not confirm managed Work shutdown", err)
	}
	configurationStore, err := corestore.Open(ctx, corestore.Options{Directory: dataDir})
	if err != nil {
		t.Fatal(err)
	}
	configurationFiles, err := configurationStore.OpenPlatformFiles()
	if err != nil {
		configurationStore.Close()
		t.Fatal(err)
	}
	_, configurationErr := NewSettings(configurationStore, configurationFiles).ConfigureRuntime(RuntimeInput{AgentImage: imageRef, Provider: "piwork-deterministic", Model: "different-default-model", Credential: "different-default-credential"})
	configurationFiles.Close()
	closingErr := configurationStore.Close()
	if configurationErr != nil || closingErr != nil {
		t.Fatal("could not update offline defaults", configurationErr, closingErr)
	}
	b, nextBase, _ := appFixture(t, Options{AgentGRPCListen: "0.0.0.0:0", DataDirectory: dataDir, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}})
	if b.Status().State != "READY" {
		t.Fatal("Go Core did not recover desired-running Work", b.Status())
	}
	if status, list := httpCall(t, nextBase, path+"/sessions", "GET", authorization, nil); status != 200 || len(list["sessions"].([]any)) != 1 {
		t.Fatal("Core restart lost retained TS Agent Session", status, list)
	}
	status, restored := httpCall(t, nextBase, path+"/runs", "POST", authorization, map[string]any{"sessionId": session["sessionId"], "submissionKey": "after-core-restart", "prompt": "hello"})
	if status != 202 {
		t.Fatal("restored Session could not continue", status, restored)
	}
	restoredID := restored["run"].(map[string]any)["runId"].(string)
	for {
		status, run := httpCall(t, nextBase, path+"/runs/"+restoredID, "GET", authorization, nil)
		if status != 200 || run["state"] == float64(5) {
			t.Fatal("restored Run followed changed defaults", status, run)
		}
		if run["state"] == float64(4) {
			if run["finalText"] != "skill-read:none" {
				t.Fatal("restored Run changed captured context", run)
			}
			break
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Logf("Go Core HTTP→TS Agent completed Work %s Run %s", workID, runID)
}

func waitWorkOperation(t *testing.T, ctx context.Context, a *Application, id string) {
	t.Helper()
	for {
		operation, err := a.Store.Operation(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if operation.State == "succeeded" {
			return
		}
		if operation.State == "failed" || operation.State == "superseded" || ctx.Err() != nil {
			var diagnostic string
			if operation.ErrorJSON != nil {
				diagnostic = *operation.ErrorJSON
			}
			t.Fatal("Work Operation did not reach requested state", operation.State, diagnostic, ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
}
