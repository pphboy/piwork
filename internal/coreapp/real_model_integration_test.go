//go:build integration

package coreapp

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestNativeOptionalRealModelSmoke(t *testing.T) {
	path := os.Getenv("PIWORK_TEST_REAL_MODEL_ENV")
	if path == "" {
		t.Skip("optional real model smoke requires PIWORK_TEST_REAL_MODEL_ENV")
	}
	values, err := ReadEnvironmentFile(path)
	if err != nil {
		t.Fatal(err)
	}
	choose := func(keys ...string) string {
		for _, key := range keys {
			if values[key] != "" {
				return values[key]
			}
		}
		return ""
	}
	input := RuntimeInput{Provider: choose("PIWORK_MODEL_PROVIDER"), Model: choose("PIWORK_MODEL", "PIWORK_MODEL_ID"), Credential: choose("PIWORK_API_KEY", "PIWORK_MODEL_API_KEY")}
	if input.Provider == "" || input.Model == "" || input.Credential == "" || input.Provider == "piwork-deterministic" {
		t.Fatal("real model configuration is incomplete")
	}
	if value := choose("PIWORK_MODEL_BASE_URL"); value != "" {
		input.BaseURL = &value
	}
	a, base, auth, id, ctx := nativeApplyFixture(t, input)
	path = "/api/v1/works/" + id
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "real-model-session"})
	if status != 201 {
		t.Fatal("real model Session was not accepted", status)
	}
	status, accepted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "real-model-once", "prompt": "Reply with the single word PIWORK_OK. Do not use tools."})
	if status != 202 {
		t.Fatal("real model Run was not accepted", status)
	}
	runID := accepted["run"].(map[string]any)["runId"].(string)
	for deadline := time.Now().Add(2 * time.Minute); ; time.Sleep(100 * time.Millisecond) {
		status, result := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
		if status != 200 {
			t.Fatal("real model observation failed", status)
		}
		if result["state"] == float64(4) {
			text, _ := result["finalText"].(string)
			if strings.TrimSpace(text) == "" {
				t.Fatal("real model returned empty assistant result")
			}
			status, replay := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "real-model-once", "prompt": "Reply with the single word PIWORK_OK. Do not use tools."})
			if status != 202 || replay["run"].(map[string]any)["runId"] != runID || replay["reused"] != true {
				t.Fatal("real model retry submitted another Run")
			}
			if _, err := a.Store.Work(ctx, id, false); err != nil {
				t.Fatal(err)
			}
			t.Logf("real Pi SDK model %s/%s returned %d assistant bytes; one accepted Run and replay verified", input.Provider, input.Model, len(text))
			return
		}
		if result["state"] == float64(5) || result["state"] == float64(6) || result["state"] == float64(7) {
			t.Fatal("real model Run failed; inspect safe Operation diagnostics")
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			t.Fatal("real model Run observation deadline")
		}
	}
}
