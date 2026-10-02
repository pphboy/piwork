//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
)

// Exercises the native history copier before the full import coordinator:
// only freshly generated fixture Works/volumes are replaced. This is not an
// export/import product gate; it proves real retained TS SDK continuation.
func TestNativeSnapshotHistoryRebuildContinuesRealTSSDKSession(t *testing.T) {
	a, base, auth, source, ctx := nativeApplyFixture(t)
	helper := os.Getenv("PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE")
	if helper == "" {
		t.Fatal("native snapshot helper image required")
	}
	image, err := a.engine.InspectImage(ctx, helper)
	if err != nil {
		t.Fatal(err)
	}
	capabilities, err := a.inspector.InspectNativeSnapshotHelper(ctx, image.ID)
	if err != nil || !capabilities.SnapshotHelper {
		t.Fatal(capabilities, err)
	}
	spool := filepath.Join(a.options.DataDirectory, "snapshot-history-test")
	if err := os.Mkdir(spool, 0700); err != nil {
		t.Fatal(err)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config := *defaults.Configuration
	config.McpServers = []contracts.McpServer{}
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Snapshot History Target", "idempotencyKey": "history-target", "configuration": config})
	if status != 202 {
		t.Fatal(status, created)
	}
	target := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	status, session := packageHTTPCall(t, base, "/api/v1/works/"+source+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "snapshot-history-session"})
	if status != 201 {
		t.Fatal(status, session)
	}
	sessionID := session["sessionId"].(string)
	run := func(work, key string) string {
		t.Helper()
		path := "/api/v1/works/" + work
		status, submitted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]any{"sessionId": sessionID, "submissionKey": key, "prompt": "native snapshot history continuation"})
		if status != 202 {
			t.Fatal(status, submitted)
		}
		runID := submitted["run"].(map[string]any)["runId"].(string)
		request, err := http.NewRequestWithContext(ctx, "GET", base+path+"/runs/"+runID+"/events", nil)
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", auth)
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		_, readErr := io.Copy(io.Discard, response.Body)
		response.Body.Close()
		if response.StatusCode != 200 || readErr != nil {
			t.Fatal(response.StatusCode, readErr)
		}
		status, result := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
		if status != 200 || result["state"] != float64(4) {
			t.Fatal("SDK run failed", status, result)
		}
		return runID
	}
	sourceRun := run(source, "snapshot-source-run")
	sourceWork, err := a.Store.Work(ctx, source, false)
	if err != nil || sourceWork.ActiveContextID == nil {
		t.Fatal(err)
	}
	targetWork, err := a.Store.Work(ctx, target, false)
	if err != nil || targetWork.ActiveContextID == nil {
		t.Fatal(err)
	}
	control := func(work, action string) {
		t.Helper()
		status, accepted := packageHTTPCall(t, base, "/api/v1/works/"+work+"/"+action, "POST", auth, map[string]string{"idempotencyKey": "snapshot-history-" + action})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		for {
			operation, err := a.Store.Operation(ctx, accepted["operationId"].(string))
			if err != nil {
				t.Fatal(err)
			}
			if operation.State == "succeeded" {
				break
			}
			if operation.State == "failed" {
				if operation.ErrorJSON != nil {
					t.Log("Work failure:", *operation.ErrorJSON)
				}
				view, _ := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"})
				if view != nil {
					logs, _ := a.dockerRuntime.Logs(ctx, dockerengine.ContainerIdentity{WorkID: work, Kind: "agent", LogicalID: "agentd"}, 30, view.ID)
					t.Log("Agent failure logs:", logs.Text)
				}
				t.Fatal("history continuation Work action failed", action)
			}
			select {
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-time.After(50 * time.Millisecond):
			}
		}
	}
	control(source, "stop")
	control(target, "stop")
	sequence := 0
	helperRun := func(work, volume, logical, action, digest string) json.RawMessage {
		t.Helper()
		sequence++
		spec := dockerengine.SnapshotHelperSpec{WorkID: work, JobID: "snapshot-history-test-123456", AttemptID: fmt.Sprintf("history-attempt-%08d", sequence), Epoch: 1, ImageID: image.ID, SpoolDirectory: spool, VolumeName: volume, VolumeLogicalID: logical, Action: action, TreeDigest: digest}
		ensured, err := a.dockerRuntime.EnsureSnapshotHelper(ctx, spec)
		if err != nil {
			t.Fatal(action, "create", err)
		}
		output, err := a.dockerRuntime.RunSnapshotHelper(ctx, spec)
		if err != nil {
			t.Fatal(action, "run", err)
		}
		if err := a.dockerRuntime.RemoveSnapshotHelper(ctx, spec, ensured.ID); err != nil {
			t.Fatal(action, "remove", err)
		}
		return output
	}
	sourceVolume := dockerengine.ManagedVolumeName(a.Store.InstallationID(), source, "work-private")
	targetVolume := dockerengine.ManagedVolumeName(a.Store.InstallationID(), target, "work-private")
	request := map[string]any{"sourceWorkId": source, "contextIds": []string{*sourceWork.ActiveContextID}}
	writeRequest := func() {
		t.Helper()
		raw, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(spool, "history-request.json"), raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeRequest()
	var summary struct {
		HistoryPresent         bool
		Sessions, Runs, Events int64
	}
	if err := json.Unmarshal(helperRun(source, sourceVolume, "work-private", "verify-history", ""), &summary); err != nil || !summary.HistoryPresent || summary.Sessions != 1 || summary.Runs != 1 {
		t.Fatal(summary, err)
	}
	var captured struct{ Tree string }
	if err := json.Unmarshal(helperRun(source, sourceVolume, "work-private", "capture", ""), &captured); err != nil {
		t.Fatal(err)
	}
	if err := a.dockerRuntime.RemoveContainer(ctx, dockerengine.ContainerIdentity{WorkID: target, Kind: "agent", LogicalID: "agentd"}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.ReleaseResourceIntent(ctx, target, "agent", "agentd", true); err != nil {
		t.Fatal(err)
	}
	if err := a.dockerRuntime.RemoveVolume(ctx, targetVolume, target, "work-private"); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.ReleaseResourceIntent(ctx, target, "volume", "work-private", true); err != nil {
		t.Fatal(err)
	}
	if _, err := a.dockerRuntime.EnsureVolume(ctx, target, "work-private"); err != nil {
		t.Fatal(err)
	}
	helperRun(target, targetVolume, "work-private", "restore", captured.Tree)
	request["targetWorkId"] = target
	request["contexts"] = []map[string]string{{"sourceId": *sourceWork.ActiveContextID, "targetId": *targetWork.ActiveContextID}}
	writeRequest()
	helperRun(target, targetVolume, "work-private", "restore-history", "")
	control(target, "start")
	status, restored := packageHTTPCall(t, base, "/api/v1/works/"+target+"/runs/"+sourceRun, "GET", auth, nil)
	if status != 200 || restored["workId"] != target || restored["state"] != float64(4) {
		t.Fatal("mapped history not visible to actual Agent", status, restored)
	}
	run(target, "snapshot-target-continuation")
	control(target, "stop")
	shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := a.Close(shutdown); err != nil {
		t.Fatal("native helper/Agent shutdown", err)
	}
}
