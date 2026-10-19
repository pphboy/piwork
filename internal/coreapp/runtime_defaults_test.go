package coreapp

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/distribution"
)

func TestRuntimePublicWritesUseCoreReleaseAndRejectOverridesAtomically(t *testing.T) {
	a, base, admin, _ := modelManagementFixture(t)
	defaults, err := a.RuntimeDefaults()
	if err != nil {
		t.Fatal(err)
	}
	credential, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "operator.credential"))
	if err != nil {
		t.Fatal(err)
	}
	code, model := httpCall(t, base, "/api/v1/admin/models", "POST", admin, map[string]any{
		"model": "synthetic-custom", "api": "openai-responses", "baseUrl": "https://fixture.invalid/v1", "credential": "synthetic-key",
	})
	if code != 201 {
		t.Fatal(code, model)
	}
	for _, target := range []struct{ path, auth string }{
		{"/api/v1/admin/runtime", admin}, {"/control/runtime", "Operator " + strings.TrimSpace(string(credential))},
	} {
		for _, input := range []map[string]any{
			{"modelRef": model["modelRef"]},
			{"modelRef": model["modelRef"], "agentImage": defaults.AgentImage},
			{"provider": "fixture", "model": "legacy-model", "credential": "synthetic-legacy-key"},
		} {
			code, saved := httpCall(t, base, target.path, "PUT", target.auth, input)
			if code != 200 {
				t.Fatal(target.path, code, saved)
			}
			current, _ := a.Settings.RuntimeView()
			if !current.Configured || current.AgentImage != defaults.AgentImage {
				t.Fatal("runtime did not use the Core release")
			}
			before := fmtJSON(current)
			beforeDefaults, _ := a.Store.DefaultWork(context.Background())
			_, beforeModels := httpCall(t, base, "/api/v1/admin/models", "GET", admin, nil)
			bad := map[string]any{"provider": "fixture", "model": "must-not-publish", "credential": "synthetic-rejected-key", "agentImage": "fixture/override:1"}
			code, rejected := httpCall(t, base, target.path, "PUT", target.auth, bad)
			if code != 400 || rejected["field"] != "agentImage" {
				t.Fatal("image override was not rejected", code, rejected)
			}
			after, _ := a.Settings.RuntimeView()
			afterDefaults, _ := a.Store.DefaultWork(context.Background())
			_, afterModels := httpCall(t, base, "/api/v1/admin/models", "GET", admin, nil)
			if before != fmtJSON(after) || fmtJSON(beforeDefaults) != fmtJSON(afterDefaults) || fmtJSON(beforeModels) != fmtJSON(afterModels) {
				t.Fatal("rejected image changed runtime, defaults or models")
			}
		}
	}
}

func TestInvalidReleaseDoesNotReplaceSavedRuntimeOrCreateModel(t *testing.T) {
	a, base, auth, _ := modelManagementFixture(t)
	if _, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: "fixture/previous:1", Provider: "fixture", Model: "previous", Credential: "synthetic-previous-key"}); err != nil {
		t.Fatal(err)
	}
	before, _ := a.Settings.RuntimeView()
	original := distribution.EncodedImages
	distribution.EncodedImages = "invalid!"
	t.Cleanup(func() { distribution.EncodedImages = original })
	if code, current := httpCall(t, base, "/api/v1/admin/runtime", "GET", auth, nil); code != 200 || current["agentImage"] != before.AgentImage {
		t.Fatal("reading old runtime required current release defaults", code, current)
	}
	code, body := httpCall(t, base, "/api/v1/admin/runtime", "PUT", auth, map[string]any{"provider": "fixture", "model": "not-saved", "credential": "synthetic-rejected-key"})
	if code != 503 || body["code"] != "RELEASE_DEFAULTS_UNAVAILABLE" {
		t.Fatal(code, body)
	}
	after, _ := a.Settings.RuntimeView()
	if fmtJSON(before) != fmtJSON(after) {
		t.Fatal("invalid release modified old runtime")
	}
}
