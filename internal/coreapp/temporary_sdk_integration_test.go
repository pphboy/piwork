//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
)

// Exercises the real SDK tool bridge, native Go MCP, mTLS admission, the
// original command result and the explicit, durable cleanup operation.
func TestNativeSDKTemporaryProbeThroughMCP(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixtureConfig(t, true)
	path := "/api/v1/works/" + workID
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "sdk-temp-session"})
	if status != 201 {
		t.Fatal("session rejected", status)
	}
	status, direct := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "sdk-direct-run", "prompt": "run direct probe fixture"})
	if status != 202 {
		t.Fatal("direct probe Run rejected", status)
	}
	directID := direct["run"].(map[string]any)["runId"].(string)
	directDeadline := time.Now().Add(30 * time.Second)
	for {
		status, run := packageHTTPCall(t, base, path+"/runs/"+directID, "GET", auth, nil)
		if status == 200 && run["state"] == float64(4) {
			encoded, _ := json.Marshal(run)
			if !strings.Contains(string(encoded), "direct-probe-complete") {
				t.Fatal("direct probe did not report its command result")
			}
			break
		}
		if time.Now().After(directDeadline) || run["state"] == float64(5) {
			t.Fatal("direct probe failed", status, run)
		}
		time.Sleep(100 * time.Millisecond)
	}
	status, before := packageHTTPCall(t, base, path+"/services", "GET", auth, nil)
	if status != 200 || len(before["services"].([]any)) != 0 {
		t.Fatal("direct probe created a Service", status, before)
	}
	status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "sdk-temp-run", "prompt": "run temporary probe fixture"})
	if status != 202 {
		t.Fatal("Run rejected", status)
	}
	runID := submitted["run"].(map[string]any)["runId"].(string)
	request, err := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatal("Run event stream", response.StatusCode)
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 32<<10), 2<<20)
	tools := make(map[string]bool)
	terminal := false
	for scanner.Scan() {
		line := scanner.Bytes()
		if bytes.Contains(line, []byte("tool-end")) {
			for _, tool := range []string{"deployment_context", "service_create", "service_get", "service_logs", "service_remove", "operation_get"} {
				if bytes.Contains(line, []byte("work-services__"+tool)) {
					if bytes.Contains(line, []byte(`"isError":true`)) {
						t.Fatalf("SDK MCP tool %s failed: %s", tool, string(line))
					}
					tools[tool] = true
				}
			}
		}
		var event struct {
			Kind struct {
				Case  string `json:"$case"`
				State struct {
					State int `json:"state"`
				} `json:"state"`
			} `json:"kind"`
		}
		if json.Unmarshal(line, &event) == nil && event.Kind.Case == "state" && event.Kind.State.State >= 4 {
			terminal = event.Kind.State.State == 4
			break
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if !terminal || len(tools) != 6 {
		t.Fatal("SDK did not finish all probe steps", terminal, tools)
	}
	status, run := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
	encoded, _ := json.Marshal(run)
	if status != 200 || !strings.Contains(string(encoded), "temporary-probe-complete:service-") {
		t.Fatal("SDK probe did not confirm its original result and cleanup", status, string(encoded))
	}
	status, services := packageHTTPCall(t, base, path+"/services", "GET", auth, nil)
	if status != 200 || len(services["services"].([]any)) != 0 {
		t.Fatal("SDK probe left an enabled service", status, services)
	}
	status, history := packageHTTPCall(t, base, path+"/temporary-cleanups?runId="+runID, "GET", auth, nil)
	items, _ := history["items"].([]any)
	if status != 200 || len(items) != 1 {
		t.Fatal("durable cleanup history missing", status, history)
	}
	cleanup := items[0].(map[string]any)
	if cleanup["runId"] != runID || cleanup["state"] != "completed" || cleanup["trigger"] != "explicit" || cleanup["operationId"] == "" {
		t.Fatal("cleanup history has incorrect association", cleanup)
	}
	if raw, _ := json.Marshal(cleanup); strings.Contains(string(raw), "temporary-probe-output") || strings.Contains(string(raw), "leaseId") {
		t.Fatal("cleanup history leaked private output or lease")
	}
	view, _, err := a.inspectServiceRuntime(ctx, workID, cleanup["serviceId"].(string))
	if err != nil || view != nil {
		t.Fatal("temporary container remained", err)
	}
	for _, scenario := range []struct {
		prompt, key, trigger string
		terminal             float64
	}{
		{"run temporary listener then finish fixture", "sdk-finish", "run-succeeded", 4},
		{"run temporary listener then fail fixture", "sdk-fail", "run-failed", 5},
	} {
		status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": scenario.key, "prompt": scenario.prompt})
		if status != 202 {
			t.Fatal("listener Run rejected", scenario.key, status, submitted)
		}
		listenerRunID := submitted["run"].(map[string]any)["runId"].(string)
		deadline := time.Now().Add(45 * time.Second)
		for {
			status, listenerRun := packageHTTPCall(t, base, path+"/runs/"+listenerRunID, "GET", auth, nil)
			if status == 200 && listenerRun["state"] == scenario.terminal {
				if scenario.terminal == 4 && listenerRun["finalText"] != "temporary-listener-finished" {
					t.Fatal("listener Run returned an unexpected result", listenerRun)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("listener Run did not reach its original terminal state", scenario.key, status, listenerRun)
			}
			time.Sleep(100 * time.Millisecond)
		}
		deadline = time.Now().Add(45 * time.Second)
		for {
			status, history := packageHTTPCall(t, base, path+"/temporary-cleanups?runId="+listenerRunID, "GET", auth, nil)
			items, _ := history["items"].([]any)
			if status == 200 && len(items) == 1 && items[0].(map[string]any)["state"] == "completed" {
				if items[0].(map[string]any)["trigger"] != scenario.trigger {
					t.Fatal("automatic cleanup lost the original terminal outcome", scenario.key, items)
				}
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("terminal Run was not automatically cleaned", scenario.key, status, history)
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for {
		status, work := packageHTTPCall(t, base, path, "GET", auth, nil)
		if status == 200 && work["observedState"] == "ready" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("temporary probe degraded the Work", status, work)
		}
		time.Sleep(100 * time.Millisecond)
	}
}
