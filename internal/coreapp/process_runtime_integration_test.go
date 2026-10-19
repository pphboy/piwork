//go:build integration

package coreapp

import (
	"context"
	"piwork/internal/corestore"
	"testing"
)

// Process fixtures seed persistent model state explicitly. The production
// server no longer accepts model or helper initialization via environment.
func seedProcessRuntime(t *testing.T, directory, image string) {
	t.Helper()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	files, err := store.OpenPlatformFiles()
	if err != nil {
		t.Fatal(err)
	}
	defer files.Close()
	settings := NewSettings(store, files)
	_, configured, err := settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if !configured {
		if _, err := settings.ConfigureRuntime(RuntimeInput{AgentImage: image, Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "acceptance-only"}); err != nil {
			t.Fatal(err)
		}
	}
}
