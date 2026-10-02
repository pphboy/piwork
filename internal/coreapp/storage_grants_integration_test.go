//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"strings"
	"testing"
	"time"
)

func TestNativeImageNativeServiceAndMissingWorkspaceFailClosed(t *testing.T) {
	a, base, auth, work, ctx := nativeApplyFixture(t)
	owner, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	principal := owner.Principal()
	script := `const fs=require('fs'),http=require('http');if(process.cwd()!=='/'||fs.existsSync('/var/data/private-test'))throw Error('unsafe cwd or private mount');http.createServer((q,r)=>r.end('image-native')).listen(8088,'0.0.0.0');`
	payload, _ := json.Marshal(map[string]any{"name": "image-native", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "workingDirectory": "/", "mounts": []any{}, "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8088}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/", "deadlineMs": 10000}})
	accepted, err := a.acceptServiceDefinition(ctx, serviceActor{User: &principal}, work, "", 0, payload, "image-native")
	if err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.processServiceOperation(ctx, operation); err != nil {
		t.Fatal(err)
	}
	operation, err = a.Store.Operation(ctx, accepted.OperationID)
	if err != nil || operation.State != "succeeded" {
		t.Fatal(operation, err)
	}
	view, _, err := a.inspectServiceRuntime(ctx, work, accepted.ServiceID)
	if err != nil || view == nil || !view.State.Running || view.Config.WorkingDir != "/" {
		t.Fatal(view, err)
	}
	for _, m := range view.Mounts {
		if m.Type == "volume" || m.Destination == "/var/data" || m.Destination == "/var/data/workspace" {
			t.Fatal("image-native service gained data volume", m)
		}
	}
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+work+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-storage"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	if err := a.stopServiceRuntime(ctx, work, accepted.ServiceID, true); err != nil {
		t.Fatal(err)
	}
	if err := a.dockerRuntime.RemoveContainer(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"}); err != nil {
		t.Fatal(err)
	}
	var binding corestore.ResourceBinding
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, err = corestore.ReadResourceBinding(tx, a.Store.InstallationID(), work, "volume", "work-workspace")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.dockerRuntime.RemoveVolume(ctx, binding.RuntimeID, work, "work-workspace"); err != nil {
		t.Fatal(err)
	}
	status, started := packageHTTPCall(t, base, "/api/v1/works/"+work+"/start", "POST", auth, map[string]string{"idempotencyKey": "missing-storage-start"})
	if status != 202 {
		t.Fatal(status, started)
	}
	failed := waitApplyFailure(t, ctx, a, started["operationId"].(string))
	if failed.ErrorJSON == nil || !strings.Contains(*failed.ErrorJSON, "CONTEXT_NOT_FOUND") {
		t.Fatal("missing storage lacks stable diagnostic", failed)
	}
	if _, err := a.dockerRuntime.InspectVolume(ctx, binding.RuntimeID, work, "work-workspace"); !errors.Is(err, dockerengine.ErrResourceMissing) {
		t.Fatal("missing volume silently recreated", err)
	}
	opts := a.options
	opts.Initialization = Initialization{}
	shutdown, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	if err := a.Close(shutdown); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	next, nextBase, _ := appFixture(t, opts)
	restored, err := next.Store.Work(ctx, work, false)
	if err != nil || restored.ObservedState == "ready" {
		t.Fatal("missing data reported recovered", restored, err)
	}
	if _, err := next.dockerRuntime.InspectVolume(ctx, binding.RuntimeID, work, "work-workspace"); !errors.Is(err, dockerengine.ErrResourceMissing) {
		t.Fatal("recovery created blank workspace", err)
	}
	request, _ := http.NewRequestWithContext(ctx, "OPTIONS", nextBase+"/api/v1/works/"+work+"/files/", nil)
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode == 200 {
		t.Fatal("files available with missing volume")
	}
	t.Log("actual image-native cwd and mounts; removed workspace retained durable identity, start/recovery fail closed without creating empty replacement")
}
