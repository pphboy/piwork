package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/identity"
)

func TestCreateRequestPerformanceIncludesFailureAndReplayWithoutNewWork(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "performance-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "performance-owner", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	call := func(payload string) (int, map[string]any, []map[string]any) {
		t.Helper()
		var output bytes.Buffer
		request := httptest.NewRequest("POST", "/api/v1/works", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.Header.Set("Authorization", "Bearer "+login.Token)
		request = request.WithContext(diagnostics.WithPerformanceWriter(request.Context(), &output))
		response := httptest.NewRecorder()
		a.route(response, request)
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		var events []map[string]any
		for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
			var event map[string]any
			if json.Unmarshal([]byte(line), &event) != nil {
				t.Fatal(output.String())
			}
			events = append(events, event)
		}
		return response.Code, body, events
	}
	status, body, events := call(`{"name":"","idempotencyKey":"preaccept-failure"}`)
	if status != 400 || body["code"] != "INVALID_REQUEST" || len(events) != 2 || events[1]["outcome"] != "failed" || events[1]["workId"] != nil || events[1]["operationId"] != nil || events[1]["durationMs"].(float64) < 0 {
		t.Fatal(status, body, events)
	}
	work := "work-performance-replay"
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: "new-work", Kind: "create-work", IdempotencyKey: "replay-existing", RequestJSON: `{"name":"Replay"}`, TargetVersion: 1, Now: packageNow()}, func(tx *sql.Tx, _ string) (corestore.MutationEffect, error) {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: string(owner.Id), Name: "Replay", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()}); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: work, WorkID: &work}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	status, body, events = call(`{"name":"Replay","idempotencyKey":"replay-existing"}`)
	if status != 202 || body["workId"] != work || body["operationId"] != accepted.OperationID || body["reused"] != true || len(body) != 3 || len(events) != 2 || events[1]["workId"] != work || events[1]["operationId"] != accepted.OperationID {
		t.Fatal(status, body, events)
	}
	if events[0]["phase"] != "create-request" || events[1]["phase"] != "create-request" {
		t.Fatal(events)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var works, operations int
		if err := tx.QueryRow(`SELECT count(*) FROM works`).Scan(&works); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM operations`).Scan(&operations); err != nil {
			return err
		}
		if works != 1 || operations != 1 {
			t.Fatalf("replay or failure invented work: %d/%d", works, operations)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
