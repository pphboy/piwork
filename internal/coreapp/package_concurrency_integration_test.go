//go:build integration

package coreapp

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestNativePackageQueueModelMergeFreshRetryAndFutureDefaults(t *testing.T) {
	a, base, auth, workA, ctx := nativeApplyFixture(t)
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Queue B", "idempotencyKey": "queue-B"})
	if status != 202 {
		t.Fatal(status, created)
	}
	workB := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	upload := func(scope, version, script string) string {
		t.Helper()
		manifest, _ := json.Marshal(map[string]any{"name": "queue-tools", "version": version, "pi": map[string]any{"prompts": []string{"review.md"}}, "scripts": map[string]string{"postinstall": script}})
		data := packageZip(t, map[string]string{"package.json": string(manifest), "review.md": "Review this version."})
		sum := sha256.Sum256(data)
		req, _ := http.NewRequestWithContext(ctx, "POST", base+scope+"/package-uploads", bytes.NewReader(data))
		req.Header.Set("Authorization", auth)
		req.Header.Set("Content-Type", "application/zip")
		req.Header.Set("X-Piwork-Sha256", hex.EncodeToString(sum[:]))
		req.Header.Set("X-Piwork-Package-Source", "zip")
		req.Header.Set("X-Piwork-Package-Name", "queue.zip")
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
	install := func(scope, uploadID, key string, update, defaults bool) string {
		t.Helper()
		endpoint := scope + "/packages"
		body := map[string]any{"source": map[string]string{"kind": "upload", "uploadId": uploadID}, "idempotencyKey": key}
		if update {
			endpoint += "/queue-tools/update"
		} else if scope == "/api/v1/admin" {
			body["addToDefaults"] = defaults
		}
		status, result := packageHTTPCall(t, base, endpoint, "POST", auth, body)
		if status != 202 {
			t.Fatal(status, result)
		}
		return result["operationId"].(string)
	}
	scopeA, scopeB, scopeCore := "/api/v1/works/"+workA, "/api/v1/works/"+workB, "/api/v1/admin"
	slow := `node -e "setTimeout(()=>{},30000)"`
	first := install(scopeA, upload(scopeA, "1.0.0", slow), "first-slow", false, false)
	second := install(scopeCore, upload(scopeCore, "1.0.0", slow), "second-slow", false, true)
	for deadline := time.Now().Add(25 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		running := 0
		views, err := a.dockerRuntime.ListContainers(ctx, "package-helper")
		if err != nil {
			t.Fatal(err)
		}
		for _, v := range views {
			if v.Config.Labels[dockerengine.KindLabel] == "package-helper" && v.Config.Labels["piwork.package_action"] == "prepare" && v.State.Running {
				running++
			}
		}
		if running == 2 {
			break
		}
		if running > 2 || time.Now().After(deadline) {
			t.Fatal("two actual preparation environments did not run", running)
		}
	}
	third := install(scopeB, upload(scopeB, "1.0.0", "node -e \"process.exit(0)\""), "third-queued", false, false)
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		job, err := corestore.ReadPackageJob(tx, third)
		if err == nil && job.Phase != "queued" {
			t.Fatal("third preparation exceeded capacity", job.Phase)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, third)
	if err != nil || operation.State != "pending" {
		t.Fatal(operation, err)
	}
	// Capture a new model reference while package preparation owns no config lock.
	runtime := *a.options.Initialization.Runtime
	if _, err := a.Settings.ConfigureRuntime(runtime); err != nil {
		t.Fatal(err)
	}
	profile, exists, err := a.Settings.LoadRuntime()
	if err != nil || !exists {
		t.Fatal(err)
	}
	if err := a.ensureRuntimeCatalog(ctx, profile); err != nil {
		t.Fatal(err)
	}
	status, view := packageHTTPCall(t, base, scopeA+"/configuration", "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, view)
	}
	config := view["desired"].(map[string]any)
	config["modelRef"] = runtimeModelCatalogID(profile.Revision)
	status, view = packageHTTPCall(t, base, scopeA+"/configuration", "PUT", auth, map[string]any{"configuration": config})
	if status != 200 {
		t.Fatal(status, view)
	}
	for _, id := range []string{first, second, third} {
		waitWorkOperation(t, ctx, a, id)
	}
	status, view = packageHTTPCall(t, base, scopeA+"/configuration", "GET", auth, nil)
	desired := view["desired"].(map[string]any)
	if status != 200 || desired["modelRef"] != string(runtimeModelCatalogID(profile.Revision)) || len(desired["packages"].([]any)) != 2 || view["pendingApply"] != true {
		t.Fatal("package publication overwrote latest model", view)
	}
	value, _ := a.workLocks.LoadOrStore(workA, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	status, apply := packageHTTPCall(t, base, scopeA+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "apply-captured-package"})
	if status != 202 {
		lock.Unlock()
		t.Fatal(status, apply)
	}
	status, view = packageHTTPCall(t, base, scopeA+"/packages/queue-tools/disable", "POST", auth, nil)
	lock.Unlock()
	if status != 200 {
		t.Fatal(status, view)
	}
	waitWorkOperation(t, ctx, a, apply["operationId"].(string))
	status, view = packageHTTPCall(t, base, scopeA+"/packages/queue-tools", "GET", auth, nil)
	if status != 200 || view["active"].(map[string]any)["enabled"] != true || view["desired"].(map[string]any)["enabled"] != false || view["pendingApply"] != true {
		t.Fatal("Apply discarded later disable", view)
	}
	installV2 := install(scopeCore, upload(scopeCore, "2.0.0", "node -e \"process.exit(0)\""), "core-v2", true, false)
	waitWorkOperation(t, ctx, a, installV2)
	status, future := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Future v2", "idempotencyKey": "future-v2"})
	if status != 202 {
		t.Fatal(status, future)
	}
	waitWorkOperation(t, ctx, a, future["operationId"].(string))
	status, newView := packageHTTPCall(t, base, "/api/v1/works/"+future["workId"].(string)+"/packages/queue-tools", "GET", auth, nil)
	if status != 200 || newView["active"].(map[string]any)["version"] != "2.0.0" {
		t.Fatal("future Work did not capture Core v2", newView)
	}
	_, oldView := packageHTTPCall(t, base, scopeA+"/packages/queue-tools", "GET", auth, nil)
	if oldView["active"].(map[string]any)["version"] != "1.0.0" || oldView["desired"].(map[string]any)["version"] != "1.0.0" {
		t.Fatal("catalog update rewrote earlier Work", oldView)
	}
	failedUpload := upload(scopeB, "3.0.0", "node -e \"process.exit(1)\"")
	failedID := install(scopeB, failedUpload, "failed-preparation", true, false)
	waitApplyFailure(t, ctx, a, failedID)
	if replay := install(scopeB, failedUpload, "failed-preparation", true, false); replay != failedID {
		t.Fatal("failed key executed twice")
	}
	retry := install(scopeB, failedUpload, "explicit-new-preparation", true, false)
	if retry == failedID {
		t.Fatal("new key did not prepare again")
	}
	waitApplyFailure(t, ctx, a, retry)
	// Failed replacement cannot alter the existing frozen head.
	_, retained := packageHTTPCall(t, base, scopeB+"/packages/queue-tools", "GET", auth, nil)
	if retained["desired"].(map[string]any)["version"] != "1.0.0" {
		t.Fatal(retained)
	}
	t.Log("two actual helpers; third durable pending; model Save merged; later disable pending; future defaults v2 retain A v1; failed key replay and new preparation verified")
}
