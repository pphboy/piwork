package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestWorkMetadataListAndDetailRespectOwnerBoundary(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "other", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, work := range []corestore.WorkRecord{
			{ID: "work-owner", OwnerUserID: string(owner.Id), Name: "笔记", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now},
			{ID: "work-other", OwnerUserID: string(other.Id), Name: "Other", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now},
		} {
			if err := corestore.InsertWork(tx, work); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	ownerLogin, err := a.Identity.Login(ctx, "owner", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	adminLogin, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	ownerAuth := "Bearer " + ownerLogin.Token
	adminAuth := "Bearer " + adminLogin.Token
	if status, body := httpCall(t, base, "/api/v1/works", "GET", ownerAuth, nil); status != 200 || len(body["works"].([]any)) != 1 || body["works"].([]any)[0].(map[string]any)["name"] != "笔记" {
		t.Fatal("owner Work list leaked another Work", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/works/work-owner", "GET", ownerAuth, nil); status != 200 || body["ownerUserId"] != string(owner.Id) || body["desiredContextId"] != nil {
		t.Fatal("owner Work detail mismatch or internal context leaked", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/works/work-other", "GET", ownerAuth, nil); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("foreign Work distinguishable from absence", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/works/absent", "GET", ownerAuth, nil); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("missing Work mismatch", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/works", "GET", adminAuth, nil); status != 200 || len(body["works"].([]any)) != 2 {
		t.Fatal("admin metadata visibility missing", status, body)
	}
	workID := "work-owner"
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{
		PrincipalID: string(owner.Id), WorkScope: workID, Kind: "stop-work", IdempotencyKey: "read-operation",
		RequestJSON: `{}`, TargetVersion: 1, WorkID: &workID,
	}, func(*sql.Tx, string) (corestore.MutationEffect, error) {
		return corestore.MutationEffect{ResourceID: workID}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	secret := "private credential /run/secrets/model-api-key"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE operations SET result_json=?,error_json=? WHERE id=?`,
			`{"correlationId":"correlation-safe","result":{"observedState":"stopped"},"diagnostics":{"stages":[{"timestamp":"`+now+`","component":"core","stage":"runtime-start","outcome":"failed","code":"WORK_OPERATION_FAILED","message":"`+secret+`"}],"truncated":false,"rollback":{"state":"not-required"},"diagnosticCollection":{"state":"not-attempted"}}}`,
			`{"code":"WORK_OPERATION_FAILED","stage":"runtime-start","message":"`+secret+`"}`, accepted.OperationID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/operations/" + accepted.OperationID
	if status, body := httpCall(t, base, path, "GET", ownerAuth, nil); status != 200 || body["correlationId"] != "correlation-safe" || body["error"].(map[string]any)["message"] == secret || len(body["diagnostics"].(map[string]any)["stages"].([]any)) != 1 || body["diagnostics"].(map[string]any)["stages"].([]any)[0].(map[string]any)["message"] == secret {
		t.Fatal("persisted diagnostic content leaked", status, body)
	}
	otherLogin, err := a.Identity.Login(ctx, "other", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	if status, body := httpCall(t, base, path, "GET", "Bearer "+otherLogin.Token, nil); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("cross owner Operation visibility mismatch", status, body)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='deleted',observed_state='deleted',deleted_at=? WHERE id=?`, now, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if status, _ := httpCall(t, base, "/api/v1/works/"+workID, "GET", ownerAuth, nil); status != 404 {
		t.Fatal("deleted Work remained visible", status)
	}
	for _, auth := range []string{ownerAuth, adminAuth} {
		if status, body := httpCall(t, base, path, "GET", auth, nil); status != 200 || body["operationId"] != accepted.OperationID {
			t.Fatal("terminal Work Operation became invisible", status, body)
		}
	}
	if status, _ := httpCall(t, base, path, "GET", "Bearer "+otherLogin.Token, nil); status != 404 {
		t.Fatal("deleted Work Operation leaked to another owner", status)
	}
}

func TestWorkActionHTTPPersistsAndReplaysOneOperation(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "action-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "action-other", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-action", OwnerUserID: string(owner.Id), Name: "Action", DesiredState: "running", ObservedState: "failed", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	ownerLogin, err := a.Identity.Login(ctx, "action-owner", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	otherLogin, err := a.Identity.Login(ctx, "action-other", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/works/work-action/stop"
	request := map[string]any{"idempotencyKey": "stop-once"}
	ownerAuth := "Bearer " + ownerLogin.Token
	if status, body := httpCall(t, base, path, "POST", "Bearer "+otherLogin.Token, request); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("foreign action leaked Work", status, body)
	}
	if status, body := httpCall(t, base, path, "POST", ownerAuth, map[string]any{"idempotencyKey": ""}); status != 400 || body["code"] != "INVALID_REQUEST" {
		t.Fatal("invalid key accepted", status, body)
	}
	if status, body := httpCall(t, base, path, "POST", ownerAuth, map[string]any{"idempotencyKey": "stop-once", "unexpected": true}); status != 400 || body["code"] != "INVALID_REQUEST" {
		t.Fatal("unknown action field accepted", status, body)
	}
	status, first := httpCall(t, base, path, "POST", ownerAuth, request)
	if status != 202 || first["workId"] != "work-action" || first["operationId"] == nil || first["reused"] != false {
		t.Fatal("action was not durably accepted", status, first)
	}
	status, second := httpCall(t, base, path, "POST", ownerAuth, request)
	if status != 202 || second["operationId"] != first["operationId"] || second["reused"] != true {
		t.Fatal("same key created another action", status, second)
	}
	work, err := a.Store.Work(ctx, "work-action", false)
	if err != nil || work.DesiredState != "stopped" || work.ControlVersion != 2 {
		t.Fatal("accepted target was not persisted once", work, err)
	}
}

func TestDeleteActionReplaysAfterWorkTombstone(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "delete-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	workID, version := "work-deleted-replay", int64(1)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: workID, OwnerUserID: string(owner.Id), Name: "Deleted", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: version, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: workID, WorkID: &workID,
		Kind: "delete-work", IdempotencyKey: "delete-once", RequestJSON: `{"desiredState":"deleted","retry":false}`,
		TargetVersion: version + 1, ExpectedWorkVersion: &version, FenceScope: "work"}, func(tx *sql.Tx, _ string) (corestore.MutationEffect, error) {
		if _, err := corestore.AdvanceWorkControl(tx, workID, version, "deleted", now); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: workID}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.MarkOperationRunning(ctx, accepted.OperationID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Store.CompleteOperation(ctx, accepted.OperationID, "succeeded", nil, nil, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET observed_state='deleted',deleted_at=? WHERE id=?`, now, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "delete-owner", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	authorization := "Bearer " + login.Token
	if status, _ := httpCall(t, base, "/api/v1/works/"+workID, "GET", authorization, nil); status != 404 {
		t.Fatal("tombstoned Work was visible", status)
	}
	if status, replay := httpCall(t, base, "/api/v1/works/"+workID+"/delete", "POST", authorization, map[string]any{"idempotencyKey": "delete-once"}); status != 202 || replay["operationId"] != accepted.OperationID || replay["reused"] != true {
		t.Fatal("same delete key did not replay its terminal Operation", status, replay)
	}
	if status, _ := httpCall(t, base, "/api/v1/works/"+workID+"/delete", "POST", authorization, map[string]any{"idempotencyKey": "different-delete"}); status != 409 {
		t.Fatal("new delete after tombstone created another Operation", status)
	}
}

func TestWorkConfigurationBeforeFirstActivationHasNoPublicRevision(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	user, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "config-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	configuration, err := json.Marshal(defaultWorkConfiguration(RuntimeProfile{Revision: 1}))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-config-pending", OwnerUserID: string(user.Id), Name: "Pending", DesiredState: "running", ObservedState: "provisioning", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return err
		}
		return corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: "work-config-pending", Revision: 1, ConfigJSON: string(configuration), CreatedByUserID: string(user.Id), CreatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "config-owner", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	status, body := httpCall(t, base, "/api/v1/works/work-config-pending/configuration", "GET", "Bearer "+login.Token, nil)
	if status != 200 || body["active"] != nil || body["pendingApply"] != true || body["desiredRevision"] != nil || body["activeRevision"] != nil || body["runtime"].(map[string]any)["state"] != "initializing" {
		t.Fatal("initial desired/active projection was misleading", status, body)
	}
	for _, check := range []struct {
		path, field string
	}{
		{"skills", "skills"}, {"packages", "packages"}, {"agents", "agentsMd"},
	} {
		status, projected := httpCall(t, base, "/api/v1/works/work-config-pending/configuration/"+check.path, "GET", "Bearer "+login.Token, nil)
		if status != 200 || projected[check.field] == nil || projected["desiredRevision"] != nil {
			t.Fatal("configuration field projection failed", check.path, status, projected)
		}
	}
	if status, _ := httpCall(t, base, "/api/v1/works/work-config-pending/configuration/agents", "PUT", "Bearer "+login.Token, map[string]any{}); status != 400 {
		t.Fatal("missing agentsMd was accepted", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/works/work-config-pending/configuration/skills", "PUT", "Bearer "+login.Token, map[string]any{"skills": nil}); status != 400 {
		t.Fatal("null Skill selection was accepted", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/works/work-config-pending/configuration/packages", "PUT", "Bearer "+login.Token, map[string]any{"packages": nil}); status != 400 {
		t.Fatal("null package selection was accepted", status)
	}
	if status, body := httpCall(t, base, "/api/v1/works/work-config-pending/configuration/packages", "PUT", "Bearer "+login.Token, map[string]any{"packages": []map[string]any{{"name": "not-installed", "enabled": true}}}); status != 409 || body["code"] != "CONFLICT" {
		t.Fatal("configuration without a captured context accepted Save", status, body)
	}
}
