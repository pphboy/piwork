//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeWorkApplyCapturesBusyAndStoppedBoundaries(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	save := func(text string) {
		t.Helper()
		if status, view := packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]any{"agentsMd": text}); status != 200 || view["pendingApply"] != true {
			t.Fatal(status, view)
		}
	}
	apply := func(key string) string {
		t.Helper()
		status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		return accepted["operationId"].(string)
	}
	view := func() map[string]any {
		t.Helper()
		status, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
		if status != 200 {
			t.Fatal(status, view)
		}
		return view
	}
	save("# Captured B")
	value, _ := a.workLocks.LoadOrStore(id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	first := apply("apply-B")
	save("# Later C")
	lock.Unlock()
	waitWorkOperation(t, ctx, a, first)
	status, publicOperation := packageHTTPCall(t, base, "/api/v1/operations/"+first, "GET", auth, nil)
	encoded, _ := json.Marshal(publicOperation)
	if status != 200 {
		t.Fatal(status, publicOperation)
	}
	if _, err := contracts.Decode[contracts.PublicOperation](strings.NewReader(string(encoded)), "PublicOperationSchema", 2<<20); err != nil {
		t.Fatal("successful Apply public contract", err, string(encoded))
	}
	if publicOperation["result"].(map[string]any)["configuration"].(map[string]any)["pendingApply"] != true {
		t.Fatal("Apply result hid the later desired edit", publicOperation)
	}
	current := view()
	if current["active"].(map[string]any)["agentsMd"] != "# Captured B" || current["desired"].(map[string]any)["agentsMd"] != "# Later C" || current["pendingApply"] != true {
		t.Fatal("Apply lost its capture or later Save", current)
	}
	if replay := apply("apply-B"); replay != first {
		t.Fatal("Apply replay replaced original capture", replay, first)
	}
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "session"})
	if status != 201 {
		t.Fatal(status, session)
	}
	status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "busy", "prompt": "wait for abort"})
	if status != 202 {
		t.Fatal(status, submitted)
	}
	runID := submitted["run"].(map[string]any)["runId"].(string)
	prior, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	busy := apply("busy-apply")
	for {
		op, err := a.Store.Operation(ctx, busy)
		if err != nil {
			t.Fatal(err)
		}
		if op.State == "failed" {
			if op.ErrorJSON == nil {
				t.Fatal(op)
			}
			var body map[string]any
			json.Unmarshal([]byte(*op.ErrorJSON), &body)
			if body["code"] != "WORK_BUSY" {
				t.Fatal(body)
			}
			break
		}
		if op.State == "succeeded" || ctx.Err() != nil {
			t.Fatal("busy Apply did not fail safely", op)
		}
		time.Sleep(100 * time.Millisecond)
	}
	after, err := a.Store.Configuration(ctx, id)
	if err != nil || *prior.ActiveContextID != *after.ActiveContextID {
		t.Fatal("busy Apply changed active", err)
	}
	status, run := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
	if status != 200 || run["state"] != float64(2) {
		t.Fatal("Apply interrupted active Run", status, run)
	}
	status, _ = packageHTTPCall(t, base, path+"/runs/"+runID+"/cancel", "POST", auth, map[string]string{"idempotencyKey": "explicit-cancel-test"})
	if status != 200 {
		t.Fatal("explicit test cancellation", status)
	}
	for {
		status, run = packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
		if status != 200 {
			t.Fatal(status, run)
		}
		if run["state"] == float64(6) {
			break
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err(), run)
		}
		time.Sleep(100 * time.Millisecond)
	}
	stoppedStatus, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop"})
	if stoppedStatus != 202 {
		t.Fatal(stoppedStatus, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	stoppedApply := apply("stopped-apply")
	waitWorkOperation(t, ctx, a, stoppedApply)
	current = view()
	if current["active"].(map[string]any)["agentsMd"] != "# Later C" || current["pendingApply"] != false || current["runtime"].(map[string]any)["state"] != "unavailable" {
		t.Fatal("stopped Apply did not activate after confirmed initialization shutdown", current)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.DesiredState != "stopped" || work.ObservedState != "stopped" {
		t.Fatal("Apply changed lifecycle", work, err)
	}
	status, started := packageHTTPCall(t, base, path+"/start", "POST", auth, map[string]string{"idempotencyKey": "start-validated"})
	if status != 202 {
		t.Fatal(status, started)
	}
	waitWorkOperation(t, ctx, a, started["operationId"].(string))
	current = view()
	if current["runtime"].(map[string]any)["state"] != "ready" || current["pendingApply"] != false {
		t.Fatal("validated stopped context did not start normally", current)
	}
}

func nativeApplyFixture(t *testing.T, models ...RuntimeInput) (*Application, string, string, string, context.Context) {
	return nativeApplyFixtureConfig(t, false, models...)
}
func nativeApplyFixtureConfig(t *testing.T, mcp bool, models ...RuntimeInput) (*Application, string, string, string, context.Context) {
	t.Helper()
	image := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if image == "" {
		t.Fatal("native acceptance image is required")
	}
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { raw.Close() })
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("Apply installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	store.Close()
	model := RuntimeInput{AgentImage: image, Provider: testsupport.DeterministicProvider, Model: testsupport.DeterministicModel, Credential: "acceptance-only"}
	if len(models) == 1 {
		model = models[0]
		model.AgentImage = image
	}
	a, base, _ := appFixture(t, Options{AgentGRPCListen: "0.0.0.0:0", DataDirectory: directory, PackageHelperImage: image, FileHelperImage: os.Getenv("PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE"), SnapshotHelperImage: os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE"), DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &model}})
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-platform-tools"))
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "apply")
	if err != nil {
		t.Fatal(err)
	}
	auth := "Bearer " + login.Token
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.Configuration == nil {
		t.Fatal("default brain seed failed", a.Status(), a.ensureBundledBrain(ctx))
	}
	config := *defaults.Configuration
	if !mcp {
		config.McpServers = []contracts.McpServer{}
	}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Apply Work", "idempotencyKey": "create", "configuration": config})
	if status != 202 {
		t.Fatal(status, created)
	}
	id := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	return a, base, auth, id, ctx
}

func waitApplyFailure(t *testing.T, ctx context.Context, a *Application, id string) corestore.OperationRecord {
	t.Helper()
	for {
		operation, err := a.Store.Operation(ctx, id)
		if err != nil {
			t.Fatal(err)
		}
		if operation.State == "failed" {
			return operation
		}
		if operation.State == "succeeded" || operation.State == "superseded" || ctx.Err() != nil {
			t.Fatal("Apply did not fail", operation.State, ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestNativeWorkApplyRestoresPriorRuntimeAfterMCPFailure(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	prior, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	_, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	config := view["desired"].(map[string]any)
	config["mcpServers"] = []any{map[string]any{"serverId": "unavailable", "transport": "stdio", "required": true, "command": "/no-such-piwork-mcp", "args": []string{}, "timeoutMs": 1000}}
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 || saved["pendingApply"] != true {
		t.Fatal("invalid-runtime candidate did not save", status, saved)
	}
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "failed-mcp-apply"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	operation := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	if operation.ErrorJSON == nil || operation.ResultJSON == nil {
		t.Fatal("primary or rollback diagnostics lost", operation)
	}
	projection := operationEnvelopeView(operation).(map[string]any)
	encoded, err := json.Marshal(projection)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := contracts.Decode[contracts.PublicOperation](strings.NewReader(string(encoded)), "PublicOperationSchema", 64<<10); err != nil {
		t.Fatal("failed Apply public contract", err, string(encoded))
	}
	if projection["diagnostics"].(map[string]any)["rollback"].(map[string]any)["state"] != "succeeded" {
		t.Fatal("rollback was not confirmed", projection)
	}
	if projection["error"].(map[string]any)["code"] != "MCP_INITIALIZATION_FAILED" || projection["diagnostics"].(map[string]any)["diagnosticCollection"].(map[string]any)["state"] != "available" {
		t.Fatal("recognized MCP cause or collection lost", projection)
	}
	after, err := a.Store.Configuration(ctx, id)
	if err != nil || after.ActiveContextID == nil || *after.ActiveContextID != *prior.ActiveContextID || !after.PendingApply {
		t.Fatal("failed candidate replaced prior active", after, err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.ObservedState != "ready" {
		t.Fatal("prior runtime did not recover", work, err)
	}
	status, sessions := packageHTTPCall(t, base, path+"/sessions", "GET", auth, nil)
	if status != 200 {
		t.Fatal("prior conversation route not restored", status, sessions)
	}
}

func TestNativeWorkStopFencesInitializingApply(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	prior, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	_, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	config := view["desired"].(map[string]any)
	config["mcpServers"] = []any{map[string]any{"serverId": "waiting", "transport": "stdio", "required": true, "command": "node", "args": []string{"-e", "setTimeout(()=>{},600000)"}, "timeoutMs": 60000}}
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 {
		t.Fatal(status, saved)
	}
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "apply-to-be-stopped"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	applyID := accepted["operationId"].(string)
	for {
		operation, err := a.Store.Operation(ctx, applyID)
		if err != nil {
			t.Fatal(err)
		}
		if operation.State == "failed" || operation.State == "succeeded" || ctx.Err() != nil {
			t.Fatal("candidate did not initialize", operation.State, ctx.Err())
		}
		plan, err := a.readApplyPlan(ctx, operation)
		if err != nil {
			t.Fatal(err)
		}
		if plan.Stage == "starting" && plan.Generation > 0 {
			container, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: id, Kind: "agent", LogicalID: "agentd"})
			if err != nil {
				t.Fatal(err)
			}
			if container != nil && container.Config != nil && container.State != nil && container.State.Running && container.Config.Labels["piwork.context_identity"] == plan.ContextID {
				break
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	began := time.Now()
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-initializing-apply"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	if elapsed := time.Since(began); elapsed > 25*time.Second {
		t.Fatal("Stop waited on the full candidate readiness timeout", elapsed)
	}
	original, err := a.Store.Operation(ctx, applyID)
	if err != nil || original.State != "superseded" {
		t.Fatal("Stop failed to supersede Apply", original, err)
	}
	current, err := a.Store.Configuration(ctx, id)
	if err != nil || current.ActiveContextID == nil || *current.ActiveContextID != *prior.ActiveContextID || !current.PendingApply {
		t.Fatal("superseded candidate activated", current, err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.DesiredState != "stopped" || work.ObservedState != "stopped" {
		t.Fatal("late Apply reopened Work", work, err)
	}
	if status, _ := packageHTTPCall(t, base, path+"/sessions", "GET", auth, nil); status != 503 {
		t.Fatal("stopped Work exposed conversation", status)
	}
}

func TestNativeWorkApplyPreservesPrimaryAndRollbackFailure(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	prior, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	_, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	config := view["desired"].(map[string]any)
	config["mcpServers"] = []any{map[string]any{"serverId": "unavailable", "transport": "stdio", "required": true, "command": "/no-such-piwork-mcp", "args": []string{}, "timeoutMs": 1000}}
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 {
		t.Fatal(status, saved)
	}
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "failed-rollback"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	operationID := accepted["operationId"].(string)
	for {
		operation, err := a.Store.Operation(ctx, operationID)
		if err != nil {
			t.Fatal(err)
		}
		plan, err := a.readApplyPlan(ctx, operation)
		if err != nil {
			t.Fatal(err)
		}
		if plan.Stage == "starting" && plan.Generation > 0 {
			break
		}
		if operation.State == "failed" || operation.State == "succeeded" || ctx.Err() != nil {
			t.Fatal("fault boundary not reached", operation.State, ctx.Err())
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Only this test installation is altered. The candidate failure remains
	// independent from a retained prior-context failure during restoration.
	priorPath := filepath.Join(a.options.DataDirectory, "works", id, "contexts", *prior.ActiveContextID, "config.json")
	original, err := os.ReadFile(priorPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(priorPath, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(priorPath, []byte("{}"), 0600); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.WriteFile(priorPath, original, 0600); err != nil {
			t.Error(err)
		}
		os.Chmod(priorPath, 0444)
	}()
	failed := waitApplyFailure(t, ctx, a, operationID)
	projected := operationEnvelopeView(failed).(map[string]any)
	encoded, _ := json.Marshal(projected)
	if _, err := contracts.Decode[contracts.PublicOperation](strings.NewReader(string(encoded)), "PublicOperationSchema", 64<<10); err != nil {
		t.Fatal(err, string(encoded))
	}
	diagnostic := projected["error"].(map[string]any)
	rollback := projected["diagnostics"].(map[string]any)["rollback"].(map[string]any)
	if diagnostic["code"] != "MCP_INITIALIZATION_FAILED" || rollback["state"] != "failed" || rollback["error"].(map[string]any)["code"] != "ROLLBACK_FAILED" {
		t.Fatal("primary failure replaced by rollback failure", projected)
	}
	state, err := a.Store.Configuration(ctx, id)
	if err != nil || state.ActiveContextID == nil || *state.ActiveContextID != *prior.ActiveContextID || !state.PendingApply {
		t.Fatal("failed rollback destroyed active or desired records", state, err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.ObservedState != "failed" {
		t.Fatal("failed rollback reported ready", work, err)
	}
	if status, _ := packageHTTPCall(t, base, path+"/sessions", "GET", auth, nil); status != 503 {
		t.Fatal("failed rollback exposed stale conversation route", status)
	}
}

func TestNativeInitialWorkActivationPreservesLaterSave(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixture(t)
	a.workQueueMu.Lock()
	held := true
	defer func() {
		if held {
			a.workQueueMu.Unlock()
		}
	}()
	type reply struct {
		status int
		body   map[string]any
	}
	accepted := make(chan reply, 1)
	go func() {
		status, body := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Initial capture race", "idempotencyKey": "initial-capture"})
		accepted <- reply{status, body}
	}()
	var id string
	for id == "" {
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			err := tx.QueryRow(`SELECT id FROM works WHERE name='Initial capture race'`).Scan(&id)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		if id == "" {
			time.Sleep(10 * time.Millisecond)
		}
	}
	value, _ := a.workLocks.LoadOrStore(id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	unlocked := false
	defer func() {
		if !unlocked {
			lock.Unlock()
		}
	}()
	a.workQueueMu.Unlock()
	held = false
	var response reply
	select {
	case response = <-accepted:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	if response.status != 202 || response.body["workId"] != id {
		t.Fatal("initial creation not accepted", response)
	}
	path := "/api/v1/works/" + id
	status, saved := packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]string{"agentsMd": "# Saved during initial startup"})
	if status != 200 || saved["active"] != nil || saved["pendingApply"] != true {
		t.Fatal("initial Save invented active state", status, saved)
	}
	lock.Unlock()
	unlocked = true
	waitWorkOperation(t, ctx, a, response.body["operationId"].(string))
	status, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 || view["active"].(map[string]any)["agentsMd"] != "" || view["desired"].(map[string]any)["agentsMd"] != "# Saved during initial startup" || view["pendingApply"] != true {
		t.Fatal("initial activation reread newer desired context", status, view)
	}
}

func TestNativeInitialWorkRetryUsesAcceptedReplacementContext(t *testing.T) {
	a, base, auth, _, ctx := nativeApplyFixture(t)
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	configuration := *defaults.Configuration
	configuration.McpServers = []contracts.McpServer{{ServerId: "unavailable", Transport: "stdio", Required: true, Command: contracts.Field[string]{Present: true, Value: "/no-such-piwork-mcp"}, TimeoutMs: contracts.Field[int64]{Present: true, Value: 1000}}}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Initial Retry", "configuration": configuration, "idempotencyKey": "initial-failure"})
	if status != 202 {
		t.Fatal(status, created)
	}
	id := created["workId"].(string)
	waitApplyFailure(t, ctx, a, created["operationId"].(string))
	path := "/api/v1/works/" + id
	status, before := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 || before["active"] != nil {
		t.Fatal(status, before)
	}
	configuration.McpServers = []contracts.McpServer{}
	configuration.AgentsMd = "# Retry replacement"
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": configuration})
	if status != 200 || saved["active"] != nil {
		t.Fatal(status, saved)
	}
	status, accepted := packageHTTPCall(t, base, path+"/retry", "POST", auth, map[string]string{"idempotencyKey": "retry-replacement"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	status, view := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 || view["active"].(map[string]any)["agentsMd"] != configuration.AgentsMd || view["pendingApply"] != false || view["runtime"].(map[string]any)["state"] != "ready" {
		t.Fatal("Retry reused a failed context identity", status, view)
	}
}
