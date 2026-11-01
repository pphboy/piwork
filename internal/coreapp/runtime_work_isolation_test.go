package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"reflect"
	"testing"

	"piwork/internal/corestore"
)

// This exercises persisted configuration isolation, not Docker activation.
func TestRuntimeHTTPSaveChangesFutureDefaultsNotPersistedWork(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	ctx := context.Background()
	selectModel := func(name string) {
		t.Helper()
		code, model := httpCall(t, base, "/api/v1/admin/models", "POST", auth, map[string]any{
			"model": name, "api": "openai-responses", "baseUrl": "https://fixture.invalid/v1", "credential": "synthetic-key",
		})
		if code != 201 {
			t.Fatal("create synthetic model", code, model)
		}
		code, saved := httpCall(t, base, "/api/v1/admin/runtime", "PUT", auth, map[string]any{"modelRef": model["modelRef"]})
		if code != 200 {
			t.Fatal("save runtime", code, saved)
		}
	}
	selectModel("original-model")
	original, err := a.Store.DefaultWork(ctx)
	if err != nil || original.Configuration == nil {
		t.Fatal("original default configuration", err)
	}
	configuration, err := json.Marshal(original.Configuration)
	if err != nil {
		t.Fatal(err)
	}
	const workID, contextID = "work-runtime-isolation", "context-runtime-isolation"
	revision := int64(1)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{
			ID: workID, OwnerUserID: actor.UserID, Name: "Captured before runtime save",
			DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: revision,
			ActiveRevision: &revision, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow(),
		}); err != nil {
			return err
		}
		if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{
			WorkID: workID, Revision: revision, ConfigJSON: string(configuration), CreatedByUserID: actor.UserID, CreatedAt: packageNow(),
		}); err != nil {
			return err
		}
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{
			SnapshotID: contextID, WorkID: workID, InternalRevision: &revision, ConfigurationJSON: string(configuration),
			ImageIdentity: "synthetic-captured-image", CreatedByUserID: actor.UserID, CreatedAt: packageNow(),
		}); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE works SET desired_context_id=?,active_context_id=? WHERE id=?`, contextID, contextID, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	beforeWork, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	beforeConfig, err := a.Store.Configuration(ctx, workID)
	if err != nil {
		t.Fatal(err)
	}
	selectModel("future-model")
	future, err := a.Store.DefaultWork(ctx)
	if err != nil || future.Configuration == nil || future.Configuration.ModelRef == original.Configuration.ModelRef || future.Revision <= original.Revision {
		t.Fatal("runtime save did not update future default capture", err)
	}
	afterWork, err := a.Store.Work(ctx, workID, false)
	if err != nil || !reflect.DeepEqual(beforeWork, afterWork) {
		t.Fatal("runtime save changed an existing Work or its context pointers", err)
	}
	afterConfig, err := a.Store.Configuration(ctx, workID)
	if err != nil || !reflect.DeepEqual(beforeConfig, afterConfig) {
		t.Fatal("runtime save changed captured active/desired configuration", err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var captured, image string
		var contexts, revisions int
		if err := tx.QueryRow(`SELECT configuration_json,image_identity FROM work_context_snapshots WHERE snapshot_id=?`, contextID).Scan(&captured, &image); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM work_context_snapshots WHERE work_id=?`, workID).Scan(&contexts); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM work_config_revisions WHERE work_id=?`, workID).Scan(&revisions); err != nil {
			return err
		}
		if captured != string(configuration) || image != "synthetic-captured-image" || contexts != 1 || revisions != 1 {
			t.Fatal("runtime save rewrote or added existing Work configuration/context")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
