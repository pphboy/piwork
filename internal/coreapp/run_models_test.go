package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
)

func runModelFixture(t *testing.T) (*Application, serviceActor, string, string) {
	t.Helper()
	a, owner, id := serviceAcceptFixture(t)
	ctx := context.Background()
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	config := defaultWorkConfiguration(profile)
	raw, _ := json.Marshal(config)
	contextID := "context-model-fixture1"
	profileRaw, _ := json.Marshal(profile)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec("UPDATE work_config_revisions SET runtime_profile_json=?,config_json=? WHERE work_id=? AND revision=1", string(profileRaw), string(raw), id); err != nil {
			return err
		}
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: contextID, WorkID: id, InternalRevision: func() *int64 { v := int64(1); return &v }(), ConfigurationJSON: string(raw), ImageIdentity: "sha256:" + strings.Repeat("a", 64), CreatedByUserID: owner.User.UserID, CreatedAt: packageNow()}); err != nil {
			return err
		}
		if _, err := tx.Exec("UPDATE works SET desired_state='running',observed_state='ready',active_revision=1,active_context_id=? WHERE id=?", contextID, id); err != nil {
			return err
		}
		_, err := tx.Exec("INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-first','ready',0,?,?)", id, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: id, Generation: 1, InstanceID: "agent-first"}
	if _, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: "fixture/native", Provider: "piwork-deterministic", Model: "fixture-v2", Credential: "second-private-model-secret"}); err != nil {
		t.Fatal(err)
	}
	second, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.ensureRuntimeCatalog(ctx, second); err != nil {
		t.Fatal(err)
	}
	return a, serviceActor{Runtime: &scope}, id, string(runtimeModelCatalogID(second.Revision))
}
func TestNativeRunModelsScopeCatalogAndImmutableExecution(t *testing.T) {
	a, actor, id, second := runModelFixture(t)
	ctx := context.Background()
	list, err := a.listRunModels(ctx, actor, id)
	if err != nil || len(list.Models) != 2 || list.DefaultModel.Model != "fixture" || list.DefaultModel.ModelRef != nil {
		t.Fatal(list, err)
	}
	raw, _ := json.Marshal(list)
	if strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "credentialRef") || strings.Contains(string(raw), a.options.DataDirectory) {
		t.Fatal("private secret leaked in model description", string(raw))
	}
	model, key, err := a.resolveRunModel(ctx, actor, id, modelResolutionInput{ModelRef: contracts.Supplied(second)})
	if err != nil || key != "second-private-model-secret" || model.Model != "fixture-v2" || model.Provider != "piwork-deterministic" || model.ModelRef == nil || *model.ModelRef != second {
		t.Fatal(model, err)
	}
	expected := model
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE catalog_entries SET metadata_json=json_set(metadata_json,'$.id','changed') WHERE id=?`, second)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := a.resolveRunModel(ctx, actor, id, modelResolutionInput{ModelRef: contracts.Supplied(second), Expected: &expected}); err == nil {
		t.Fatal("changed execution descriptor fell back")
	}
	other := *actor.Runtime
	other.WorkID = "work-other-0000000001"
	if _, err := a.listRunModels(ctx, serviceActor{Runtime: &other}, id); !errors.Is(err, internaltls.ErrIdentity) {
		t.Fatal("cross Work accepted", err)
	}
	stale := *actor.Runtime
	stale.Generation = 2
	if _, _, err := a.resolveRunModel(ctx, serviceActor{Runtime: &stale}, id, modelResolutionInput{ModelRef: contracts.Supplied(second)}); !errors.Is(err, internaltls.ErrStale) {
		t.Fatal("stale generation accepted", err)
	}
	wrongInstallation := *actor.Runtime
	wrongInstallation.InstallationID = "another"
	if _, err := a.listRunModels(ctx, serviceActor{Runtime: &wrongInstallation}, id); !errors.Is(err, internaltls.ErrIdentity) {
		t.Fatal("cross installation accepted", err)
	}
	server := serviceRPC{App: a}
	if _, err := server.ListRunModels(ctx, &servicesv1.Empty{}); status.Code(err) != codes.Unauthenticated {
		t.Fatal("private RPC accepted an unauthenticated request", err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE runtime_generations SET state='stopped' WHERE work_id=?", id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.listRunModels(ctx, actor, id); !errors.Is(err, internaltls.ErrStale) {
		t.Fatal("revoked model authority accepted", err)
	}
}
func TestNativeRunModelsUnavailableEntriesAndCatalogFailure(t *testing.T) {
	a, actor, id, second := runModelFixture(t)
	ctx := context.Background()
	for _, mutation := range []string{"UPDATE catalog_entries SET enabled=0 WHERE id=?", `UPDATE catalog_entries SET enabled=1,metadata_json=json_set(metadata_json,'$.version',99) WHERE id=?`} {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error { _, err := tx.Exec(mutation, second); return err }); err != nil {
			t.Fatal(err)
		}
		list, err := a.listRunModels(ctx, actor, id)
		if err != nil || len(list.Models) != 1 {
			t.Fatal(list, err)
		}
		if _, _, err := a.resolveRunModel(ctx, actor, id, modelResolutionInput{ModelRef: contracts.Supplied(second)}); err == nil {
			t.Fatal("unavailable explicit selection fell back")
		}
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("ALTER TABLE catalog_entries RENAME TO catalog_unavailable")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.listRunModels(ctx, actor, id); !errors.Is(err, corestore.ErrStorage) {
		t.Fatal("catalog failure returned an empty success", err)
	}
}
func TestNativeRunModelsMissingCredentialAndStrictSelector(t *testing.T) {
	a, actor, id, second := runModelFixture(t)
	ctx := context.Background()
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.files.RemoveSecret(profile.Model.CredentialRef); err != nil {
		t.Fatal(err)
	}
	list, err := a.listRunModels(ctx, actor, id)
	if err != nil || len(list.Models) != 1 {
		t.Fatal(list, err)
	}
	if _, _, err := a.resolveRunModel(ctx, actor, id, modelResolutionInput{ModelRef: contracts.Supplied(second)}); err == nil {
		t.Fatal("unreadable secret resolved")
	}
	for _, input := range []modelResolutionInput{{}, {ModelRef: contracts.Supplied("")}, {ModelRef: contracts.Supplied("bad")}} {
		if _, _, err := a.resolveRunModel(ctx, actor, id, input); err == nil {
			t.Fatal("invalid selector accepted")
		}
	}
	defaultModel, _, err := a.resolveRunModel(ctx, actor, id, modelResolutionInput{ModelRef: contracts.Field[string]{Present: true, Null: true}})
	if err != nil || defaultModel.Model != "fixture" {
		t.Fatal(defaultModel, err)
	}
}

func TestNativeRunModelDefaultAvailabilityAndEndpointNormalization(t *testing.T) {
	a, actor, id, _ := runModelFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE catalog_entries SET enabled=0 WHERE kind='model'")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if list, err := a.listRunModels(ctx, actor, id); err != nil || !list.DefaultUnavailable || len(list.Models) != 0 {
		t.Fatal("disabled models did not produce a confirmed empty catalog", err, list)
	}
	if _, _, err := a.resolveRunModel(ctx, actor, id, modelResolutionInput{ModelRef: contracts.Field[string]{Present: true, Null: true}}); err == nil {
		t.Fatal("unavailable default allowed execution")
	}
	for input, expected := range map[string]string{"https://EXAMPLE.test:443/": "https://example.test", "http://localhost:80/api/": "http://localhost/api", "http://[::1]:80/": "http://[::1]", "https://example.test/a/../api": "https://example.test/api"} {
		actual, err := normalizeRunModelEndpoint(&input)
		if err != nil || actual == nil || *actual != expected {
			t.Fatal(input, actual, err)
		}
	}
	for _, input := range []string{"https://name:secret@example.test/", "https://example.test/?token=secret", "https://example.test/#fragment", "file:///tmp/secret"} {
		if _, err := normalizeRunModelEndpoint(&input); err == nil {
			t.Fatal("unsafe model endpoint accepted", input)
		}
	}
}
