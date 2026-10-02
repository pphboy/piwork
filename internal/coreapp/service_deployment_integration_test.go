//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
)

func TestNativeSDKDeploysServiceThroughGoMCPAndCore(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	if _, err := a.engine.PrepareImage(ctx, "python:3.13-slim"); err != nil {
		t.Fatal("service fixture image", err)
	}
	state, err := a.Store.Configuration(ctx, workID)
	if err != nil {
		t.Fatal(err)
	}
	var config contracts.WorkConfig
	if json.Unmarshal([]byte(state.DesiredConfigJSON), &config) != nil {
		t.Fatal("invalid captured Work configuration")
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config.McpServers = defaults.Configuration.McpServers
	path := "/api/v1/works/" + workID
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 || saved["pendingApply"] != true {
		t.Fatal("enable MCP save", status, saved)
	}
	status, apply := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "enable-service-mcp"})
	if status != 202 {
		t.Fatal(status, apply)
	}
	waitWorkOperation(t, ctx, a, apply["operationId"].(string))
	status, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "deployment-session"})
	if status != 201 {
		t.Fatal(status, session)
	}
	status, submission := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": session["sessionId"], "submissionKey": "deployment-run", "prompt": "deploy deterministic service"})
	if status != 202 {
		t.Fatal(status, submission)
	}
	runID := submission["run"].(map[string]any)["runId"].(string)
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
		t.Fatal("event stream", response.StatusCode)
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 32<<10), 2<<20)
	tools := map[string]bool{}
	terminal := false
	for scanner.Scan() {
		line := scanner.Bytes()
		if bytes.Contains(line, []byte("tool-end")) {
			for _, tool := range []string{"deployment_context", "service_create", "operation_get", "service_get"} {
				if bytes.Contains(line, []byte("work-services__"+tool)) {
					if bytes.Contains(line, []byte(`"isError":true`)) {
						t.Fatal("MCP tool failed", string(line))
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
	if !terminal || len(tools) != 4 {
		t.Fatal("SDK deployment did not traverse all required Go MCP tools", terminal, tools)
	}
	status, run := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
	encoded, _ := json.Marshal(run)
	if status != 200 || !strings.Contains(string(encoded), "service-deployed:service-") {
		t.Fatal("SDK deployment result", status, string(encoded))
	}
	status, services := packageHTTPCall(t, base, path+"/services", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, services)
	}
	items := services["services"].([]any)
	if len(items) != 1 {
		t.Fatal("deployment created duplicate service", items)
	}
	service := items[0].(map[string]any)
	if service["name"] != "demo" || service["observedState"] != "ready" || service["access"].(map[string]any)["status"] != "available" {
		t.Fatal("service not ready through HTTP", service)
	}
	hostname := service["access"].(map[string]any)["hostname"].(string)
	count := func(want float64) {
		t.Helper()
		request, err := http.NewRequestWithContext(ctx, "GET", base+"/api/v1/service-gateway/"+hostname+"/80/", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set(gatewayCredential, strings.TrimPrefix(auth, "Bearer "))
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var body map[string]any
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || response.StatusCode != 200 || body["count"] != want {
			t.Fatal("SDK-deployed Python durable counter", body, err)
		}
	}
	count(3)
	status, restart := packageHTTPCall(t, base, path+"/services/"+service["serviceId"].(string)+"/restart", "POST", auth, map[string]string{"idempotencyKey": "python-counter-restart"})
	if status != 202 {
		t.Fatal(status, restart)
	}
	waitWorkOperation(t, ctx, a, restart["operationId"].(string))
	count(4)
	for _, action := range []string{"stop", "start"} {
		status, accepted := packageHTTPCall(t, base, path+"/"+action, "POST", auth, map[string]string{"idempotencyKey": "python-work-" + action})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	}
	count(5)
	options := a.options
	if err := a.Close(ctx); err != nil {
		t.Fatal("Python Core shutdown", err)
	}
	a, err = New(ctx, options)
	if err != nil {
		t.Fatal("Python Core reopen", err)
	}
	t.Cleanup(func() {
		closeCtx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := a.Close(closeCtx); err != nil {
			t.Error(err)
		}
	})
	address, err := a.Listen(ListenAddress{Host: "127.0.0.1", Port: 0})
	if err != nil {
		t.Fatal(err)
	}
	base = address.URL()
	if !a.Status().Ready {
		t.Fatal("Python service prevented Core recovery", a.Status())
	}
	count(6)
	t.Log("real SDK read deployment Skill, wrote/read Python source, Go MCP deployed via Core mTLS, observed operation and invoked Work-local service")
}
