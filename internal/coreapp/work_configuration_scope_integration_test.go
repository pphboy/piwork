//go:build integration

package coreapp

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestNativeWorkConfigurationOrderingScopeAndMixedStateRecovery(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	beforeDefaults, _ := json.Marshal(defaults)
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Unchanged B", "idempotencyKey": "create-B"})
	if status != 202 {
		t.Fatal(status, created)
	}
	b := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	status, before := packageHTTPCall(t, base, "/api/v1/works/"+b+"/configuration", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, before)
	}
	beforeB, _ := json.Marshal(before["desired"])
	path := "/api/v1/works/" + id + "/configuration"
	for _, text := range []string{"# first authorized write", "# last authorized write"} {
		status, view := packageHTTPCall(t, base, path+"/agents", "PUT", auth, map[string]string{"agentsMd": text})
		raw, _ := json.Marshal(view)
		if status != 200 || strings.Contains(string(raw), "Revision") || strings.Contains(string(raw), "revision") {
			t.Fatal("public Save requires/exposes revision", status, view)
		}
	}
	status, after := packageHTTPCall(t, base, path, "GET", auth, nil)
	if status != 200 || after["desired"].(map[string]any)["agentsMd"] != "# last authorized write" || after["active"].(map[string]any)["agentsMd"] == "# last authorized write" {
		t.Fatal(after)
	}
	status, other := packageHTTPCall(t, base, "/api/v1/works/"+b+"/configuration", "GET", auth, nil)
	otherRaw, _ := json.Marshal(other["desired"])
	nextDefaults, err := a.Store.DefaultWork(ctx)
	afterDefaults, _ := json.Marshal(nextDefaults)
	if status != 200 || err != nil || !bytes.Equal(beforeB, otherRaw) || !bytes.Equal(beforeDefaults, afterDefaults) {
		t.Fatal("Work A save changed B/defaults", err)
	}
	invalid := after["desired"].(map[string]any)
	invalid["resources"].(map[string]any)["storage_bytes"] = 1024
	status, _ = packageHTTPCall(t, base, path, "PUT", auth, map[string]any{"configuration": invalid})
	if status != 400 {
		t.Fatal("unsupported hard storage quota accepted", status)
	}
	status, unchanged := packageHTTPCall(t, base, path, "GET", auth, nil)
	if status != 200 || unchanged["desired"].(map[string]any)["agentsMd"] != "# last authorized write" {
		t.Fatal(unchanged)
	}
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+b+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-B"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	options := a.options
	options.Initialization = Initialization{}
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	a, _, _ = appFixture(t, options)
	for deadline := time.Now().Add(time.Minute); ; time.Sleep(100 * time.Millisecond) {
		workA, errA := a.Store.Work(ctx, id, false)
		workB, errB := a.Store.Work(ctx, b, false)
		if errA != nil || errB != nil {
			t.Fatal(errA, errB)
		}
		if workA.ObservedState == "ready" && workB.DesiredState == "stopped" && workB.ObservedState == "stopped" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("mixed running/stopped identities not recovered", workA, workB)
		}
	}
	t.Log("ordered public writes remain scoped; rejected storage quota preserves desired; same IDs recover A running and B stopped")
}
