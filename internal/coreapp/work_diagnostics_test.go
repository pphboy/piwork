package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/identity"
)

func TestDiagnosticStorageFailureDoesNotCompleteAcceptedOperation(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	ctx := context.Background()
	work := "work-diagnostic-fixture"
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "diagnostic-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: string(owner.Id), Name: "Diagnostic", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()})
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: work, Kind: "start-work", IdempotencyKey: "diagnostic-storage-fault", RequestJSON: `{}`, WorkID: &work, TargetVersion: 1, Now: packageNow()}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		return corestore.MutationEffect{ResourceID: work}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	trace := traceFrom(a.traceOperation(ctx, operation))
	if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "runtime-prepare", Outcome: "succeeded", Code: "RUNTIME_PREPARE_FAILED"}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TRIGGER fixture_diagnostic_write_failure BEFORE UPDATE OF result_json ON operations BEGIN SELECT RAISE(FAIL,'fixture write failure'); END`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	err = trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "readiness", Outcome: "failed", Code: "AGENT_EXITED"})
	if err == nil || errors.Is(err, context.Canceled) {
		t.Fatal("diagnostic persistence failure concealed", err)
	}
	failed, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	if failed.State != "pending" || failed.ResultJSON == nil {
		t.Fatal("failed diagnostic fabricated terminal state", failed)
	}
	var envelope diagnosticEnvelope
	if json.Unmarshal([]byte(*failed.ResultJSON), &envelope) != nil || len(envelope.Diagnostics.Stages) != 1 {
		t.Fatal("prior durable diagnostics lost", failed)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { _, err := tx.Exec(`DROP TRIGGER fixture_diagnostic_write_failure`); return err }); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(ctx, Options{DataDirectory: a.options.DataDirectory})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(ctx)
	recovered, err := reopened.Store.Operation(ctx, accepted.OperationID)
	if err != nil || recovered.State != "pending" {
		t.Fatal("unconfirmed diagnostic became terminal during recovery", recovered, err)
	}
	prior := decodeDiagnosticEnvelope(recovered.ResultJSON, recovered.ID)
	if len(prior.Diagnostics.Stages) != 1 || prior.Diagnostics.Stages[0].Outcome != "succeeded" || prior.Diagnostics.Stages[0].Stage != "runtime-prepare" {
		t.Fatal("recovery lost last confirmed diagnostic", prior)
	}
}

func TestInterruptedDiagnosticStageSurvivesCoreReopenExactlyOnce(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	ctx := context.Background()
	work := "work-interrupted-diagnostic"
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "interrupted-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: string(owner.Id), Name: "Interrupted", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()})
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: work, Kind: "start-work", IdempotencyKey: "interrupted-stage", RequestJSON: `{}`, WorkID: &work, TargetVersion: 1, Now: packageNow()}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		return corestore.MutationEffect{ResourceID: work}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	trace := traceFrom(a.traceOperation(ctx, operation))
	if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "runtime-start", Outcome: "started", Code: "RUNTIME_START_FAILED"}); err != nil {
		t.Fatal(err)
	}
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(ctx, Options{DataDirectory: a.options.DataDirectory})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(ctx)
	if err := reopened.recoverDiagnosticAttempts(ctx); err != nil {
		t.Fatal(err)
	}
	current, err := reopened.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	v := decodeDiagnosticEnvelope(current.ResultJSON, current.ID)
	if len(v.Diagnostics.Stages) != 1 || v.Diagnostics.Stages[0].Outcome != "interrupted" || current.State != "pending" {
		t.Fatal("interrupted stage lost, repeated or fabricated completion", current, v)
	}
}
