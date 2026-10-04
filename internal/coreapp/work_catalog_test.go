package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"sync"
	"testing"

	"piwork/internal/identity"
)

func TestConcurrentAdministratorsMergeIndependentDefaultFields(t *testing.T) {
	input := RuntimeInput{AgentImage: "fixture/native-default", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "fixture-only"}
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &input}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	if _, err := a.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "other-admin", "development-fixture-pass", "admin"); err != nil {
		t.Fatal(err)
	}
	first, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "concurrent-default")
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.Identity.Login(context.Background(), "other-admin", "development-fixture-pass", "concurrent-default")
	if err != nil {
		t.Fatal(err)
	}
	start := make(chan struct{})
	var group sync.WaitGroup
	for _, patch := range []struct{ token, body string }{{first.Token, `{"baseImage":"fixture/new-image"}`}, {second.Token, `{"agentsMd":"# Independent instructions"}`}} {
		group.Add(1)
		go func() {
			defer group.Done()
			<-start
			request, err := http.NewRequest("PATCH", base+"/api/v1/admin/default-work", bytes.NewBufferString(patch.body))
			if err != nil {
				t.Error(err)
				return
			}
			request.Header.Set("Authorization", "Bearer "+patch.token)
			request.Header.Set("Content-Type", "application/json")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Error(err)
				return
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				body, _ := io.ReadAll(response.Body)
				t.Error("concurrent patch rejected", response.StatusCode, string(body))
			}
		}()
	}
	close(start)
	group.Wait()
	status, defaults := httpCall(t, base, "/api/v1/admin/default-work", "GET", "Bearer "+first.Token, nil)
	if status != 200 || defaults["baseImage"] != "fixture/new-image" || defaults["configuration"].(map[string]any)["agentsMd"] != "# Independent instructions" {
		t.Fatal("concurrent patch lost an independent field", status, defaults)
	}
	before, _ := json.Marshal(defaults)
	status, rejected := httpCall(t, base, "/api/v1/admin/default-work", "PATCH", "Bearer "+second.Token, map[string]any{"agentsMd": "must not persist", "skills": []string{"unknown-skill"}})
	if status < 400 {
		t.Fatal("invalid partial patch accepted", status, rejected)
	}
	_, unchanged := httpCall(t, base, "/api/v1/admin/default-work", "GET", "Bearer "+first.Token, nil)
	after, _ := json.Marshal(unchanged)
	if !bytes.Equal(before, after) {
		t.Fatal("invalid patch changed a valid field", unchanged)
	}
}

func TestRuntimeCatalogRetainsIndependentProfileRevisions(t *testing.T) {
	first := RuntimeInput{AgentImage: "fixture/native-a", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "fixture-only"}
	a, _, _ := appFixture(t, Options{Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &first,
	}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	previous, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	defaults, err := a.Store.DefaultWork(context.Background())
	if err != nil || defaults.Configuration == nil || defaults.Configuration.AgentImage.CatalogId != runtimeImageCatalogID(previous.Revision) {
		t.Fatal("runtime did not seed default Work configuration", err, defaults)
	}
	custom := *defaults.Configuration
	custom.AgentsMd = "# Keep this instruction"
	if _, err := a.Store.CompareAndSwapDefaultWork(context.Background(), defaults.Revision, custom); err != nil {
		t.Fatal(err)
	}
	second := RuntimeInput{AgentImage: "fixture/native-b", Provider: "piwork-deterministic", Model: "fixture-v2", Credential: "fixture-only"}
	if _, err := a.Settings.ConfigureRuntime(second); err != nil {
		t.Fatal(err)
	}
	if err := a.RefreshRuntime(context.Background()); err != nil {
		t.Fatal(err)
	}
	updatedDefaults, err := a.Store.DefaultWork(context.Background())
	if err != nil || updatedDefaults.Configuration == nil || updatedDefaults.Configuration.AgentsMd != custom.AgentsMd || updatedDefaults.Configuration.AgentImage.CatalogId != runtimeImageCatalogID(2) || updatedDefaults.Configuration.ModelRef != runtimeModelCatalogID(2) {
		t.Fatal("new runtime revision lost custom default fields", err, updatedDefaults)
	}
	if err := a.RefreshRuntime(context.Background()); err != nil {
		t.Fatal(err)
	}
	repeated, err := a.Store.DefaultWork(context.Background())
	if err != nil || repeated.Revision != updatedDefaults.Revision {
		t.Fatal("same runtime revision re-synced default Work", err, repeated)
	}
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		for _, profile := range []struct {
			id, reference string
		}{
			{"runtime-image-00000001", first.AgentImage},
			{"runtime-image-00000002", second.AgentImage},
		} {
			var reference string
			if err := tx.QueryRow(`SELECT mutable_reference FROM catalog_entries WHERE id=? AND kind='agent_image' AND enabled=1`, profile.id).Scan(&reference); err != nil {
				return err
			}
			if reference != profile.reference {
				t.Fatal("mutable runtime ref overwrote captured catalog revision", reference)
			}
		}
		var firstModel string
		if err := tx.QueryRow(`SELECT metadata_json FROM catalog_entries WHERE id=? AND kind='model'`, runtimeModelCatalogID(previous.Revision)).Scan(&firstModel); err != nil {
			return err
		}
		if firstModel == "" {
			t.Fatal("original model reference disappeared")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if defaultWorkConfiguration(previous).AgentImage.CatalogId == defaultWorkConfiguration(RuntimeProfile{Revision: 2}).AgentImage.CatalogId {
		t.Fatal("new runtime revision mutated previous Work configuration reference")
	}
}

func TestAdminDefaultWorkViewHidesInternalRevision(t *testing.T) {
	input := RuntimeInput{AgentImage: "fixture/native-default", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "fixture-only"}
	a, base, operator := appFixture(t, Options{Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &input,
	}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/default-work", "GET", "Bearer "+login.Token, nil); status != 200 || body["baseImage"] != input.AgentImage || body["configuration"] == nil || body["revision"] != nil || body["configuration"].(map[string]any)["revision"] != nil {
		t.Fatal("admin default Work projection leaked revision or lost image", status, body)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/default-work", "GET", "Operator "+operator, nil); status != 401 {
		t.Fatal("operator credential entered user admin API", status)
	}
}

func TestDefaultWorkPatchPersistsSelectionWithoutChangingEarlierConfig(t *testing.T) {
	input := RuntimeInput{AgentImage: "fixture/native-default", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "fixture-only"}
	a, base, operator := appFixture(t, Options{Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &input,
	}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	importCatalogSkillFixture(t, a)
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	previous, err := a.Store.DefaultWork(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	newImage := "fixture/another-native"
	status, view := httpCall(t, base, "/control/default-work", "PUT", "Operator "+operator, map[string]any{
		"patch": map[string]any{"baseImage": newImage, "skills": []string{}, "agentsMd": "# Workspace context"},
	})
	if status != 200 || view["baseImage"] != newImage || view["revision"] != nil {
		t.Fatal("operator default patch failed or exposed revision", status, view)
	}
	config := view["configuration"].(map[string]any)
	if len(config["skills"].([]any)) != 0 || config["agentsMd"] != "# Workspace context" || config["modelRef"] != string(previous.Configuration.ModelRef) {
		t.Fatal("operator patch lost fields", config)
	}
	stored, err := a.Store.DefaultWork(context.Background())
	if err != nil || stored.Revision != previous.Revision+1 || stored.Configuration.AgentsMd != "# Workspace context" || len(previous.Configuration.Skills) != 0 {
		t.Fatal("default revision or old copy was mutated", err, stored)
	}
	status, view = httpCall(t, base, "/api/v1/admin/default-work", "PATCH", "Bearer "+login.Token, map[string]any{"skills": []string{"catalog-skill"}})
	if status != 200 || view["baseImage"] != newImage || len(view["configuration"].(map[string]any)["skills"].([]any)) != 1 || view["revision"] != nil {
		t.Fatal("admin patch failed to merge current defaults", status, view)
	}
	for _, invalid := range []map[string]any{
		{"patch": map[string]any{}},
		{"patch": map[string]any{"skills": nil}},
		{"patch": map[string]any{"skills": []string{"unknown"}}},
		{"patch": map[string]any{"agentsMd": strings.Repeat("界", 90_000)}},
		{"patch": map[string]any{"packages": []map[string]any{{"name": "unavailable", "enabled": true}}}},
	} {
		if status, _ := httpCall(t, base, "/control/default-work", "PUT", "Operator "+operator, invalid); status != 400 && status != 409 && status != 404 {
			t.Fatal("invalid default patch was accepted", status, invalid)
		}
	}
	last, err := a.Store.DefaultWork(context.Background())
	if err != nil || last.Revision != stored.Revision+1 {
		t.Fatal("rejected patch changed default revision", err, last)
	}
}
