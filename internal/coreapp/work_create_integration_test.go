//go:build integration

package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/testsupport"
)

func TestNativeDefaultWorkCreateAndSession(t *testing.T) {
	imageRef := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if imageRef == "" {
		t.Skip("set PIWORK_TEST_NATIVE_AGENT_IMAGE to a built acceptance image")
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	scope, err := testsupport.NewScope()
	if err != nil {
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
	defer raw.Close()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	dataDir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	initial, err := corestore.Open(ctx, corestore.Options{Directory: dataDir, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}
	a, base, _ := appFixture(t, Options{DataDirectory: dataDir, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"},
		Runtime:       &RuntimeInput{AgentImage: imageRef, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"},
	}})
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	authorization := "Bearer " + login.Token
	if status, view := httpCall(t, base, "/api/v1/admin/default-work", "PATCH", authorization, map[string]any{"baseImage": imageRef}); status != 200 || view["baseImage"] != imageRef {
		t.Fatal("default image selection did not save", status, view)
	}
	create := func(target, payload string) (int, map[string]any) {
		t.Helper()
		request, err := http.NewRequestWithContext(ctx, http.MethodPost, target+"/api/v1/works", bytes.NewBufferString(payload))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", authorization)
		request.Header.Set("Content-Type", "application/json")
		response, err := (&http.Client{Timeout: 90 * time.Second}).Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		var body map[string]any
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, body
	}
	defaultPayload := `{"name":"默认工作","idempotencyKey":"create-default-once"}`
	status, accepted := create(base, defaultPayload)
	if status != 202 || accepted["workId"] == nil || accepted["operationId"] == nil {
		t.Fatal("default Work create was not accepted", status, accepted)
	}
	workID, operationID := accepted["workId"].(string), accepted["operationId"].(string)
	waitWorkOperation(t, ctx, a, operationID)
	if replayStatus, replay := create(base, defaultPayload); replayStatus != 202 || replay["workId"] != workID || replay["operationId"] != operationID || replay["reused"] != true {
		t.Fatal("create idempotency replay changed Work identity", replayStatus, replay)
	}
	if conflictStatus, conflict := create(base, `{"name":"Different Work","idempotencyKey":"create-default-once"}`); conflictStatus != 409 || conflict["code"] != "IDEMPOTENCY_CONFLICT" {
		t.Fatal("same create key accepted different input", conflictStatus, conflict)
	}
	if status, sessions := httpCall(t, base, "/api/v1/works/"+workID+"/sessions", "GET", authorization, nil); status != 200 || sessions["sessions"] == nil {
		t.Fatal("created Work did not expose its real Agent", status, sessions)
	}
	if status, view := httpCall(t, base, "/api/v1/works/"+workID+"/configuration", "GET", authorization, nil); status != 200 || view["pendingApply"] != false || view["active"] == nil || view["desired"] == nil || view["desiredRevision"] != nil || view["activeRevision"] != nil || view["runtime"].(map[string]any)["state"] != "ready" || len(view["runtime"].(map[string]any)["skills"].([]any)) != 0 {
		t.Fatal("created Work configuration leaked internals or retained an independent default Skill", status, view)
	} else {
		packages := view["runtime"].(map[string]any)["packages"].([]any)
		if len(packages) != 1 || packages[0].(map[string]any)["name"] != "piwork-brain" || packages[0].(map[string]any)["loaded"] != true {
			t.Fatal("default brain package was not actually loaded", view)
		}
	}
	_, initialView := httpCall(t, base, "/api/v1/works/"+workID+"/configuration", "GET", authorization, nil)
	fullConfig := initialView["desired"].(map[string]any)
	fullConfig["agentsMd"] = "# Full configuration Save"
	if status, view := httpCall(t, base, "/api/v1/works/"+workID+"/configuration", "PUT", authorization, map[string]any{"configuration": fullConfig}); status != 200 || view["pendingApply"] != true || view["desired"].(map[string]any)["agentsMd"] != "# Full configuration Save" || view["active"].(map[string]any)["agentsMd"] != "" {
		t.Fatal("full configuration Save changed active runtime or did not save desired", status, view)
	}
	invalidConfig := make(map[string]any, len(fullConfig))
	for key, value := range fullConfig {
		invalidConfig[key] = value
	}
	invalidConfig["modelRef"] = "missing-model"
	if status, invalid := httpCall(t, base, "/api/v1/works/"+workID+"/configuration", "PUT", authorization, map[string]any{"configuration": invalidConfig}); status != 400 || invalid["code"] != "INVALID_CONFIGURATION" {
		t.Fatal("full configuration Save accepted a missing model", status, invalid)
	}
	if status, view := httpCall(t, base, "/api/v1/works/"+workID+"/configuration/agents", "PUT", authorization, map[string]any{"agentsMd": "# Saved without Apply"}); status != 200 || view["pendingApply"] != true || view["desired"].(map[string]any)["agentsMd"] != "# Saved without Apply" || view["active"].(map[string]any)["agentsMd"] != "" {
		t.Fatal("AGENTS.md Save activated early or lost desired state", status, view)
	}
	if status, view := httpCall(t, base, "/api/v1/works/"+workID+"/configuration/skills", "PUT", authorization, map[string]any{"skills": []string{}}); status != 200 || view["pendingApply"] != true || len(view["desired"].(map[string]any)["skills"].([]any)) != 0 || len(view["active"].(map[string]any)["skills"].([]any)) != 0 || len(view["active"].(map[string]any)["packages"].([]any)) != 1 {
		t.Fatal("Skill Save activated early or lost active context", status, view)
	}
	if status, view := httpCall(t, base, "/api/v1/works/"+workID+"/configuration/packages", "PUT", authorization, map[string]any{"packages": []any{}}); status != 200 || view["pendingApply"] != true || len(view["desired"].(map[string]any)["packages"].([]any)) != 0 {
		t.Fatal("empty package Save did not preserve desired state", status, view)
	}
	if status, sessions := httpCall(t, base, "/api/v1/works/"+workID+"/sessions", "GET", authorization, nil); status != 200 || sessions["sessions"] == nil {
		t.Fatal("configuration Save interrupted current Agent", status, sessions)
	}
	for _, action := range []string{"stop", "start", "retry"} {
		status, accepted := httpCall(t, base, "/api/v1/works/"+workID+"/"+action, "POST", authorization, map[string]any{"idempotencyKey": "explicit-" + action})
		if status != 202 || accepted["operationId"] == nil {
			t.Fatal("explicit Work action was not accepted", action, status, accepted)
		}
		waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
		expected := "ready"
		if action == "stop" {
			expected = "stopped"
		}
		if status, detail := httpCall(t, base, "/api/v1/works/"+workID, "GET", authorization, nil); status != 200 || detail["observedState"] != expected {
			t.Fatal("explicit Work action reached wrong state", action, status, detail)
		}
	}
	if status, sessions := httpCall(t, base, "/api/v1/works/"+workID+"/sessions", "GET", authorization, nil); status != 200 || sessions["sessions"] == nil {
		t.Fatal("restarted Work lost its Agent route", status, sessions)
	}
	shutdown, finishShutdown := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(shutdown); err != nil {
		finishShutdown()
		t.Fatal("created Work was not stopped on Go Core shutdown", err)
	}
	finishShutdown()
	next, nextBase, _ := appFixture(t, Options{DataDirectory: dataDir, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}})
	if next.Status().State != "READY" {
		t.Fatal("created Work did not recover from persistent records", next.Status())
	}
	if status, work := httpCall(t, nextBase, "/api/v1/works/"+workID, "GET", authorization, nil); status != 200 || work["desiredState"] != "running" || work["observedState"] != "ready" {
		t.Fatal("created Work did not resume desired-running", status, work)
	}
	if status, sessions := httpCall(t, nextBase, "/api/v1/works/"+workID+"/sessions", "GET", authorization, nil); status != 200 || sessions["sessions"] == nil {
		t.Fatal("created Work lost Agent Session access after restart", status, sessions)
	}
	defaults, err := next.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration == nil {
		t.Fatal("default Work configuration unavailable", err)
	}
	noSkillsRequest, err := json.Marshal(map[string]any{
		"name": "No Skills", "configuration": defaults.Configuration,
		"baseImage": string(defaults.Configuration.AgentImage.CatalogId),
		"skills":    []string{}, "packages": []any{}, "agentsMd": "# Work-specific instructions",
		"idempotencyKey": "create-empty-skills-once",
	})
	if err != nil {
		t.Fatal(err)
	}
	noSkillsPayload := string(noSkillsRequest)
	if status, invalid := create(nextBase, `{"name":"Invalid Configuration","configuration":{"unexpected":true},"idempotencyKey":"invalid-configuration"}`); status != 400 || invalid["code"] != "INVALID_REQUEST" {
		t.Fatal("invalid complete configuration was accepted", status, invalid)
	}
	if status, empty := create(nextBase, noSkillsPayload); status != 202 {
		t.Fatal("explicit no-Skills Work create was not accepted", status, empty)
	} else {
		emptyID := empty["workId"].(string)
		waitWorkOperation(t, ctx, next, empty["operationId"].(string))
		if status, view := httpCall(t, nextBase, "/api/v1/works/"+emptyID+"/configuration", "GET", authorization, nil); status != 200 || view["runtime"].(map[string]any)["state"] != "ready" || len(view["runtime"].(map[string]any)["skills"].([]any)) != 0 || view["desired"].(map[string]any)["agentsMd"] != "# Work-specific instructions" || len(view["desired"].(map[string]any)["packages"].([]any)) != 0 {
			t.Fatal("explicit no-Skills Work did not start with an empty SDK Skill set", status, view)
		}
		status, deleted := httpCall(t, nextBase, "/api/v1/works/"+emptyID+"/delete", "POST", authorization, map[string]any{"idempotencyKey": "delete-empty-work-once"})
		if status != 202 {
			t.Fatal("Work delete was not accepted", status, deleted)
		}
		for {
			operation, err := next.Store.Operation(ctx, deleted["operationId"].(string))
			if err != nil {
				t.Fatal(err)
			}
			if operation.State == "succeeded" {
				break
			}
			if operation.State == "failed" || operation.State == "superseded" || ctx.Err() != nil {
				failure := ""
				if operation.ErrorJSON != nil {
					failure = *operation.ErrorJSON
				}
				t.Fatal("Work deletion failed", operation.State, failure, ctx.Err())
			}
			time.Sleep(50 * time.Millisecond)
		}
		if status, _ := httpCall(t, nextBase, "/api/v1/works/"+emptyID, "GET", authorization, nil); status != 404 {
			t.Fatal("deleted Work remained publicly visible", status)
		}
		if status, operation := httpCall(t, nextBase, "/api/v1/operations/"+deleted["operationId"].(string), "GET", authorization, nil); status != 200 || operation["state"] != "succeeded" || operation["result"].(map[string]any)["observedState"] != "deleted" {
			t.Fatal("terminal delete Operation was not queryable", status, operation)
		}
		if status, replay := httpCall(t, nextBase, "/api/v1/works/"+emptyID+"/delete", "POST", authorization, map[string]any{"idempotencyKey": "delete-empty-work-once"}); status != 202 || replay["operationId"] != deleted["operationId"] || replay["reused"] != true {
			t.Fatal("delete idempotency replay disappeared after Work tombstone", status, replay)
		}
		var retainedRecords int
		if err := next.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT count(*) FROM volume_records WHERE work_id=? AND state='retained' AND reference_count=0`, emptyID).Scan(&retainedRecords)
		}); err != nil || retainedRecords != 2 {
			t.Fatal("delete did not retain two recorded data volumes", retainedRecords, err)
		}
		volumes, err := next.dockerRuntime.ListVolumes(ctx)
		if err != nil {
			t.Fatal(err)
		}
		retained := 0
		for _, volume := range volumes {
			if volume.Labels[dockerengine.WorkLabel] == emptyID {
				retained++
			}
		}
		if retained != 2 {
			t.Fatal("delete did not retain both Work data volumes", retained)
		}
		closing, finish := context.WithTimeout(ctx, 45*time.Second)
		if err := next.Close(closing); err != nil {
			finish()
			t.Fatal("Core shutdown after Work delete was not confirmed", err)
		}
		finish()
		reopened, reopenedBase, _ := appFixture(t, Options{DataDirectory: dataDir, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}})
		if reopened.Status().State != "READY" {
			t.Fatal("deleted Work prevented Core recovery", reopened.Status())
		}
		if status, _ := httpCall(t, reopenedBase, "/api/v1/works/"+emptyID, "GET", authorization, nil); status != 404 {
			t.Fatal("deleted Work returned after restart", status)
		}
		if status, operation := httpCall(t, reopenedBase, "/api/v1/operations/"+deleted["operationId"].(string), "GET", authorization, nil); status != 200 || operation["state"] != "succeeded" {
			t.Fatal("delete Operation was not durable", status, operation)
		}
	}
}

func TestNativeManagedSkillLoadsFromCoreCopyAfterSourceRemoval(t *testing.T) {
	imageRef := os.Getenv("PIWORK_TEST_NATIVE_AGENT_IMAGE")
	if imageRef == "" {
		t.Skip("set PIWORK_TEST_NATIVE_AGENT_IMAGE to a built acceptance image")
	}
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	scope, err := testsupport.NewScope()
	if err != nil {
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
	defer raw.Close()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, raw); err != nil {
			t.Error(err)
		}
	})
	dataDir := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	initial, err := corestore.Open(ctx, corestore.Options{Directory: dataDir, InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	if err := initial.Close(); err != nil {
		t.Fatal(err)
	}
	a, base, operator := appFixture(t, Options{DataDirectory: dataDir, DockerOptions: dockerengine.SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()}, Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"},
		Runtime:       &RuntimeInput{AgentImage: imageRef, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"},
	}})
	source := filepath.Join(t.TempDir(), "custom-skill")
	if err := os.MkdirAll(filepath.Join(source, "references"), 0700); err != nil {
		t.Fatal(err)
	}
	manifest := "---\nname: custom-skill\ndescription: A managed Skill used by the native acceptance test.\n---\n\n# Managed Skill\n"
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "references", "proof.txt"), []byte("source-independent"), 0600); err != nil {
		t.Fatal(err)
	}
	if status, skill := httpCall(t, base, "/control/skills", "POST", "Operator "+operator, map[string]any{"path": source}); status != 201 || skill["name"] != "custom-skill" {
		t.Fatal("managed Skill import failed", status, skill)
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/api/v1/works", bytes.NewBufferString(`{"name":"Managed Skill Work","skills":["custom-skill"],"idempotencyKey":"managed-skill-create"}`))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+login.Token)
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 90 * time.Second}).Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var accepted map[string]any
	if err := json.NewDecoder(response.Body).Decode(&accepted); err != nil || response.StatusCode != 202 {
		t.Fatal("custom Skill Work was not accepted", response.StatusCode, accepted, err)
	}
	workID := accepted["workId"].(string)
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	if status, view := httpCall(t, base, "/api/v1/works/"+workID+"/configuration", "GET", "Bearer "+login.Token, nil); status != 200 || view["runtime"].(map[string]any)["state"] != "ready" || len(view["runtime"].(map[string]any)["skills"].([]any)) != 1 || view["runtime"].(map[string]any)["skills"].([]any)[0].(map[string]any)["name"] != "custom-skill" {
		t.Fatal("real TS SDK did not load the managed Skill", status, view)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.ActiveContextID == nil {
		t.Fatal("Work did not retain its active context", err)
	}
	proof := filepath.Join(dataDir, "works", workID, "contexts", *work.ActiveContextID, "skills", "custom-skill", "references", "proof.txt")
	if content, err := os.ReadFile(proof); err != nil || string(content) != "source-independent" {
		t.Fatal("Work context lost supporting Skill file after source deletion", err)
	}
	if status, result := httpCall(t, base, "/control/skills/custom-skill", "DELETE", "Operator "+operator, nil); status != 204 {
		t.Fatal("Core catalog Skill removal failed", status, result)
	}
	if status, result := httpCall(t, base, "/api/v1/works/"+workID+"/configuration/agents", "PUT", "Bearer "+login.Token, map[string]any{"agentsMd": "# New instructions"}); status != 200 {
		t.Fatal("AGENTS save after Core Skill removal failed", status, result)
	}
	work, err = a.Store.Work(ctx, workID, false)
	if err != nil || work.DesiredContextID == nil {
		t.Fatal("AGENTS save did not publish a desired context", err)
	}
	newProof := filepath.Join(dataDir, "works", workID, "contexts", *work.DesiredContextID, "skills", "custom-skill", "references", "proof.txt")
	if content, err := os.ReadFile(newProof); err != nil || string(content) != "source-independent" {
		t.Fatal("AGENTS save did not preserve the Work Skill after catalog removal", err)
	}
	containers, err := a.dockerRuntime.ListContainers(ctx, "agent")
	if err != nil {
		t.Fatal(err)
	}
	containerID := ""
	for _, container := range containers {
		if container.Config != nil && container.Config.Labels[dockerengine.WorkLabel] == workID {
			containerID = container.ID
		}
	}
	if containerID == "" {
		t.Fatal("ready Work has no managed Agent to crash")
	}
	if _, err := raw.ContainerKill(ctx, containerID, client.ContainerKillOptions{Signal: "SIGKILL"}); err != nil {
		t.Fatal("could not simulate Agent crash", err)
	}
	recovered := false
	for deadline := time.Now().Add(35 * time.Second); time.Now().Before(deadline); time.Sleep(250 * time.Millisecond) {
		var state string
		var retries int
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT g.state,g.retry_count FROM runtime_generations g WHERE g.work_id=? ORDER BY g.generation DESC LIMIT 1`, workID).Scan(&state, &retries)
		}); err != nil {
			t.Fatal(err)
		}
		if state == "ready" && retries >= 1 {
			if status, sessions := httpCall(t, base, "/api/v1/works/"+workID+"/sessions", "GET", "Bearer "+login.Token, nil); status == 200 && sessions["sessions"] != nil {
				recovered = true
				break
			}
		}
	}
	if !recovered {
		t.Fatal("confirmed Agent crash did not consume persisted retry budget and recover its route")
	}
}
