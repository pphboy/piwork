//go:build integration

package coreapp

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/dockerengine"
)

func TestNativeServiceContentLogsAreBoundedAndNeverSubstituteInstances(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	script := `const http=require('node:http');console.log('TRACEBACK user application');console.log('x'.repeat(100000));console.log('TAIL-marker password=private-value');http.createServer((req,res)=>res.end('ready')).listen(8099,'0.0.0.0');`
	definition := map[string]any{"name": "noisy-logs", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "containerPort": 8099, "protocol": "tcp"}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": 10000}}
	path := "/api/v1/works/" + id + "/services"
	status, accepted := packageHTTPCall(t, base, path, "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "noisy-instance"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	service := accepted["serviceId"].(string)
	logPath := path + "/" + service + "/logs"
	status, logs := packageHTTPCall(t, base, logPath, "GET", auth, nil)
	text, _ := logs["text"].(string)
	if status != 200 || logs["status"] != "truncated" || logs["truncated"] != true || len(text) > 64<<10 || !strings.Contains(text, "TAIL-marker") || strings.Contains(text, "private-value") {
		t.Fatal("application log tail not bounded/redacted", status, logs["status"], len(text))
	}
	status, tail := packageHTTPCall(t, base, logPath+"?tailLines=1", "GET", auth, nil)
	if status != 200 || tail["status"] != "available" || !strings.Contains(tail["text"].(string), "TAIL-marker") || strings.Contains(tail["text"].(string), "TRACEBACK") {
		t.Fatal("tail count ignored", status, tail)
	}
	for _, query := range []string{"0", "201"} {
		if status, _ := packageHTTPCall(t, base, logPath+"?tailLines="+query, "GET", auth, nil); status != 400 {
			t.Fatal("log limit accepted", query, status)
		}
	}
	status, stopped := packageHTTPCall(t, base, path+"/"+service+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-logs"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	if status, logs := packageHTTPCall(t, base, logPath, "GET", auth, nil); status != 200 || logs["status"] != "truncated" {
		t.Fatal("stopped instance logs lost", status, logs)
	}
	original, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: id, Kind: "service", LogicalID: service})
	if err != nil || original == nil {
		t.Fatal(err)
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
	// This exact test instance is removed; a same-name/labels/image lookalike
	// must not replace its retained log authority.
	if _, err := raw.ContainerRemove(ctx, original.ID, client.ContainerRemoveOptions{Force: true}); err != nil {
		t.Fatal(err)
	}
	replacement, err := raw.ContainerCreate(ctx, client.ContainerCreateOptions{Name: strings.TrimPrefix(original.Name, "/"), Config: original.Config, HostConfig: original.HostConfig})
	if err != nil {
		t.Fatal(err)
	}
	var retirement sync.Once
	retire := func() {
		retirement.Do(func() {
			cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if _, err := raw.ContainerRemove(cleanup, replacement.ID, client.ContainerRemoveOptions{Force: true}); err != nil {
				t.Error(err)
			}
		})
	}
	t.Cleanup(retire)
	status, logs = packageHTTPCall(t, base, logPath, "GET", auth, nil)
	if status != 200 || logs["status"] != "unavailable" || logs["text"] != "" {
		t.Fatal("lookalike substituted for retained instance", status, logs)
	}
	// Retire the fixture lookalike before Core's normal resource shutdown.
	retire()
	t.Log("bounded owner content, stopped log retention and exact instance refusal", service)
}
