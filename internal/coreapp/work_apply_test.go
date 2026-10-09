package coreapp

import (
	"context"
	"database/sql"
	"strings"
	"sync"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/workaccess"
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

func TestHistoryMigrationAuthorityIsBoundToSavedApplyAndInitializationGeneration(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	user, err := a.Store.UserByAccount(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	work := "work-memory-authority-0001"
	defer func() {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			if _, err := tx.Exec("DELETE FROM runtime_generations WHERE work_id=?", work); err != nil {
				return err
			}
			_, err := tx.Exec("UPDATE works SET desired_state='stopped',observed_state='stopped' WHERE id=?", work)
			return err
		}); err != nil {
			t.Error(err)
		}
	}()
	control := int64(2)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: user.ID, Name: "Memory authority", DesiredState: "running", ObservedState: "starting", DesiredRevision: 2, ControlVersion: control, CreatedAt: packageNow(), UpdatedAt: packageNow()}); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,2,'agent-memory-current','starting',0,?,?)`, work, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	plan := workApplyPlan{WorkID: work, ContextID: "context-memory-candidate", Revision: 2, Control: control, Stage: "starting", Generation: 2, InstanceID: "agent-memory-current", DesiredState: "running", HistoryBackup: &applyHistoryBackup{State: "saved", BackupKey: "backup-memory-fixture", ManifestDigest: strings.Repeat("a", 64)}}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: user.ID, WorkScope: work, Kind: applyOperationKind, IdempotencyKey: "migration-authority", RequestJSON: `{}`, TargetVersion: control, WorkID: &work}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if err := putApplyPlan(tx, id, plan); err != nil {
			return corestore.MutationEffect{}, err
		}
		_, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", pendingHistoryKey(work), string(snapshotRaw(map[string]any{"operationId": id, "control": control})), packageNow())
		return corestore.MutationEffect{ResourceID: work}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work, Generation: 2, InstanceID: plan.InstanceID}
	for _, scenario := range []string{"valid", "foreign-work", "old-generation", "foreign-instance", "planned", "committed", "restored", "validated", "no-backup", "superseded"} {
		t.Run(scenario, func(t *testing.T) {
			candidate := plan
			copyBackup := *plan.HistoryBackup
			candidate.HistoryBackup = &copyBackup
			identity := scope
			switch scenario {
			case "foreign-work":
				identity.WorkID = "work-other-fixture"
			case "old-generation":
				identity.Generation = 1
			case "foreign-instance":
				identity.InstanceID = "agent-other-fixture"
			case "planned", "committed", "restored":
				candidate.HistoryBackup.State = scenario
			case "validated":
				candidate.HistoryBackup.InitializationValidated = true
			case "no-backup":
				candidate.HistoryBackup = nil
			case "superseded":
				candidate.Control--
			}
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error { return putApplyPlan(tx, accepted.OperationID, candidate) }); err != nil {
				t.Fatal(err)
			}
			err := a.Store.Read(ctx, func(tx *sql.Tx) error { _, err := a.historyMigrationPlanTx(tx, identity); return err })
			if (err == nil) != (scenario == "valid") {
				t.Fatal("wrong migration authority", scenario, err)
			}
			if scenario == "valid" {
				err := a.Store.Read(ctx, func(tx *sql.Tx) error {
					_, err := a.authorizeServiceTx(tx, serviceActor{Runtime: &identity}, work, workaccess.Interact)
					return err
				})
				if err == nil {
					t.Fatal("initialization gained ordinary Service authority")
				}
			}
		})
	}
}
