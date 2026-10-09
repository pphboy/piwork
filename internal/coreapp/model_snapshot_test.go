package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"piwork/internal/contracts"
)

func TestManagedModelSnapshotBindingPreservesProtocolCapabilitiesAndCredentialRevalidation(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Recipient", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-recipient"})
	if err != nil {
		t.Fatal(err)
	}
	caps := json.RawMessage(`{"kind":"sdk","provider":"openai","model":"gpt-5.1"}`)
	m, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Alias", Model: "custom-alias", Capabilities: contracts.Supplied(caps)})
	if err != nil {
		t.Fatal(err)
	}
	requirements, err := snapshotConvert[contracts.WorkBindingRequirements](map[string]any{"models": []any{map[string]any{"key": "m-model", "provider": "openai", "model": "custom-alias", "baseUrl": "https://fixture.invalid/v1", "api": "openai-responses", "capabilities": caps}}, "secrets": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	var captured snapshotBindings
	resolve := func(prior snapshotBindings) error {
		return a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			captured, err = a.resolveSnapshotBindings(tx, actor.UserID, requirements, prior)
			return err
		})
	}
	if err := resolve(nil); err != nil {
		t.Fatal(err)
	}
	bound := captured["m-model"]
	if bound.CatalogID != string(m.ModelRef) || bound.Profile.Model.API != "openai-responses" || string(bound.Profile.Model.Capabilities) != string(caps) {
		t.Fatal("wrong recipient execution definition")
	}
	_, err = a.patchModelProvider(ctx, actor, string(p.Id), contracts.PatchModelProvider{Credential: contracts.Supplied("synthetic-rotated")})
	if err != nil {
		t.Fatal(err)
	}
	if err := resolve(snapshotBindings{"m-model": bound}); err == nil {
		t.Fatal("credential rotation did not fence accepted import")
	}
	_, err = a.modelLifecycle(ctx, actor, true, string(p.Id), "disable")
	if err != nil {
		t.Fatal(err)
	}
	if err := resolve(nil); err == nil {
		t.Fatal("disabled recipient admitted")
	}
}

func TestManagedModelSnapshotLegacyOfficialEndpointRetainsLegacyDescriptor(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Official", Api: "openai-responses", BaseUrl: "https://api.openai.com/v1", Credential: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Known", Model: "gpt-5.1"})
	if err != nil {
		t.Fatal(err)
	}
	requirements, err := snapshotConvert[contracts.WorkBindingRequirements](map[string]any{"models": []any{map[string]any{"key": "m-legacy", "provider": "openai", "model": "gpt-5.1", "baseUrl": nil}}, "secrets": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	var bound snapshotBindings
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		bound, err = a.resolveSnapshotBindings(tx, actor.UserID, requirements, nil)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if p := bound["m-legacy"].Profile; p.Model.API != "" || p.Model.BaseURL != nil || len(p.Model.Capabilities) != 0 {
		t.Fatal("target forced new descriptor onto legacy fixed harness")
	}
	encoded, _ := json.Marshal(bound)
	var persisted snapshotBindings
	if json.Unmarshal(encoded, &persisted) != nil {
		t.Fatal("invalid captured binding")
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		_, err := a.resolveSnapshotBindings(tx, actor.UserID, requirements, persisted)
		return err
	}); err != nil {
		t.Fatal("empty capabilities changed across persisted import binding", err)
	}
}
