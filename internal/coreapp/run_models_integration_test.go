//go:build integration

package coreapp

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNativeChatModelSelectionRunsThroughGoAndRealSDK(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + id
	if status, capabilities := packageHTTPCall(t, base, path+"/chat-capabilities", "GET", auth, nil); status != 200 || capabilities["contractVersion"] != float64(0) && capabilities["contractVersion"] != float64(1) {
		t.Fatal("optional chat contract changed original runtime admission", status, capabilities)
	} else if capabilities["contractVersion"] == float64(0) {
		for _, endpoint := range []string{"chat-models", "commands", "sessions/submissions/old-agent-readonly"} {
			if status, result := packageHTTPCall(t, base, path+"/"+endpoint, "GET", auth, nil); status != 501 || result["code"] != "CHAT_OPTIONS_UNSUPPORTED" {
				t.Fatal("older Agent must reject only optional chat controls", endpoint, status, result)
			}
		}
		t.Log("older Agent: optional controls return 501; original model/Session/Run flow remains admitted")
	}
	if _, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: a.options.Initialization.Runtime.AgentImage, Provider: "piwork-deterministic", Model: "fixture-v2", Credential: "private-second-model-key"}); err != nil {
		t.Fatal(err)
	}
	second, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ensureRuntimeCatalog(ctx, second); err != nil {
		t.Fatal(err)
	}
	secondID := string(runtimeModelCatalogID(second.Revision))
	checkSafe := func(value any) {
		t.Helper()
		raw, _ := json.Marshal(value)
		for _, private := range []string{"credentialRef", "private-second-model-key", "baseUrl", "/secrets/"} {
			if strings.Contains(string(raw), private) {
				t.Fatal("private model material escaped", private)
			}
		}
	}
	status, models := packageHTTPCall(t, base, path+"/models", "GET", auth, nil)
	if status != 200 || models["availability"] != "available" || len(models["models"].([]any)) != 2 {
		t.Fatal(status, models)
	}
	checkSafe(models)
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "models-session"})
	if status != 201 || session["modelPreference"] != nil {
		t.Fatal(status, session)
	}
	sessionID := session["sessionId"].(string)
	submit := func(key, prompt string, selector ...any) map[string]any {
		t.Helper()
		input := map[string]any{"sessionId": sessionID, "submissionKey": key, "prompt": prompt}
		if len(selector) > 0 {
			input["modelRef"] = selector[0]
		}
		status, result := packageHTTPCall(t, base, path+"/runs", "POST", auth, input)
		if status != 202 {
			t.Fatal(status, result)
		}
		checkSafe(result)
		return result
	}
	wait := func(runID string, want int) map[string]any {
		t.Helper()
		for {
			status, run := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
			if status != 200 {
				t.Fatal(status, run)
			}
			state := int(run["state"].(float64))
			if state == want {
				checkSafe(run)
				return run
			}
			if state >= 4 || ctx.Err() != nil {
				t.Fatal(state, run, ctx.Err())
			}
			time.Sleep(20 * time.Millisecond)
		}
	}
	first := submit("model-default", "identify current model")
	firstID := first["run"].(map[string]any)["runId"].(string)
	run := wait(firstID, 4)
	if run["finalText"] != "piwork-deterministic/fixture-v1" || run["actualModel"].(map[string]any)["model"] != "fixture-v1" {
		t.Fatal(run)
	}
	busy := submit("model-busy", "wait for abort")
	busyID := busy["run"].(map[string]any)["runId"].(string)
	wait(busyID, 2)
	status, preference := packageHTTPCall(t, base, path+"/sessions/"+sessionID+"/model", "PATCH", auth, map[string]any{"modelRef": secondID})
	if status != 200 || preference["modelPreference"].(map[string]any)["modelRef"] != secondID {
		t.Fatal(status, preference)
	}
	checkSafe(preference)
	status, current := packageHTTPCall(t, base, path+"/runs/"+busyID, "GET", auth, nil)
	if status != 200 || current["actualModel"].(map[string]any)["model"] != "fixture-v1" {
		t.Fatal("preference changed an active Run", status, current)
	}
	status, rejected := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": sessionID, "submissionKey": "must-not-queue", "prompt": "identify current model"})
	if status != 429 {
		t.Fatal("busy input was queued", status, rejected)
	}
	status, _ = packageHTTPCall(t, base, path+"/runs/"+busyID+"/cancel", "POST", auth, map[string]string{"idempotencyKey": "cancel-busy"})
	if status != 200 {
		t.Fatal(status)
	}
	wait(busyID, 6)
	selected := submit("model-selected", "identify current model")
	selectedID := selected["run"].(map[string]any)["runId"].(string)
	run = wait(selectedID, 4)
	if run["finalText"] != "piwork-deterministic/fixture-v2" || run["actualModel"].(map[string]any)["modelRef"] != secondID || run["source"].(map[string]any)["kind"] != "chat" {
		t.Fatal(run)
	}
	reset := submit("model-null-default", "identify current model", nil)
	wait(reset["run"].(map[string]any)["runId"].(string), 4)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE catalog_entries SET enabled=0 WHERE id=?", secondID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	replay := submit("model-selected", "identify current model")
	if replay["reused"] != true || replay["run"].(map[string]any)["runId"] != selectedID {
		t.Fatal("replay re-resolved the unavailable model", replay)
	}
	status, unavailable := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": sessionID, "submissionKey": "unavailable-model", "prompt": "identify current model"})
	if status != 409 || unavailable["code"] != "MODEL_UNAVAILABLE" {
		t.Fatal(status, unavailable)
	}
	status, conflict := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": sessionID, "submissionKey": "model-selected", "prompt": "identify current model", "modelRef": nil})
	if status != 409 || conflict["code"] != "CONFLICT" {
		t.Fatal(status, conflict)
	}
	status, newSession := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "new-default-session"})
	if status != 201 || newSession["modelPreference"] != nil {
		t.Fatal("preference became Work configuration", status, newSession)
	}
	t.Log("Go HTTP, current-generation mTLS, actual SDK model pair, immutable active model, independent preference, busy rejection and idempotent replay passed")
}
