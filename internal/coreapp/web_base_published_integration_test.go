//go:build integration

package coreapp

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestNativeDefaultBrainDeploysPublishedWebBaseDigest(t *testing.T) {
	var reference struct {
		State     string
		Reference string
	}
	raw, err := os.ReadFile("../coreassets/piwork-brain/references/web-base.json")
	if err != nil || json.Unmarshal(raw, &reference) != nil || reference.State != "published" || !strings.Contains(reference.Reference, "@sha256:") {
		t.Fatal("A verified published Web base reference is required")
	}
	a, base, auth, work, _ := nativeApplyFixtureConfig(t, true)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	f := brainAcceptance{t: t, a: a, base: base, auth: auth, work: work, path: "/api/v1/works/" + work, ctx: ctx}
	run := f.chat("deploy published workstation", "published-base")
	if !strings.Contains(run["finalText"].(string), "workstation-deployed:") {
		t.Fatal(run["finalText"])
	}
	services := f.read(f.path + "/services")["services"].([]any)
	if len(services) != 1 {
		t.Fatal("Expected one default service", len(services))
	}
	service := services[0].(map[string]any)
	image := service["definition"].(map[string]any)["image"].(map[string]any)["reference"]
	if image != reference.Reference || service["observedState"] != "ready" {
		t.Fatal("Default SDK deployment did not use published digest", image, service["observedState"])
	}
	proof := f.servicePost("/ui/actions/todo_add", `{"actionId":"published-base-todo","input":{"title":"Published environment proof"},"expectedStateVersion":"1"}`)
	if proof["state"] != "succeeded" {
		t.Fatal("Published application business action failed", proof)
	}
	t.Log("Fresh default brain read its fixed reference through real SDK tools and deployed the published Web base digest with actual business proof")
}
