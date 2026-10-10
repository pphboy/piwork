package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func modelManagementFixture(t *testing.T) (*Application, string, string, identity.Principal) {
	t.Helper()
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "synthetic-admin-password"}}})
	session, err := a.Identity.Login(context.Background(), "admin", "synthetic-admin-password", "model-management")
	if err != nil {
		t.Fatal(err)
	}
	verified, err := a.Identity.Authenticate(context.Background(), session.Token)
	if err != nil {
		t.Fatal(err)
	}
	return a, base, "Bearer " + session.Token, verified.Principal()
}
func TestModelManagementProviderModelsLifecycleAndSafeViews(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	create := func(name, api string) map[string]any {
		t.Helper()
		code, p := httpCall(t, base, "/api/v1/admin/model-providers", "POST", auth, map[string]any{"name": name, "api": api, "baseUrl": "https://fixture.invalid", "credential": "synthetic-provider-secret"})
		if code != 201 {
			t.Fatal(code, p)
		}
		return p
	}
	p := create("Responses gateway", "openai-responses")
	p2 := create("Messages gateway", "anthropic-messages")
	pid := p["id"].(string)
	model := func(provider string, name string) map[string]any {
		t.Helper()
		code, m := httpCall(t, base, "/api/v1/admin/model-providers/"+provider+"/models", "POST", auth, map[string]any{"name": name, "model": "same-model"})
		if code != 201 {
			t.Fatal(code, m)
		}
		return m
	}
	m := model(pid, "First")
	_ = model(p2["id"].(string), "Second")
	if code, _ := httpCall(t, base, "/api/v1/admin/model-providers/"+pid+"/models", "POST", auth, map[string]any{"name": "Duplicate", "model": "same-model"}); code != 409 {
		t.Fatal("duplicate accepted", code)
	}
	code, view := httpCall(t, base, "/api/v1/admin/models", "GET", auth, nil)
	if code != 200 || len(view["models"].([]any)) != 2 {
		t.Fatal(code, view)
	}
	raw, _ := json.Marshal(view)
	if strings.Contains(string(raw), "synthetic-provider-secret") || strings.Contains(string(raw), "credentialRef") {
		t.Fatal("secret escaped")
	}
	var before string
	_ = a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err == nil {
			before = r.Providers[pid].CredentialRef
		}
		return err
	})
	if _, err := a.patchModelProvider(context.Background(), actor, pid, contracts.PatchModelProvider{Name: contracts.Supplied("Renamed")}); err != nil {
		t.Fatal(err)
	}
	_ = a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err == nil && r.Providers[pid].CredentialRef != before {
			t.Fatal("omitted key replaced")
		}
		return err
	})
	if _, err := a.patchModelProvider(context.Background(), actor, pid, contracts.PatchModelProvider{Credential: contracts.Supplied("synthetic-new-secret")}); err != nil {
		t.Fatal(err)
	}
	_ = a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err == nil {
			if r.Providers[pid].CredentialRef == before {
				t.Fatal("key not rotated")
			}
			if r.Models[m["id"].(string)].ModelRef != m["modelRef"] {
				t.Fatal("key rotation changed model")
			}
		}
		return err
	})
	if code, _ := httpCall(t, base, "/api/v1/admin/model-providers/"+pid, "PATCH", auth, map[string]any{"api": "anthropic-messages"}); code != 400 {
		t.Fatal("protocol edited", code)
	}
	if _, err := a.modelLifecycle(context.Background(), actor, false, m["id"].(string), "disable"); err != nil {
		t.Fatal(err)
	}
	_, _ = a.modelLifecycle(context.Background(), actor, true, pid, "disable")
	_, _ = a.modelLifecycle(context.Background(), actor, true, pid, "enable")
	_, models, err := a.registryViews(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, current := range models {
		if string(current.Id) == m["id"] && current.Enabled {
			t.Fatal("reenabled a disabled child")
		}
	}
	if _, err := a.modelLifecycle(context.Background(), actor, true, pid, "delete"); err == nil {
		t.Fatal("cascade delete accepted")
	}
	_, _ = a.modelLifecycle(context.Background(), actor, false, m["id"].(string), "delete")
	if _, err := a.modelLifecycle(context.Background(), actor, true, pid, "delete"); err != nil {
		t.Fatal(err)
	}
}
func TestModelManagementEditsPublishNewBindingsAndPersist(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Gateway", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-key"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Model", Model: "fixture-model"})
	if err != nil {
		t.Fatal(err)
	}
	renamed, err := a.patchManagedModel(ctx, actor, string(m.Id), contracts.PatchManagedModel{Name: contracts.Supplied("New label")})
	if err != nil || renamed.ModelRef != m.ModelRef {
		t.Fatal(err, "name edit changed binding")
	}
	_, err = a.patchModelProvider(ctx, actor, string(p.Id), contracts.PatchModelProvider{BaseUrl: contracts.Supplied("https://new-fixture.invalid/v1")})
	if err != nil {
		t.Fatal(err)
	}
	_, models, err := a.registryViews(ctx)
	if err != nil || models[0].ModelRef == m.ModelRef {
		t.Fatal(err, "endpoint edit did not publish binding")
	}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		var raw string
		err := tx.QueryRow("SELECT metadata_json FROM catalog_entries WHERE id=?", m.ModelRef).Scan(&raw)
		if err != nil {
			return err
		}
		if !strings.Contains(raw, "https://fixture.invalid/v1") {
			t.Fatal("old binding mutated")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	data := a.options.DataDirectory
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(ctx, Options{DataDirectory: data})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close(ctx)
	providers, restored, err := reopened.registryViews(ctx)
	if err != nil || len(providers) != 1 || len(restored) != 1 || restored[0].ModelRef != models[0].ModelRef {
		t.Fatal("restart lost registry", err)
	}
}
func TestModelManagementAuthorizationAndMalformedInput(t *testing.T) {
	a, base, auth, _ := modelManagementFixture(t)
	ctx := context.Background()
	_, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "user", "synthetic-user-password", "user")
	if err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Login(ctx, "user", "synthetic-user-password", "models")
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/v1/admin/model-providers", "/api/v1/admin/models"} {
		if code, _ := httpCall(t, base, path, "GET", "Bearer "+session.Token, nil); code != 403 {
			t.Fatal(code)
		}
		if code, _ := httpCall(t, base, path, "GET", "Operator synthetic", nil); code != 401 {
			t.Fatal(code)
		}
	}
	for _, in := range []map[string]any{{"name": "One", "api": "openai-completions", "baseUrl": "https://fixture.invalid", "credential": "synthetic"}, {"name": "One", "api": "openai-responses", "baseUrl": "https://user:password@fixture.invalid", "credential": "synthetic"}, {"name": "One", "api": "anthropic-messages", "baseUrl": "not-a-url", "credential": "synthetic"}, {"name": "One", "api": "openai-responses", "baseUrl": "https://fixture.invalid", "credential": ""}} {
		if code, _ := httpCall(t, base, "/api/v1/admin/model-providers", "POST", auth, in); code != 400 {
			t.Fatal("bad input accepted", code)
		}
	}
	if code, _ := httpCall(t, base, "/api/v1/admin/model-providers", "PUT", auth, map[string]any{}); code != 405 {
		t.Fatal(code)
	}
}
func TestModelHTTPTestProtocolsDraftsAndNoWrites(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	ctx := context.Background()
	for _, api := range []string{"openai-responses", "anthropic-messages"} {
		t.Run(api, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				var body map[string]any
				if json.NewDecoder(r.Body).Decode(&body) != nil {
					t.Error("bad request")
				}
				if body["model"] != "synthetic-model" || body["stream"] != false {
					t.Error("wrong request")
				}
				w.Header().Set("Content-Type", "application/json")
				if api == "openai-responses" {
					if r.URL.Path != "/v1/responses" || r.Header.Get("Authorization") != "Bearer synthetic-key" || body["input"] != modelTestMessage {
						t.Error("wrong responses request")
					}
					_, _ = w.Write([]byte(`{"status":"completed","error":null,"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Actual Responses reply"}]}]}`))
				} else {
					if r.URL.Path != "/v1/messages" || r.Header.Get("x-api-key") != "synthetic-key" || r.Header.Get("anthropic-version") != "2023-06-01" || body["messages"] == nil {
						t.Error("wrong messages request")
					}
					messages := body["messages"].([]any)
					if len(messages) != 1 || messages[0].(map[string]any)["role"] != "user" || messages[0].(map[string]any)["content"] != modelTestMessage {
						t.Error("wrong fixed user message")
					}
					_, _ = w.Write([]byte(`{"type":"message","role":"assistant","content":[{"type":"text","text":"Actual Messages reply"}]}`))
				}
			}))
			defer server.Close()
			endpoint := server.URL
			if api == "openai-responses" {
				endpoint += "/v1"
			}
			code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": api, "baseUrl": endpoint, "model": "synthetic-model", "credential": "synthetic-key"})
			if code != 200 || result["success"] != true || calls != 1 || result["testMessage"] != modelTestMessage || !strings.HasPrefix(result["replyText"].(string), "Actual ") || result["replyTruncated"] != false || contracts.Validate("ModelTestResultSchema", result) != nil {
				t.Fatal(code, result, calls)
			}
			providers, models, err := a.registryViews(ctx)
			if err != nil || len(providers) != 0 || len(models) != 0 {
				t.Fatal("Test mutated registry", err)
			}
			p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Test provider", Api: contracts.ModelApi(api), BaseUrl: endpoint, Credential: "synthetic-key"})
			if err != nil {
				t.Fatal(err)
			}
			code, result = httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"providerId": p.Id, "model": "synthetic-model"})
			if code != 200 || result["success"] != true {
				t.Fatal(code, result)
			}
			_, _ = a.modelLifecycle(ctx, actor, true, string(p.Id), "delete")
		})
	}
}
func TestModelHTTPTestErrorsBudgetsAndFailureDoesNotGateSave(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	for _, tc := range []struct {
		status         int
		body, category string
	}{{401, `synthetic-secret echoed`, "authentication"}, {404, `{}`, "model"}, {429, `{}`, "rate-limit"}, {200, `{"error":{"message":"synthetic-secret"}}`, "protocol"}, {200, `{}`, "protocol"}, {200, strings.Repeat("x", 65537), "response-limit"}, {302, `{}`, "protocol"}} {
		t.Run(tc.category, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.Header().Set("Location", "https://fixture.invalid")
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "openai-responses", "baseUrl": server.URL, "model": "fixture", "credential": "synthetic-secret"})
			raw, _ := json.Marshal(result)
			if code != 200 || result["success"] != false || result["category"] != tc.category || calls != 1 || strings.Contains(string(raw), "synthetic-secret") {
				t.Fatal(code, result, calls)
			}
		})
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(100 * time.Millisecond):
		}
	}))
	defer server.Close()
	a.modelTestTimeout = 20 * time.Millisecond
	code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "openai-responses", "baseUrl": server.URL, "model": "fixture", "credential": "synthetic"})
	if code != 200 || result["category"] != "timeout" {
		t.Fatal(code, result)
	}
	p, err := a.createModelProvider(context.Background(), actor, contracts.CreateModelProvider{Name: "Failed Test still saves", Api: "openai-responses", BaseUrl: server.URL, Credential: "synthetic"})
	if err != nil || !p.Enabled {
		t.Fatal("Test gated saving", err)
	}
	a.modelTests.Store(actor.UserID, true)
	code, _ = httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"providerId": p.Id, "model": "fixture"})
	a.modelTests.Delete(actor.UserID)
	if code != 429 {
		t.Fatal("Test capacity not bounded", code)
	}
}
func TestModelManagementConcurrentPatchesMergeIndependentFields(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Before", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-old"})
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var group sync.WaitGroup
	for _, patch := range []contracts.PatchModelProvider{{Name: contracts.Supplied("After")}, {Credential: contracts.Supplied("synthetic-new")}} {
		group.Add(1)
		go func(in contracts.PatchModelProvider) {
			defer group.Done()
			<-start
			if _, err := a.patchModelProvider(ctx, actor, string(p.Id), in); err != nil {
				t.Error(err)
			}
		}(patch)
	}
	close(start)
	group.Wait()
	providers, _, err := a.registryViews(ctx)
	if err != nil || providers[0].Name != "After" {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		key, err := a.files.ReadSecret(r.Providers[string(p.Id)].CredentialRef)
		if err == nil && string(key) != "synthetic-new\n" {
			t.Fatal("key update lost")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestModelManagementKeyFailureDoesNotPublishPartialRegistry(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	for _, stage := range []string{"after-key-write", "before-head-commit"} {
		a.modelRegistryFault = func(actual string) error {
			if actual == stage {
				return errors.New("synthetic publication failure")
			}
			return nil
		}
		_, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Must not appear", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-staged"})
		if err == nil {
			t.Fatal("injected failure ignored")
		}
		providers, _, err := a.registryViews(ctx)
		if err != nil || len(providers) != 0 {
			t.Fatal("partial registry published", err)
		}
	}
	a.modelRegistryFault = nil
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Original", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-original"})
	if err != nil {
		t.Fatal(err)
	}
	a.modelRegistryFault = func(stage string) error {
		if stage == "before-head-commit" {
			return errors.New("synthetic publication failure")
		}
		return nil
	}
	_, err = a.patchModelProvider(ctx, actor, string(p.Id), contracts.PatchModelProvider{Credential: contracts.Supplied("synthetic-replacement")})
	if err == nil {
		t.Fatal("rotation failure ignored")
	}
	a.modelRegistryFault = nil
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		key, err := a.files.ReadSecret(r.Providers[string(p.Id)].CredentialRef)
		if err == nil && string(key) != "synthetic-original\n" {
			t.Fatal("failed rotation replaced key")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestModelManagementRuntimeAdoptionPreservesReferencesAndDisabledState(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	_, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: "fixture/native", Provider: "openai", Model: "gpt-5", Credential: "synthetic-bootstrap"})
	if err != nil {
		t.Fatal(err)
	}
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ensureRuntimeCatalog(ctx, profile); err != nil {
		t.Fatal(err)
	}
	providers, models, err := a.registryViews(ctx)
	if err != nil || len(providers) != 1 || len(models) != 1 || models[0].ModelRef != runtimeModelCatalogID(profile.Revision) {
		t.Fatal("legacy reference not retained", err)
	}
	_, err = a.modelLifecycle(ctx, actor, true, string(providers[0].Id), "disable")
	if err != nil {
		t.Fatal(err)
	}
	for range 3 {
		if err := a.ensureRuntimeCatalog(ctx, profile); err != nil {
			t.Fatal(err)
		}
	}
	providers, models, err = a.registryViews(ctx)
	if err != nil || len(providers) != 1 || len(models) != 1 || providers[0].Enabled {
		t.Fatal("refresh duplicated or reenabled registry", err)
	}
}

func TestModelManagementDeletionProtectsDefaultAcrossBindingEdits(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Referenced", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Default", Model: "gpt-5"})
	if err != nil {
		t.Fatal(err)
	}
	config := defaultWorkConfiguration(RuntimeProfile{Revision: 1})
	config.ModelRef = m.ModelRef
	if _, err := a.Store.CompareAndSwapDefaultWork(ctx, 0, config); err != nil {
		t.Fatal(err)
	}
	_, err = a.patchModelProvider(ctx, actor, string(p.Id), contracts.PatchModelProvider{BaseUrl: contracts.Supplied("https://updated-fixture.invalid/v1")})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.modelLifecycle(ctx, actor, false, string(m.Id), "delete"); err == nil {
		t.Fatal("deleted old captured default reference")
	}
}

func TestManagedModelDeletionProtectsLiveWorkButNotHistoricalContext(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Work provider", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	m, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Work model", Model: "gpt-5"})
	if err != nil {
		t.Fatal(err)
	}
	config := defaultWorkConfiguration(RuntimeProfile{Revision: 1})
	config.ModelRef = m.ModelRef
	raw, _ := json.Marshal(config)
	workID, contextID := "work-model-dependency1", "context-model-dependency1"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: workID, OwnerUserID: actor.UserID, Name: "synthetic Work", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: modelNow(), UpdatedAt: modelNow()}); err != nil {
			return err
		}
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: contextID, WorkID: workID, ConfigurationJSON: string(raw), ImageIdentity: "sha256:" + strings.Repeat("a", 64), CreatedByUserID: actor.UserID, CreatedAt: modelNow()}); err != nil {
			return err
		}
		_, err := tx.Exec("UPDATE works SET active_context_id=?,desired_context_id=? WHERE id=?", contextID, contextID, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	_, err = a.modelLifecycle(ctx, actor, false, string(m.Id), "delete")
	_, view := contracts.ProjectError(err)
	if view.Code != "MODEL_IN_USE" || strings.Contains(view.Message, workID) {
		t.Fatal("live dependency not protected")
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE works SET deleted_at=? WHERE id=?", modelNow(), workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.modelLifecycle(ctx, actor, false, string(m.Id), "delete"); err != nil {
		t.Fatal("historical context blocked deletion", err)
	}
}

func TestManagedModelBindingCapturesProtocolAndKeepsOldDefinitionOnUnrelatedEdit(t *testing.T) {
	a, _, _, actor := modelManagementFixture(t)
	ctx := context.Background()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Binding", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic"})
	if err != nil {
		t.Fatal(err)
	}
	caps := json.RawMessage(`{"kind":"sdk","provider":"openai","model":"gpt-5.1"}`)
	m, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Alias", Model: "private-alias", Capabilities: contracts.Supplied(caps)})
	if err != nil {
		t.Fatal(err)
	}
	config := defaultWorkConfiguration(RuntimeProfile{Revision: 1})
	config.ModelRef = m.ModelRef
	prior := RuntimeProfile{Version: 1, Revision: 1, AgentImage: "fixture/native"}
	prior.Model.CredentialRef = "synthetic-prior-reference"
	priorRaw, _ := json.Marshal(prior)
	image := "sha256:" + strings.Repeat("a", 64)
	_, captured, _, err := a.resolveWorkBinding(ctx, config, image, string(priorRaw), false, true)
	if err != nil {
		t.Fatal(err)
	}
	var profile RuntimeProfile
	if json.Unmarshal([]byte(captured), &profile) != nil || profile.Model.API != "openai-responses" || profile.Model.ID != "private-alias" || string(profile.Model.Capabilities) != string(caps) {
		t.Fatal("model definition not captured")
	}
	_, err = a.patchModelProvider(ctx, actor, string(p.Id), contracts.PatchModelProvider{BaseUrl: contracts.Supplied("https://changed-fixture.invalid/v1"), Credential: contracts.Supplied("synthetic-new")})
	if err != nil {
		t.Fatal(err)
	}
	_, retained, _, err := a.resolveWorkBinding(ctx, config, image, captured, false, false)
	if err != nil || retained != captured {
		t.Fatal("unrelated edit changed captured model", err)
	}
}
