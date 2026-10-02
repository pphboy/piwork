package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/contracts"
)

func TestSnapshotRecipientBindingsCaptureAndRevalidateExactCredentials(t *testing.T) {
	input := RuntimeInput{AgentImage: "fixture/native", Provider: "piwork-deterministic", Model: "snapshot-model", Credential: "fixture-owned-secret"}
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &input}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	ctx := context.Background()
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "bindings")
	if err != nil {
		t.Fatal(err)
	}
	requirements, err := snapshotConvert[contracts.WorkBindingRequirements](map[string]any{"models": []any{map[string]any{"key": "m-owned", "provider": input.Provider, "model": input.Model, "baseUrl": nil}}, "secrets": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	var captured snapshotBindings
	resolve := func(prior snapshotBindings) error {
		return a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			captured, err = a.resolveSnapshotBindings(tx, login.User.ID, requirements, prior)
			return err
		})
	}
	if err := resolve(nil); err != nil || len(captured) != 1 {
		t.Fatal(captured, err)
	}
	original := captured
	bound := original["m-owned"]
	input.Credential = "new-recipient-secret"
	if _, err := a.Settings.ConfigureRuntime(input); err != nil {
		t.Fatal(err)
	}
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ensureRuntimeCatalog(ctx, profile); err != nil {
		t.Fatal(err)
	}
	if err := resolve(original); err != nil || captured["m-owned"].CatalogID != bound.CatalogID {
		t.Fatal("captured selection followed new defaults", captured, err)
	}
	if err := resolve(nil); err != nil || captured["m-owned"].Profile.Revision != profile.Revision {
		t.Fatal("automatic selection did not prefer latest enabled match", captured, err)
	}
	latest := captured
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE catalog_entries SET enabled=0 WHERE id=?`, latest["m-owned"].CatalogID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	assertCode := func(err error, want string) {
		t.Helper()
		if err == nil {
			t.Fatal("missing rejection", want)
		}
		_, view := contracts.ProjectError(err)
		if view.Code != want {
			t.Fatal(view)
		}
	}
	assertCode(resolve(latest), "TARGET_MODEL_UNAVAILABLE")
	if err := resolve(original); err != nil {
		t.Fatal("unrelated disabled entry invalidated captured binding", err)
	}
	secretPath := filepath.Join(a.options.DataDirectory, "secrets", bound.Profile.Model.CredentialRef)
	if err := os.Rename(secretPath, secretPath+".unavailable"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Rename(secretPath+".unavailable", secretPath) })
	assertCode(resolve(original), "TARGET_MODEL_UNAVAILABLE")
	raw := snapshotRaw(requirements)
	var object map[string]any
	if json.Unmarshal(raw, &object) != nil {
		t.Fatal("requirements")
	}
	object["secrets"] = []any{map[string]any{"key": "s-external", "uses": []any{map[string]any{"contextKey": "c-1", "serverId": "external", "key": nil}}}}
	requirements, err = snapshotConvert[contracts.WorkBindingRequirements](object)
	if err != nil {
		t.Fatal(err)
	}
	assertCode(resolve(nil), "EXTERNAL_MCP_SECRET_UNAVAILABLE")
}
