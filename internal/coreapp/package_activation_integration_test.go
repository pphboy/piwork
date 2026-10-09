//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/workcontext"
)

// Actual Engine and retained SDK exercise package activation independently of
// preparation. A new desired artifact must never change the running loader.
func TestNativePackageActivationRestartRollbackAndStoppedApply(t *testing.T) {
	a, base, auth, id, _ := nativeApplyFixture(t)
	// This scenario includes several real Apply failures, restarts and a Core
	// reopen. Its observation budget must cover the whole scenario, independently
	// of the shorter installation fixture; product timeouts stay unchanged.
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	path := "/api/v1/works/" + id
	name := "activation-tools"
	entryPath := path + "/packages/" + url.PathEscape(name)
	upload := func(version, extension string) string {
		t.Helper()
		data := packageZip(t, map[string]string{"package.json": `{"name":"activation-tools","version":"` + version + `","pi":{"extensions":["tool.js"]}}`, "tool.js": extension})
		digest := sha256.Sum256(data)
		req, err := http.NewRequestWithContext(ctx, "POST", base+path+"/package-uploads", bytes.NewReader(data))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", auth)
		req.Header.Set("Content-Type", "application/zip")
		req.Header.Set("X-Piwork-Sha256", hex.EncodeToString(digest[:]))
		req.Header.Set("X-Piwork-Package-Source", "zip")
		req.Header.Set("X-Piwork-Package-Name", "activation.zip")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		var result map[string]any
		if json.NewDecoder(res.Body).Decode(&result) != nil || res.StatusCode != 201 {
			t.Fatal(res.StatusCode, result)
		}
		return result["uploadId"].(string)
	}
	mutate := func(endpoint, key string) {
		t.Helper()
		status, result := packageHTTPCall(t, base, endpoint, "POST", auth, map[string]string{"idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
	}
	install := func(kind, version, extension, key string) {
		t.Helper()
		endpoint := path + "/packages"
		if kind == "update" {
			endpoint = entryPath + "/update"
		}
		status, result := packageHTTPCall(t, base, endpoint, "POST", auth, map[string]any{"source": map[string]string{"kind": "upload", "uploadId": upload(version, extension)}, "idempotencyKey": key})
		if status != 202 {
			t.Fatal(status, result)
		}
		waitWorkOperation(t, ctx, a, result["operationId"].(string))
	}
	view := func() map[string]any {
		t.Helper()
		status, result := packageHTTPCall(t, base, entryPath, "GET", auth, nil)
		if status != 200 {
			t.Fatal(status, result)
		}
		return result
	}
	tool := func(version string) string {
		return `export default function(pi){pi.registerTool({name:'activation_hello',label:'Hello',description:'hello',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'` + version + `'}]})});}`
	}
	install("install", "1.0.0", tool("v1"), "install-v1")
	mutate(path+"/configuration/apply", "activate-v1")
	v := view()
	if v["active"].(map[string]any)["version"] != "1.0.0" || v["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal(v)
	}
	install("update", "2.0.0", tool("v2"), "update-v2")
	mutate(path+"/stop", "stop-pending-v2")
	mutate(path+"/start", "start-pending-v2")
	v = view()
	if v["active"].(map[string]any)["version"] != "1.0.0" || v["desired"].(map[string]any)["version"] != "2.0.0" || v["pendingApply"] != true || v["runtime"].(map[string]any)["loaded"] != true {
		t.Fatal("restart implicitly applied", v)
	}
	mutate(path+"/configuration/apply", "activate-v2")
	v = view()
	if v["active"].(map[string]any)["version"] != "2.0.0" || v["pendingApply"] != false {
		t.Fatal(v)
	}
	// Same name/version with different bytes is a new captured artifact. It is
	// valid at import/preparation but fails the actual SDK extension parser.
	install("update", "2.0.0", "export default }", "update-broken-same-version")
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "activate-broken"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	failed := waitApplyFailure(t, ctx, a, accepted["operationId"].(string))
	if failed.ErrorJSON == nil {
		t.Fatal(failed)
	}
	v = view()
	if v["active"].(map[string]any)["version"] != "2.0.0" || v["runtime"].(map[string]any)["loaded"] != true || v["pendingApply"] != true {
		t.Fatal("broken candidate replaced prior loader", v)
	}
	// Explicit retry without changing the broken selection fails again; the
	// successful active artifact and its owned bytes remain recoverable.
	status, retry := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "retry-broken"})
	if status != 202 {
		t.Fatal(status, retry)
	}
	waitApplyFailure(t, ctx, a, retry["operationId"].(string))
	install("update", "3.0.0", tool("v3"), "update-v3")
	mutate(path+"/stop", "stop-before-apply-v3")
	mutate(path+"/configuration/apply", "apply-stopped-v3")
	work, err := a.Store.Work(ctx, id, false)
	if err != nil || work.DesiredState != "stopped" || work.ObservedState != "stopped" {
		t.Fatal("stopped apply started Work", work, err)
	}
	v = view()
	if v["active"].(map[string]any)["version"] != "3.0.0" || v["pendingApply"] != false || v["runtime"].(map[string]any)["loaded"] == true {
		t.Fatal(v)
	}
	mutate(path+"/start", "start-v3")
	// Reopen adopts/verifies the captured package, without retrieving its source.
	options := a.options
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	a, base, _ = appFixture(t, options)
	for deadline := time.Now().Add(45 * time.Second); ; {
		v = view()
		if v["runtime"].(map[string]any)["loaded"] == true {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal(v)
		}
		time.Sleep(100 * time.Millisecond)
	}
	state, err := a.Store.Configuration(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	metadata, err := workcontext.Metadata(a.Store, id, *state.ActiveContextID)
	if err != nil || len(metadata.PackageBindings) != 2 {
		t.Fatal(metadata, err)
	}
	owned := filepath.Join(options.DataDirectory, "works", id, "contexts", *state.ActiveContextID, "packages", contracts.PackageNameKey(name), "tool.js")
	if data, err := os.ReadFile(owned); err != nil || string(data) != tool("v3") {
		t.Fatal("owned package changed during reopen", err)
	}
	t.Log("v1 retained on pending v2 restart; v2 explicit apply; same-version broken candidate and retry roll back; stopped v3 apply, start and Core reopen preserve own artifact")
}
