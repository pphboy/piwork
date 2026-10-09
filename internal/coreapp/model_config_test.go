package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"piwork/internal/contracts"
	"strings"
	"testing"
)

func TestFlatModelAtomicLifecycleAndIndependentConnections(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	create := func(key string) map[string]any {
		t.Helper()
		code, m := httpCall(t, base, "/api/v1/admin/models", "POST", auth, map[string]any{"model": "custom-unknown", "api": "anthropic-messages", "baseUrl": "https://fixture.invalid/v1/", "credential": key})
		if code != 201 {
			t.Fatal(code, m)
		}
		return m
	}
	first := create("synthetic-first")
	second := create("synthetic-second")
	if first["name"] != "custom-unknown" || first["baseUrl"] != "https://fixture.invalid" || first["modelRef"] == second["modelRef"] {
		t.Fatal(first, second)
	}
	for _, m := range []map[string]any{first, second} {
		for _, field := range []string{"providerId", "providerName", "capabilities", "credential", "credentialRef", "credentialVersion"} {
			if _, ok := m[field]; ok {
				t.Fatal("private or obsolete field", field)
			}
		}
	}
	id := first["id"].(string)
	ref := first["modelRef"]
	for _, input := range []map[string]any{{"baseUrl": "https://fixture.invalid/v1"}, {"name": ""}, {"credential": "synthetic-rotated"}} {
		code, v := httpCall(t, base, "/api/v1/admin/models/"+id, "PATCH", auth, input)
		if code != 200 || v["modelRef"] != ref {
			t.Fatal(code, v)
		}
	}
	_ = a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		r, e := modelRegistryTx(tx)
		if e != nil {
			t.Fatal(e)
		}
		one := modelConnection(r, r.Models[id])
		two := modelConnection(r, r.Models[second["id"].(string)])
		k1, _ := a.files.ReadSecret(one.CredentialRef)
		k2, _ := a.files.ReadSecret(two.CredentialRef)
		if strings.TrimSpace(string(k1)) != "synthetic-rotated" || strings.TrimSpace(string(k2)) != "synthetic-second" {
			t.Fatal("sibling credential changed")
		}
		return nil
	})
	code, v := httpCall(t, base, "/api/v1/admin/models/"+id, "PATCH", auth, map[string]any{"model": "custom-changed"})
	if code != 200 || v["modelRef"] == ref {
		t.Fatal(code, v)
	}
	if code, _ := httpCall(t, base, "/api/v1/admin/models/"+id, "PATCH", auth, map[string]any{"credential": ""}); code != 400 {
		t.Fatal("blank replacement key admitted", code)
	}
	if code, _ := httpCall(t, base, "/api/v1/admin/models/"+id, "PATCH", auth, map[string]any{"providerId": "provider-private", "capabilities": map[string]any{}}); code != 400 {
		t.Fatal("obsolete fields admitted", code)
	}
	for _, action := range []string{"disable", "enable"} {
		code, v := httpCall(t, base, "/api/v1/admin/models/"+id+"/"+action, "POST", auth, map[string]any{})
		if code != 200 || v["enabled"] != (action == "enable") {
			t.Fatal(code, v)
		}
	}
	if code, _ := httpCall(t, base, "/api/v1/admin/models/"+id, "DELETE", auth, nil); code != 204 {
		t.Fatal(code)
	}
	if code, v := httpCall(t, base, "/api/v1/admin/models", "GET", auth, nil); code != 200 || len(v["models"].([]any)) != 1 {
		t.Fatal(code, v)
	}
	a.modelRegistryFault = func(stage string) error {
		if stage == "before-head-commit" {
			return errors.New("synthetic rollback")
		}
		return nil
	}
	_, e := a.createModelConfig(context.Background(), actor, contracts.CreateModelConfig{Model: "rollback", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-rollback"})
	if e == nil {
		t.Fatal("fault ignored")
	}
	views, e := a.modelConfigViews(context.Background())
	if e != nil || len(views) != 1 {
		t.Fatal("partial head saved", e, views)
	}
}

func TestLegacyProviderMappingPreservesIdentityAndEffectiveState(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, e := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Legacy", Api: "anthropic-messages", BaseUrl: "https://fixture.invalid", Credential: "synthetic-legacy"})
	if e != nil {
		t.Fatal(e)
	}
	one, e := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "First", Model: "custom-one"})
	if e != nil {
		t.Fatal(e)
	}
	two, e := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Second", Model: "custom-two"})
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.modelLifecycle(ctx, actor, true, string(p.Id), "disable")
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Unused provider", Api: "openai-responses", BaseUrl: "https://unused.invalid/v1", Credential: "synthetic-unused"})
	if e != nil {
		t.Fatal(e)
	}
	definition := json.RawMessage(`{"kind":"explicit","definition":{"reasoning":false,"input":["text"],"contextWindow":10000,"maxTokens":1000}}`)
	one, e = a.patchManagedModel(ctx, actor, string(one.Id), contracts.PatchManagedModel{Capabilities: contracts.Supplied(definition)})
	if e != nil {
		t.Fatal(e)
	}
	// Produce the actual legacy persisted shape, including a provider without models.
	e = a.Store.Write(ctx, func(tx *sql.Tx) error {
		r, e := modelRegistryTx(tx)
		if e != nil {
			return e
		}
		r.Version = 1
		for _, m := range r.Models {
			m.Connection = nil
		}
		return saveModelRegistryTx(tx, r)
	})
	if e != nil {
		t.Fatal(e)
	}
	a.modelRegistryFault = func(stage string) error {
		if stage == "before-registry-migration" {
			return errors.New("synthetic migration rollback")
		}
		return nil
	}
	if e = a.adoptRuntimeModels(ctx); e == nil {
		t.Fatal("migration fault ignored")
	}
	_ = a.Store.Read(ctx, func(tx *sql.Tx) error {
		var raw string
		if e := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", modelRegistryKey).Scan(&raw); e != nil {
			return e
		}
		var saved modelRegistry
		_ = json.Unmarshal([]byte(raw), &saved)
		if saved.Version != 1 || saved.Models[string(one.Id)].Connection != nil {
			t.Fatal("failed migration partially persisted")
		}
		return nil
	})
	a.modelRegistryFault = nil
	options := a.options
	if e = a.Close(ctx); e != nil {
		t.Fatal(e)
	}
	a, e = New(ctx, options)
	if e != nil {
		t.Fatal("registry migration without Runtime failed on restart", e)
	}
	t.Cleanup(func() { _ = a.Close(context.Background()) })
	for i := 0; i < 2; i++ {
		if e = a.adoptRuntimeModels(ctx); e != nil {
			t.Fatal(e)
		}
	}
	views, e := a.modelConfigViews(ctx)
	if e != nil || len(views) != 2 {
		t.Fatal(e, views)
	}
	for _, v := range views {
		if v.Enabled {
			t.Fatal("migration reenabled model")
		}
	}
	_, e = a.modelLifecycle(ctx, actor, false, string(one.Id), "enable")
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.writeModelConfig(ctx, actor, string(one.Id), contracts.PatchModelConfig{Credential: contracts.Supplied("synthetic-one-only"), BaseUrl: contracts.Supplied("https://changed.invalid/v1")})
	if e != nil {
		t.Fatal(e)
	}
	e = a.Store.Read(ctx, func(tx *sql.Tx) error {
		r, e := modelRegistryTx(tx)
		if e != nil {
			return e
		}
		m1 := r.Models[string(one.Id)]
		m2 := r.Models[string(two.Id)]
		if string(m1.Capabilities) != string(definition) {
			t.Fatal("legacy explicit definition lost")
		}
		if m1.ID != string(one.Id) || m2.ModelRef != string(two.ModelRef) || modelConnection(r, m2).Enabled || modelConnection(r, m2).BaseURL != "https://fixture.invalid" {
			t.Fatal("legacy identity/state changed")
		}
		k, _ := a.files.ReadSecret(modelConnection(r, m2).CredentialRef)
		if strings.TrimSpace(string(k)) != "synthetic-legacy" {
			t.Fatal("legacy sibling key changed")
		}
		var raw string
		_ = tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", modelRegistryKey).Scan(&raw)
		var stored map[string]any
		_ = json.Unmarshal([]byte(raw), &stored)
		if stored["version"] != float64(2) {
			t.Fatal("migration not persisted")
		}
		return nil
	})
	if e != nil {
		t.Fatal(e)
	}
}

func TestFlatModelLongNamesRoundTripAndLegacyProjection(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	ctx := context.Background()
	for _, length := range []int{129, 256} {
		for _, character := range []string{"x", "模", "😀"} {
			value := strings.Repeat(character, length)
			code, created := httpCall(t, base, "/api/v1/admin/models", "POST", auth, map[string]any{"model": value, "api": "anthropic-messages", "baseUrl": "https://fixture.invalid", "credential": "synthetic-long-name"})
			if code != 201 || created["name"] != value || contracts.Validate("ModelConfigSchema", created) != nil {
				t.Fatal("default name did not match valid long ID", code)
			}
			id, ref := created["id"].(string), created["modelRef"]
			for _, name := range []string{strings.Repeat("名", length), ""} {
				code, view := httpCall(t, base, "/api/v1/admin/models/"+id, "PATCH", auth, map[string]any{"name": name})
				want := name
				if want == "" {
					want = value
				}
				if code != 200 || view["name"] != want || view["modelRef"] != ref || contracts.Validate("ModelConfigSchema", view) != nil {
					t.Fatal("long name edit/reset failed", code)
				}
			}
			code, view := httpCall(t, base, "/api/v1/admin/models/"+id, "GET", auth, nil)
			if code != 200 || view["name"] != value || contracts.Validate("ModelConfigSchema", view) != nil {
				t.Fatal("long model read invalid", code)
			}
			if code, _ := httpCall(t, base, "/api/v1/admin/models/"+id, "PATCH", auth, map[string]any{"name": strings.Repeat(character, 257)}); code != 400 {
				t.Fatal("oversize name admitted", code)
			}
		}
	}
	providers, legacy, err := a.registryViews(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if contracts.Validate("ModelProviderListSchema", contracts.ModelProviderList{Providers: providers}) != nil || contracts.Validate("ManagedModelListSchema", contracts.ManagedModelList{Models: legacy}) != nil {
		t.Fatal("compatibility projection violated legacy DTO")
	}
	for _, p := range providers {
		if len([]rune(p.Name)) != 128 {
			t.Fatal("legacy alias length")
		}
	}
	_ = a.Store.Read(ctx, func(tx *sql.Tx) error {
		r, e := modelRegistryTx(tx)
		if e != nil {
			t.Fatal(e)
		}
		for _, m := range r.Models {
			if m.Name != m.Model || len([]rune(m.Name)) < 129 || modelConnection(r, m).Name != m.Model {
				t.Fatal("legacy projection mutated canonical values")
			}
		}
		return nil
	})
	// Legacy input limits remain intact even though new model output is wider.
	if _, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: strings.Repeat("x", 129), Api: "anthropic-messages", BaseUrl: "https://fixture.invalid", Credential: "synthetic-key"}); err == nil {
		t.Fatal("legacy input constraint changed")
	}
	options := a.options
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	a, err = New(ctx, options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close(context.Background()) })
	models, err := a.modelConfigViews(ctx)
	if err != nil || len(models) != 6 {
		t.Fatal("long name restart failed", err)
	}
	for _, m := range models {
		if m.Name != m.Model || contracts.Validate("ModelConfigSchema", m) != nil {
			t.Fatal("long name lost on restart")
		}
	}
}

func TestCapturedModelIDSurvivesCurrentHeadAndLabelEdit(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	first, err := a.createModelConfig(ctx, actor, contracts.CreateModelConfig{Model: "old-id", Name: contracts.Supplied("Friendly old"), Api: "anthropic-messages", BaseUrl: "https://fixture.invalid", Credential: "synthetic-captured-key"})
	if err != nil {
		t.Fatal(err)
	}
	current, err := a.writeModelConfig(ctx, actor, string(first.Id), contracts.PatchModelConfig{Model: contracts.Supplied("new-id"), Name: contracts.Supplied("Friendly new")})
	if err != nil {
		t.Fatal(err)
	}
	if current.Id != first.Id || current.ModelRef == first.ModelRef {
		t.Fatal("head publication changed stable identity")
	}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		old, label, _, err := a.catalogModelTx(tx, string(first.ModelRef), false)
		if err != nil {
			return err
		}
		if old.ID != "old-id" || label != "Friendly new" {
			t.Fatal("captured identity or live label unexpected")
		}
		head, _, _, err := a.catalogModelTx(tx, string(current.ModelRef), true)
		if err != nil {
			return err
		}
		if head.ID != "new-id" {
			t.Fatal("current head identity unexpected")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
