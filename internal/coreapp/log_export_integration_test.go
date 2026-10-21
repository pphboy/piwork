//go:build integration

package coreapp

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func createLogExportHTTP(t *testing.T, base, auth, key string) string {
	t.Helper()
	status, accepted := packageHTTPCall(t, base, "/api/v1/log-exports", "POST", auth, map[string]string{"idempotencyKey": key})
	if status != 202 {
		t.Fatal("export acceptance failed", status, accepted)
	}
	id, _ := accepted["exportId"].(string)
	if id == "" {
		t.Fatal("missing export ID", accepted)
	}
	return id
}

func waitLogExportHTTP(t *testing.T, base, auth, id string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		status, view := packageHTTPCall(t, base, "/api/v1/log-exports/"+id, "GET", auth, nil)
		if status != 200 {
			t.Fatal("export status failed", status, view)
		}
		switch view["state"] {
		case "ready":
			return view
		case "failed", "interrupted":
			t.Fatal("export did not complete", view)
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("export did not become ready")
	return nil
}

func downloadLogExportHTTP(t *testing.T, base, auth, id string, view map[string]any) (*zip.Reader, map[string][]byte) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, base+"/api/v1/log-exports/"+id+"/content", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", auth)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<30))
	if err != nil || response.StatusCode != 200 {
		t.Fatal("download failed", response.StatusCode, err)
	}
	result := view["result"].(map[string]any)
	sum := sha256.Sum256(raw)
	if response.Header.Get("Content-Type") != "application/zip" || response.Header.Get("X-Piwork-SHA256") != result["digest"] ||
		hex.EncodeToString(sum[:]) != result["digest"] || int64(len(raw)) != int64(result["size"].(float64)) {
		t.Fatal("download metadata mismatch", response.Header, result)
	}
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string][]byte{}
	for _, file := range reader.File {
		content, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(content)
		content.Close()
		entries[file.Name] = data
	}
	return reader, entries
}

func manifestValue(t *testing.T, entries map[string][]byte) map[string]any {
	t.Helper()
	var manifest map[string]any
	if err := json.Unmarshal(entries["manifest.json"], &manifest); err != nil {
		t.Fatal("manifest invalid", err)
	}
	return manifest
}

func TestNativeLogExportCollectsCompleteServiceLogsArchivesAndDeletedWorkOwnership(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	script := `const http=require('node:http');for(let i=0;i<300;i++)console.log('LINE-'+String(i).padStart(3,'0'));console.log('API_KEY=private-value');console.log('TAIL-marker');http.createServer((req,res)=>{res.end('ok')}).listen(8099,'0.0.0.0');`
	definition := map[string]any{
		"name": "log-export-service", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage},
		"command": "node", "args": []string{"-e", script}, "workingDirectory": "/",
		"environment": map[string]string{"API_KEY": "private-value"},
		"ports":       []any{map[string]any{"name": "web", "containerPort": 8099, "protocol": "tcp"}},
		"readiness":   map[string]any{"kind": "http", "portName": "web", "path": "/", "deadlineMs": 10000},
	}
	path := "/api/v1/works/" + workID
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "log-export-service"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	serviceID := accepted["serviceId"].(string)

	exportID := createLogExportHTTP(t, base, auth, "logs-live")
	view := waitLogExportHTTP(t, base, auth, exportID)
	if view["complete"] != true || view["warningCount"].(float64) != 0 {
		t.Fatal("live export unexpectedly incomplete", view)
	}
	_, entries := downloadLogExportHTTP(t, base, auth, exportID, view)
	manifest := manifestValue(t, entries)
	sources := manifest["sources"].([]any)
	if len(sources) < 2 {
		t.Fatalf("expected Agent and Service sources, got %#v", sources)
	}
	foundService := false
	for _, raw := range sources {
		source := raw.(map[string]any)
		if source["serviceId"] != serviceID {
			continue
		}
		foundService = true
		if source["state"] != "available" && source["state"] != "empty" {
			t.Fatalf("service source not available: %#v", source)
		}
		for _, entry := range source["entries"].([]any) {
			if !strings.HasSuffix(entry.(string), "/stdout.log") {
				continue
			}
			text := string(entries[entry.(string)])
			if !strings.Contains(text, "LINE-000") || !strings.Contains(text, "TAIL-marker") {
				t.Fatalf("export did not include complete service output: %q", text)
			}
			if strings.Contains(text, "private-value") || !strings.Contains(text, "[redacted]") {
				t.Fatalf("known credential leaked from service logs: %q", text)
			}
		}
	}
	if !foundService {
		t.Fatal("service source missing from manifest", sources)
	}

	// Service restart must archive the replaced instance before removal and
	// register a new bound source for the replacement.
	status, restarted := packageHTTPCall(t, base, path+"/services/"+serviceID+"/restart", "POST", auth, map[string]string{"idempotencyKey": "restart-log-export-service"})
	if status != 202 {
		t.Fatal(status, restarted)
	}
	waitWorkOperation(t, ctx, a, restarted["operationId"].(string))
	logSources, err := a.Store.LogSources(ctx)
	if err != nil {
		t.Fatal(err)
	}
	archivedService, boundService := false, false
	for _, source := range logSources {
		if source.WorkID != workID || source.ServiceID != serviceID {
			continue
		}
		if source.State == "archived" {
			archivedService = true
		}
		if source.State == "bound" {
			boundService = true
		}
	}
	if !archivedService || !boundService {
		t.Fatalf("Service restart did not archive the original and bind the replacement: archived=%v bound=%v %#v", archivedService, boundService, logSources)
	}

	// Agent Apply replacement uses the same pre-removal archive coordination.
	status, configuration := packageHTTPCall(t, base, path+"/configuration", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, configuration)
	}
	desired := configuration["desired"].(map[string]any)
	desired["agentsMd"] = "archive on apply replacement"
	status, saved := packageHTTPCall(t, base, path+"/configuration", "PUT", auth, map[string]any{"configuration": desired})
	if status != 200 || saved["pendingApply"] != true {
		t.Fatal("apply replacement configuration was not saved", status, saved)
	}
	status, applied := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "apply-log-export-replacement"})
	if status != 202 {
		t.Fatal(status, applied)
	}
	waitWorkOperation(t, ctx, a, applied["operationId"].(string))
	logSources, err = a.Store.LogSources(ctx)
	if err != nil {
		t.Fatal(err)
	}
	archivedAgent, boundAgent := false, false
	for _, source := range logSources {
		if source.WorkID != workID || source.Kind != "agent" {
			continue
		}
		if source.State == "archived" {
			archivedAgent = true
		}
		if source.State == "bound" {
			boundAgent = true
		}
	}
	if !archivedAgent || !boundAgent {
		t.Fatalf("Apply replacement did not archive the original Agent and bind the replacement: archived=%v bound=%v %#v", archivedAgent, boundAgent, logSources)
	}

	status, stopped := packageHTTPCall(t, base, path+"/services/"+serviceID+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-log-export"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	archivedID := createLogExportHTTP(t, base, auth, "logs-archived")
	archivedView := waitLogExportHTTP(t, base, auth, archivedID)
	_, archivedEntries := downloadLogExportHTTP(t, base, auth, archivedID, archivedView)
	archivedManifest := manifestValue(t, archivedEntries)
	archivedComplete := false
	for _, raw := range archivedManifest["sources"].([]any) {
		source := raw.(map[string]any)
		if source["serviceId"] != serviceID {
			continue
		}
		if content, ok := archivedEntries["works/"+workID+"/"+source["sourceId"].(string)+"/stdout.log"]; ok && strings.Contains(string(content), "TAIL-marker") {
			archivedComplete = true
		}
	}
	if !archivedComplete {
		t.Fatal("stopped instance archive was not exported", archivedManifest)
	}

	status, deleted := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/delete", "POST", auth, map[string]string{"idempotencyKey": "delete-log-export-work"})
	if status != 202 {
		t.Fatal(status, deleted)
	}
	waitWorkOperation(t, ctx, a, deleted["operationId"].(string))
	deletedID := createLogExportHTTP(t, base, auth, "logs-deleted-work")
	deletedView := waitLogExportHTTP(t, base, auth, deletedID)
	_, deletedEntries := downloadLogExportHTTP(t, base, auth, deletedID, deletedView)
	deletedManifest := manifestValue(t, deletedEntries)
	if deletedView["complete"] != true {
		t.Fatal("deleted Work archive made the export incomplete", deletedView)
	}
	found := false
	for _, raw := range deletedManifest["sources"].([]any) {
		source := raw.(map[string]any)
		if source["workId"] != workID || source["serviceId"] != serviceID {
			continue
		}
		content := deletedEntries["works/"+workID+"/"+source["sourceId"].(string)+"/stdout.log"]
		if strings.Contains(string(content), "TAIL-marker") {
			found = true
		}
	}
	if !found {
		t.Fatal("deleted Work archive lost its original owner scope", deletedManifest)
	}
}
