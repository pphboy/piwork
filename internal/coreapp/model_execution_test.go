package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

func TestManagedModelExecutionPinsCredentialAndRejectsRevokedAuthority(t *testing.T) {
	a, actor, workID, _ := runModelFixture(t)
	ctx := context.Background()
	admin := identity.OperatorPrincipal()
	p, err := a.createModelProvider(ctx, admin, contracts.CreateModelProvider{Name: "First", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-key-one"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := a.createManagedModel(ctx, admin, string(p.Id), contracts.CreateManagedModel{Name: "Model", Model: "gpt-5"})
	if err != nil {
		t.Fatal(err)
	}
	input := modelResolutionInput{ModelRef: contracts.Supplied(string(m.ModelRef)), ModelProviderContractVersion: 1}
	accepted, key, err := a.resolveRunModel(ctx, actor, workID, input)
	if err != nil || key != "synthetic-key-one" || accepted.ExecutionBindingID == "" || accepted.API != "openai-responses" {
		t.Fatal(err, "missing execution binding")
	}
	_, err = a.patchModelProvider(ctx, admin, string(p.Id), contracts.PatchModelProvider{Credential: contracts.Supplied("synthetic-key-two")})
	if err != nil {
		t.Fatal(err)
	}
	expected := input
	expected.Expected = &accepted
	_, key, err = a.resolveRunModel(ctx, actor, workID, expected)
	if err != nil || key != "synthetic-key-one" {
		t.Fatal("accepted binding lost original credential", err)
	}
	newModel, key, err := a.resolveRunModel(ctx, actor, workID, input)
	if err != nil || key != "synthetic-key-two" || newModel.ExecutionBindingID == accepted.ExecutionBindingID {
		t.Fatal("new execution did not rotate", err)
	}
	_, err = a.patchModelProvider(ctx, admin, string(p.Id), contracts.PatchModelProvider{BaseUrl: contracts.Supplied("https://changed-fixture.invalid/v1")})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.resolveRunModel(ctx, actor, workID, input); err == nil {
		t.Fatal("retired explicit reference admitted")
	}
	_, key, err = a.resolveRunModel(ctx, actor, workID, expected)
	if err != nil || key != "synthetic-key-one" {
		t.Fatal("accepted run changed endpoint or key", err)
	}
	mutated := accepted
	mutated.API = "anthropic-messages"
	bad := input
	bad.Expected = &mutated
	if _, _, err := a.resolveRunModel(ctx, actor, workID, bad); err == nil {
		t.Fatal("changed protocol accepted")
	}
	_, err = a.modelLifecycle(ctx, admin, true, string(p.Id), "disable")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.resolveRunModel(ctx, actor, workID, expected); err == nil {
		t.Fatal("revoked execution authority accepted")
	}
}

func TestManagedModelUnavailableDefaultDoesNotHideOtherCandidates(t *testing.T) {
	a, actor, workID, _ := runModelFixture(t)
	ctx := context.Background()
	admin := identity.OperatorPrincipal()
	p, err := a.createModelProvider(ctx, admin, contracts.CreateModelProvider{Name: "Override", Api: "anthropic-messages", BaseUrl: "https://fixture.invalid", Credential: "synthetic-override"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := a.createManagedModel(ctx, admin, string(p.Id), contracts.CreateManagedModel{Name: "Model", Model: "claude-sonnet-4-5"})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE catalog_entries SET enabled=0 WHERE kind='model' AND id LIKE 'runtime-model-%'")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	list, err := a.listRunModels(ctx, actor, workID)
	if err != nil || !list.DefaultUnavailable || len(list.Models) != 1 || *list.Models[0].ModelRef != string(m.ModelRef) {
		t.Fatal("default blocked overrides", err, list.DefaultUnavailable, len(list.Models))
	}
	if _, key, err := a.resolveRunModel(ctx, actor, workID, modelResolutionInput{ModelRef: contracts.Supplied(string(m.ModelRef)), ModelProviderContractVersion: 1}); err != nil || key != "synthetic-override" {
		t.Fatal(err)
	}
	if _, err := a.modelLifecycle(ctx, admin, true, string(p.Id), "disable"); err != nil {
		t.Fatal(err)
	}
	list, err = a.listRunModels(ctx, actor, workID)
	if err != nil || !list.DefaultUnavailable || len(list.Models) != 0 {
		t.Fatal("successful empty catalog was reported as a read failure", err, list)
	}
	if _, _, err := a.resolveRunModel(ctx, actor, workID, modelResolutionInput{ModelRef: contracts.Supplied(string(m.ModelRef)), ModelProviderContractVersion: 1}); err == nil {
		t.Fatal("empty catalog allowed disabled model execution")
	}
	if _, err := a.modelLifecycle(ctx, admin, true, string(p.Id), "enable"); err != nil {
		t.Fatal(err)
	}
	list, err = a.listRunModels(ctx, actor, workID)
	if err != nil || !list.DefaultUnavailable || len(list.Models) != 1 || *list.Models[0].ModelRef != string(m.ModelRef) {
		t.Fatal("reenabled model did not recover", err, list)
	}
}

func TestManagedModelRuntimeSelectionAndDefaultPatchStayIndependent(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Models", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	first, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "A", Model: "gpt-5"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "B", Model: "gpt-5.1"})
	if err != nil {
		t.Fatal(err)
	}
	code, view := httpCall(t, base, "/api/v1/admin/runtime", "PUT", auth, map[string]any{"agentImage": "fixture/native", "modelRef": first.ModelRef})
	if code != 200 || view["runtime"].(map[string]any)["modelRef"] != string(first.ModelRef) {
		t.Fatal(code, view)
	}
	code, _ = httpCall(t, base, "/api/v1/admin/default-work", "PATCH", auth, map[string]any{"modelRef": second.ModelRef, "agentsMd": "independent"})
	if code != 200 {
		t.Fatal(code)
	}
	if err := a.ScheduleRuntimeRefresh(); err != nil {
		t.Fatal(err)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration.ModelRef != second.ModelRef || defaults.Configuration.AgentsMd != "independent" {
		t.Fatal("refresh lost default patch", err)
	}
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil || profile.ModelRef != string(second.ModelRef) || profile.Model.ID != "gpt-5.1" {
		t.Fatal("effective runtime disagrees", err)
	}
	code, _ = httpCall(t, base, "/api/v1/admin/runtime", "PUT", auth, map[string]any{"agentImage": "fixture/native", "modelRef": first.ModelRef, "credential": "must-not-mix"})
	if code != 400 {
		t.Fatal("mixed runtime input accepted", code)
	}
	_, models, err := a.registryViews(ctx)
	if err != nil || len(models) != 2 {
		t.Fatal("runtime selection duplicated registry", err)
	}
	encoded, _ := json.Marshal(profile)
	if len(encoded) == 0 {
		t.Fatal("missing captured profile")
	}
}
