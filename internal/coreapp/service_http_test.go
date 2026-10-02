package coreapp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/rpc/servicesv1"
)

func TestServiceHTTPDefinitionAndMetadataWhileStopped(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "http-service")
	if err != nil {
		t.Fatal(err)
	}
	base := "http://" + a.listener.Addr().String()
	auth := "Bearer " + login.Token
	path := "/api/v1/works/" + id + "/services"
	status, created := httpCall(t, base, path, "POST", auth, map[string]any{"definition": json.RawMessage(serviceRaw("counter", 250)), "idempotencyKey": "create"})
	if status != 202 {
		t.Fatal(status, created)
	}
	serviceID := created["serviceId"].(string)
	for deadline := time.Now().Add(5 * time.Second); ; {
		operation, err := a.Store.Operation(context.Background(), created["operationId"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if operation.State == "succeeded" {
			break
		}
		if operation.State == "failed" || time.Now().After(deadline) {
			t.Fatal("stopped definition operation", operation.State, operation.ErrorJSON)
		}
		time.Sleep(10 * time.Millisecond)
	}
	status, view := httpCall(t, base, path+"/"+serviceID, "GET", auth, nil)
	if status != 200 || view["observedState"] != "stopped" || view["access"].(map[string]any)["hostname"] == "" {
		t.Fatal(status, view)
	}
	status, invalid := httpCall(t, base, path, "POST", auth, map[string]any{"definition": map[string]any{"name": "bad", "privileged": true}, "idempotencyKey": "bad"})
	if status != 400 || invalid["code"] != "INVALID_SERVICE_DEFINITION" {
		t.Fatal("invalid definition HTTP classification", status, invalid)
	}
	_, err = a.acceptServiceDefinition(context.Background(), actor, id, serviceID, 1, serviceRaw("counter", 300), "update")
	if err != nil {
		t.Fatal(err)
	}
	status, stale := httpCall(t, base, path+"/"+serviceID, "PATCH", auth, map[string]any{"definition": json.RawMessage(serviceRaw("counter", 350)), "expectedRevision": 1, "idempotencyKey": "stale"})
	if status != 409 || stale["code"] != "REVISION_CONFLICT" {
		t.Fatal(status, stale)
	}
}

func TestServiceRPCDefinitionProjectionRejectsIntegerOverflow(t *testing.T) {
	value := &servicesv1.ServiceDefinition{Name: "counter", Image: &servicesv1.ServiceImage{Reference: "fixture/app"}, Command: "app", WorkingDirectory: "/", CpuMillis: 250, MemoryBytes: 128 << 20, Enabled: true, RestartPolicy: "bounded"}
	raw, err := rpcDefinitionInput(value)
	if err != nil {
		t.Fatal(err)
	}
	definition, err := normalizeServiceDefinition(raw)
	if err != nil || !definition.Enabled.Value || definition.Args.Value == nil || definition.Environment.Value == nil {
		t.Fatal("RPC defaults/projection", err)
	}
	value.MemoryBytes = uint64(contracts.MaxSafeInteger) + 1
	if _, err := rpcDefinitionInput(value); err == nil {
		t.Fatal("uint64 overflow truncated")
	}
	if err := validateServiceRPCOptions(Options{AgentGRPCListen: "0.0.0.0:0", AgentGRPCAdvertise: "piwork-core:7172"}); err != nil {
		t.Fatal(err)
	}
	for _, address := range []string{"https://core:7172", "core:not-a-port", "0.0.0.0:65536"} {
		if err := validateServiceRPCOptions(Options{AgentGRPCListen: address}); err == nil {
			t.Fatal("invalid listener accepted", address)
		}
	}
	text := redactServiceOutput("password=not-for-output and hidden\n", contracts.ServiceDefinition{Environment: map[string]json.RawMessage{"API_KEY": json.RawMessage(`"hidden"`)}})
	if strings.Contains(text, "not-for-output") || strings.Contains(text, "hidden") {
		t.Fatal("logs leaked application credential")
	}
}
