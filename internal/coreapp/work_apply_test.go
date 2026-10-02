package coreapp

import (
	"context"
	"database/sql"
	"sync"
	"testing"

	"piwork/internal/corestore"
)

func TestApplyAcceptanceDurablyCapturesContextAndReplaysAfterSave(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	user, err := a.Store.UserByAccount(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "apply-unit")
	if err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	actor := session.Principal()
	id := "work-fixture-0001"
	prior := "context-prior-0001"
	candidate := "context-candidate-0001"
	revision := int64(1)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: id, OwnerUserID: user.ID, Name: "Apply capture", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 2, ActiveRevision: &revision, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()}); err != nil {
			return err
		}
		for _, contextID := range []string{prior, candidate, "context-later-0001"} {
			if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: contextID, WorkID: id, ConfigurationJSON: `{}`, ImageIdentity: "image", CreatedByUserID: user.ID, CreatedAt: packageNow()}); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`UPDATE works SET active_context_id=?,desired_context_id=? WHERE id=?`, prior, candidate, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	value, _ := a.workLocks.LoadOrStore(id, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	accepted, err := a.acceptWorkApply(ctx, actor, id, "capture-once")
	if err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := a.readApplyPlan(ctx, operation)
	if err != nil {
		t.Fatal("private plan could not be read", err)
	}
	if plan.ContextID != candidate || plan.Revision != 2 || plan.PriorContextID == nil || *plan.PriorContextID != prior || plan.Control != 2 || plan.DesiredState != "stopped" {
		t.Fatal("wrong acceptance capture", plan)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_context_id='context-later-0001',desired_revision=3 WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	replay, err := a.acceptWorkApply(ctx, actor, id, "capture-once")
	if err != nil || !replay.Reused || replay.OperationID != accepted.OperationID {
		t.Fatal("later Save changed idempotency identity", replay, err)
	}
	preserved, err := a.readApplyPlan(ctx, operation)
	if err != nil || preserved.ContextID != candidate {
		t.Fatal("later Save changed captured context", preserved, err)
	}
	if _, err := a.Store.ControlMetadata(ctx, applyRemovalKey(id)); err != nil {
		t.Fatal("removal key cannot survive store API", err)
	}
	if _, err := a.Store.CompleteOperation(ctx, operation.ID, "succeeded", nil, nil, nil); err != nil {
		t.Fatal(err)
	}
}
