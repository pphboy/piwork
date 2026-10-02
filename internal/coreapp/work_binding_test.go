package coreapp

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func TestWorkModelSelectionCapturesCatalogRevisionWithoutChangingImage(t *testing.T) {
	first := RuntimeInput{AgentImage: "fixture/agent:v1", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "fixture-secret-one"}
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &first}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	prior, configured, err := a.Settings.LoadRuntime()
	if err != nil || !configured {
		t.Fatal("initial runtime unavailable", err)
	}
	next := first
	next.Model = "fixture-v2"
	next.Credential = "fixture-secret-two"
	_, err = a.Settings.ConfigureRuntime(next)
	if err != nil {
		t.Fatal(err)
	}
	second, configured, err := a.Settings.LoadRuntime()
	if err != nil || !configured {
		t.Fatal("new runtime profile unavailable", err)
	}
	if err := a.ensureRuntimeCatalog(context.Background(), second); err != nil {
		t.Fatal(err)
	}
	config := defaultWorkConfiguration(prior)
	config.ModelRef = runtimeModelCatalogID(second.Revision)
	previousJSON, _ := json.Marshal(prior)
	image := "sha256:" + strings.Repeat("a", 64)
	imageID, capturedJSON, sourceRevision, err := a.resolveWorkBinding(context.Background(), config, image, string(previousJSON), false, true)
	if err != nil || imageID != image || sourceRevision != second.Revision {
		t.Fatal("model reselect changed pinned image or lost catalog revision", err, imageID, sourceRevision)
	}
	var captured RuntimeProfile
	if json.Unmarshal([]byte(capturedJSON), &captured) != nil || captured.Model.ID != "fixture-v2" || captured.Model.CredentialRef == prior.Model.CredentialRef || captured.AgentImage != prior.AgentImage {
		t.Fatal("new model binding was not independently captured", captured)
	}
	config.ModelRef = contracts.ResourceId("missing-model")
	if _, _, _, err := a.resolveWorkBinding(context.Background(), config, image, string(previousJSON), false, true); err == nil {
		t.Fatal("missing model catalog reference was accepted")
	}
}
