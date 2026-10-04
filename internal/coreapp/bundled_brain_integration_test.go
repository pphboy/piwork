//go:build integration

package coreapp

import (
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
)

func TestNativeDefaultBrainHasActualSDKToolsAndExplicitEmptyOverride(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil || len(defaults.Configuration.Skills) != 0 || len(defaults.Configuration.Packages) != 1 || defaults.Configuration.Packages[0].Name != "piwork-brain" {
		t.Fatal(defaults, err)
	}
	var standalone int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT count(*) FROM catalog_entries WHERE id='deploy-work-service'").Scan(&standalone)
	}); err != nil || standalone != 0 {
		t.Fatal("standalone deployment Skill seeded", err)
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	var generation int64
	var instance string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT generation,instance_id FROM runtime_generations WHERE work_id=? AND state='ready' ORDER BY generation DESC LIMIT 1", id).Scan(&generation, &instance)
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: id, Generation: generation, InstanceID: instance}
	client, _, err := a.agentRoutes.Admission(scope, *work.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := client.Readiness(ctx, *work.ActiveContextID, false)
	if err != nil {
		t.Fatal(err)
	}
	if ready.WorkHistorySchemaVersion != 4 || ready.RunModelContractVersion != 1 || ready.WorkFeedbackContractVersion != 1 || len(ready.LoadedPackages) != 1 || ready.LoadedPackages[0].Name != "piwork-brain" {
		t.Fatal(ready)
	}
	for _, tool := range []string{"brain_service", "brain_feedback", "brain_experience", "brain_package_update"} {
		found := false
		for _, actual := range ready.ResolvedTools {
			found = found || actual == "package:piwork-brain:"+tool
		}
		if !found {
			t.Fatal("actual SDK omitted", tool)
		}
	}
	// The browser/API override uses the master Work creation path; independent
	// skills=[] leaves brain selected, packages=[] creates a brain-free runtime.
	config := *defaults.Configuration // JSON [] must be explicit.
	config.Packages = make([]contracts.PiPackageSelectionEntry, 0)
	status, created := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "Explicit no brain", "idempotencyKey": "brain-override", "configuration": config})
	if status != 202 {
		t.Fatal(status, created)
	}
	copyID := created["workId"].(string)
	waitWorkOperation(t, ctx, a, created["operationId"].(string))
	copyWork, err := a.Store.Work(ctx, copyID, false)
	if err != nil {
		t.Fatal(err)
	}
	configRaw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(configRaw), "deploy-work-service") {
		t.Fatal("independent Skill remained")
	}
	// Core holds the selected artifact; the Work captured its own immutable copy.
	var artifact corestore.PackageArtifact
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var artifactID string
		if err := tx.QueryRow("SELECT head_artifact_id FROM pi_package_catalog WHERE name='piwork-brain'").Scan(&artifactID); err != nil {
			return err
		}
		var err error
		artifact, err = corestore.ReadPackageArtifact(tx, artifactID)
		return err
	}); err != nil || artifact.ScopeKind != "core" {
		t.Fatal(err)
	}
	if copyWork.ActiveContextID == nil {
		t.Fatal("explicit empty packages failed current handshake")
	}
	t.Log("Native prepare seeded one catalog/default brain; real SDK loaded cognition resources and four tools; no standalone deployment Skill; explicit empty package runtime passed same current handshake")
}
