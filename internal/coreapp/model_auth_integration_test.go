//go:build integration

package coreapp

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"piwork/internal/dockerengine"
)

func TestNativeModelAuthenticationFailureProjectionAndRotation(t *testing.T) {
	gateway, image := nativeModelGateway(t)
	t.Setenv("PIWORK_TEST_NATIVE_AGENT_IMAGE", image)
	a, base, auth, work, fixtureCtx := nativeApplyFixture(t)
	ctx, cancel := context.WithTimeout(fixtureCtx, 2*time.Minute)
	defer cancel()
	provider := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers", "POST", map[string]any{
		"name": "Authentication fixture", "api": "openai-responses", "baseUrl": gateway.URL + "/v1", "credential": "synthetic-invalid-key",
	}, 201)
	model := modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+provider["id"].(string)+"/models", "POST", map[string]any{
		"name": "Authentication fixture model", "model": "gpt-5.1",
	}, 201)
	path := "/api/v1/works/" + work
	session := modelNativeCall(t, base, auth, path+"/sessions", "POST", map[string]string{"idempotencyKey": "auth-session"}, 201)["sessionId"].(string)
	modelNativeCall(t, base, auth, path+"/sessions/"+session+"/chat-options", "PATCH", map[string]any{"modelRef": model["modelRef"], "thinkingLevel": "off"}, 200)
	gateway.mu.Lock()
	gateway.hold = make(chan struct{})
	gateway.started = make(chan struct{})
	release, started := gateway.hold, gateway.started
	gateway.mu.Unlock()
	body := map[string]any{"sessionId": session, "submissionKey": "invalid-model-key", "prompt": "Original prompt", "inputMode": "text"}
	accepted := modelNativeCall(t, base, auth, path+"/runs", "POST", body, 202)
	runID := accepted["run"].(map[string]any)["runId"].(string)
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("model request did not start", ctx.Err())
	}
	type streamResult struct {
		raw []byte
		err error
	}
	live := make(chan streamResult, 1)
	go func() {
		request, err := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events?after=0", nil)
		if err != nil {
			live <- streamResult{err: err}
			return
		}
		request.Header.Set("Authorization", auth)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			live <- streamResult{err: err}
			return
		}
		defer response.Body.Close()
		if response.StatusCode != 200 {
			live <- streamResult{err: io.ErrUnexpectedEOF}
			return
		}
		raw, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
		live <- streamResult{raw, err}
	}()
	time.Sleep(100 * time.Millisecond)
	close(release)
	result := <-live
	if result.err != nil {
		t.Fatal("live Run events unavailable", result.err)
	}
	var firstSequence string
	var terminal map[string]any
	scanner := bufio.NewScanner(strings.NewReader(string(result.raw)))
	for scanner.Scan() {
		var event map[string]any
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			t.Fatal("invalid live event")
		}
		if firstSequence == "" {
			firstSequence, _ = event["sequence"].(string)
		}
		kind, _ := event["kind"].(map[string]any)
		state, _ := kind["state"].(map[string]any)
		if state["state"] == float64(5) {
			terminal, _ = state["error"].(map[string]any)
		}
	}
	if scanner.Err() != nil || terminal["code"] != "MODEL_AUTHENTICATION_FAILED" || terminal["retryable"] != false || !strings.Contains(terminal["message"].(string), "API Key is invalid") {
		t.Fatal("live authentication classification missing", terminal, scanner.Err())
	}
	request, _ := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events?after="+firstSequence, nil)
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	reconnected, err := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	response.Body.Close()
	if err != nil || response.StatusCode != 200 || !strings.Contains(string(reconnected), "MODEL_AUTHENTICATION_FAILED") {
		t.Fatal("reconnected stream lost failure", err, response.StatusCode)
	}
	old := modelNativeCall(t, base, auth, path+"/runs/"+runID, "GET", nil, 200)
	errorView, _ := old["error"].(map[string]any)
	if errorView["code"] != terminal["code"] || errorView["message"] != terminal["message"] || errorView["retryable"] != false {
		t.Fatal("Run query differs from event", old)
	}
	history := modelNativeCall(t, base, auth, path+"/sessions/"+session, "GET", nil, 200)
	historyJSON, _ := json.Marshal(history)
	identity := dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"}
	container, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil || container == nil {
		t.Fatal("Agent log source unavailable", err)
	}
	logs, err := a.dockerRuntime.Logs(ctx, identity, 200, container.ID)
	if err != nil || logs.Truncated {
		t.Fatal("Agent logs unavailable", err)
	}
	public := string(result.raw) + string(reconnected) + string(historyJSON) + logs.Text
	for _, forbidden := range []string{"synthetic-invalid-key", "synthetic-provider-secret", "synthetic-header-secret", "/private/provider/path"} {
		if strings.Contains(public, forbidden) {
			t.Fatal("private provider material leaked into events or history")
		}
	}
	if !strings.Contains(string(historyJSON), "MODEL_AUTHENTICATION_FAILED") || gateway.count() != 1 {
		t.Fatal("Run history or non-retry invariant failed")
	}
	modelNativeCall(t, base, auth, "/api/v1/admin/model-providers/"+provider["id"].(string), "PATCH", map[string]any{"credential": "synthetic-rotated-key"}, 200)
	newRun := modelNativeRun(t, ctx, base, auth, work, session, "new-after-rotation")
	if newRun["runId"] == runID || gateway.last().Key != "synthetic-rotated-key" {
		t.Fatal("new Run did not use the rotated key")
	}
	replayed := modelNativeCall(t, base, auth, path+"/runs", "POST", body, 202)
	if replayed["reused"] != true || replayed["run"].(map[string]any)["runId"] != runID || gateway.count() != 2 {
		t.Fatal("old Run was replayed")
	}
	after := modelNativeCall(t, base, auth, path+"/runs/"+runID, "GET", nil, 200)
	if after["state"] != old["state"] || after["error"].(map[string]any)["message"] != errorView["message"] {
		t.Fatal("old failure was rewritten")
	}
}
