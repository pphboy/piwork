//go:build integration

package coreapp

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestNativeServiceExitDiagnosisAndWorkRecovery(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	image := a.options.Initialization.Runtime.AgentImage
	status, stable := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{
		"definition": map[string]any{"name": "stable", "image": map[string]string{"reference": image}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/", "restartPolicy": "never"}, "idempotencyKey": "stable",
	})
	if status != 202 {
		t.Fatal(status, stable)
	}
	waitWorkOperation(t, ctx, a, stable["operationId"].(string))
	for _, afterReady := range []bool{false, true} {
		for _, exitCode := range []int{0, 7} {
			name := fmt.Sprintf("exit-%t-%d", afterReady, exitCode)
			delay := 400
			definition := map[string]any{"name": name, "image": map[string]string{"reference": image}, "command": "node", "workingDirectory": "/", "restartPolicy": "never"}
			if afterReady {
				delay = 2500
			} else {
				definition["ports"] = []any{map[string]any{"name": "http", "containerPort": 8099, "protocol": "tcp"}}
				definition["readiness"] = map[string]any{"kind": "http", "portName": "http", "path": "/health", "deadlineMs": 5000}
			}
			definition["args"] = []string{"-e", fmt.Sprintf("setTimeout(()=>process.exit(%d),%d)", exitCode, delay)}
			status, created := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": name})
			if status != 202 {
				t.Fatal(status, created)
			}
			operationID, serviceID := created["operationId"].(string), created["serviceId"].(string)
			if afterReady {
				waitWorkOperation(t, ctx, a, operationID)
			} else {
				waitApplyFailure(t, ctx, a, operationID)
			}
			deadline := time.Now().Add(20 * time.Second)
			for {
				status, service := packageHTTPCall(t, base, path+"/services/"+serviceID, "GET", auth, nil)
				diagnostic, _ := service["lastError"].(map[string]any)
				if status == 200 && service["observedState"] == "failed" && diagnostic["code"] == "SERVICE_EXITED" {
					if diagnostic["exitCode"] != float64(exitCode) {
						t.Fatal("wrong confirmed exit", service)
					}
					wantStage := "service-readiness"
					if afterReady {
						wantStage = "service-recovery"
					}
					if diagnostic["stage"] != wantStage {
						t.Fatal("wrong exit phase", service)
					}
					break
				}
				if time.Now().After(deadline) || ctx.Err() != nil {
					t.Fatal("service exit diagnosis not observed", status, service, ctx.Err())
				}
				time.Sleep(100 * time.Millisecond)
			}
			status, work := packageHTTPCall(t, base, path, "GET", auth, nil)
			if status != 200 || work["observedState"] != "degraded" {
				t.Fatal("failed optional service did not degrade Work", status, work)
			}
			status, other := packageHTTPCall(t, base, path+"/services/"+stable["serviceId"].(string), "GET", auth, nil)
			if status != 200 || other["observedState"] != "ready" {
				t.Fatal("unrelated service not ready", status, other)
			}
			if status, _ := packageHTTPCall(t, base, path+"/sessions", "GET", auth, nil); status != 200 {
				t.Fatal("Agent unavailable while Work degraded", status)
			}
			if afterReady {
				operation, err := a.Store.Operation(ctx, operationID)
				if err != nil || operation.State != "succeeded" {
					t.Fatal("later exit rewrote create operation", operation, err)
				}
			}
			status, removed := packageHTTPCall(t, base, path+"/services/"+serviceID+"/remove", "POST", auth, map[string]string{"idempotencyKey": "remove-" + name})
			if status != 202 {
				t.Fatal(status, removed)
			}
			waitWorkOperation(t, ctx, a, removed["operationId"].(string))
			status, work = packageHTTPCall(t, base, path, "GET", auth, nil)
			if status != 200 || work["observedState"] != "ready" {
				t.Fatal("Work did not recover after removal", status, work)
			}
		}
	}
}

func TestNativeServiceReadinessFailureAndWorkStopFence(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	script := `const http=require('node:http');const server=http.createServer((req,res)=>{res.writeHead(503);res.end('unready');});server.listen(8099,'0.0.0.0');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`
	definition := func(name string, deadline int) map[string]any {
		return map[string]any{"name": name, "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "containerPort": 8099, "protocol": "tcp"}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": deadline}}
	}
	status, created := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition("unready", 1000), "idempotencyKey": "unready"})
	if status != 202 {
		t.Fatal(status, created)
	}
	failed := waitApplyFailure(t, ctx, a, created["operationId"].(string))
	if failed.ErrorJSON == nil || !strings.Contains(*failed.ErrorJSON, "SERVICE_READINESS_TIMEOUT") {
		t.Fatal("running process became ready without 2xx probe", failed.ErrorJSON)
	}
	status, view := packageHTTPCall(t, base, path+"/services/"+created["serviceId"].(string), "GET", auth, nil)
	if status != 200 || (view["observedState"] != "failed" && view["observedState"] != "recovering") || view["access"].(map[string]any)["status"] != "unavailable" {
		t.Fatal("failure projection", status, view)
	}
	status, work := packageHTTPCall(t, base, path, "GET", auth, nil)
	if status != 200 || work["observedState"] != "degraded" {
		t.Fatal("optional application removed repair surface", status, work)
	}
	status, _ = packageHTTPCall(t, base, path+"/sessions", "GET", auth, nil)
	if status != 200 {
		t.Fatal("degraded Work chat unavailable", status)
	}
	status, removed := packageHTTPCall(t, base, path+"/services/"+created["serviceId"].(string)+"/remove", "POST", auth, map[string]string{"idempotencyKey": "remove-unready"})
	if status != 202 {
		t.Fatal(status, removed)
	}
	waitWorkOperation(t, ctx, a, removed["operationId"].(string))
	status, slow := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition("slow", 30000), "idempotencyKey": "slow"})
	if status != 202 {
		t.Fatal(status, slow)
	}
	waitServiceStarting(t, a, ctx, workID, slow["serviceId"].(string))
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-during-readiness"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	operation, err := a.Store.Operation(ctx, slow["operationId"].(string))
	if err != nil || operation.State != "superseded" {
		t.Fatal("late readiness overwrote Work stop", operation.State, err)
	}
	service, err := a.Store.Service(ctx, workID, slow["serviceId"].(string), false)
	actual, _, inspectErr := a.inspectServiceRuntime(ctx, workID, service.ServiceID)
	if err != nil || inspectErr != nil || !service.Enabled || service.ObservedState != "stopped" || actual != nil && actual.State.Running {
		t.Fatal("Work Stop service effects", service, err, inspectErr)
	}
	status, deleted := packageHTTPCall(t, base, path+"/delete", "POST", auth, map[string]string{"idempotencyKey": "delete-service-work"})
	if status != 202 {
		t.Fatal(status, deleted)
	}
	waitWorkOperation(t, ctx, a, deleted["operationId"].(string))
	actual, _, inspectErr = a.inspectServiceRuntime(ctx, workID, service.ServiceID)
	if inspectErr != nil || actual != nil {
		t.Fatal("Work delete left Service container", inspectErr)
	}
}

func waitServiceStarting(t *testing.T, a *Application, ctx context.Context, workID, serviceID string) {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		view, _, err := a.inspectServiceRuntime(ctx, workID, serviceID)
		if err == nil && view != nil && view.State != nil && view.State.Running {
			return
		}
		if ctx.Err() != nil {
			t.Fatal(ctx.Err())
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("service process did not start")
}
