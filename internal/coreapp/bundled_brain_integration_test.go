//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
)

func TestNativeCoreUpdatesLegacyBundledBrainOnRestart(t *testing.T) {
	testNativeCoreBrainUpgrade(t, false)
}

func TestNativeCoreAddsApplicationAwarenessOnRestart(t *testing.T) {
	testNativeCoreBrainUpgrade(t, true)
}

func testNativeCoreBrainUpgrade(t *testing.T, priorNiceGUI bool) {
	t.Helper()
	a, base, auth, _, ctx := nativeApplyFixture(t)
	// Synthetic legacy input has complete validated bytes and the same ordinary
	// package version as the old seed. It never uses real installation data.
	var legacy corestore.PackageArtifact
	if priorNiceGUI {
		prepared, err := priorNiceGUIBrainPreparer(t)(ctx)
		if err != nil {
			t.Fatal(err)
		}
		legacy = installPreparedBrain(t, a, prepared, bundledBrainArtifactID+":nicegui-1.2.1-fixture")
	} else {
		legacy = installLegacyBrain(t, a, bundledBrainArtifactID+":legacy-fixture")
	}
	create := func(base, auth, name string) (string, string) {
		t.Helper()
		status, accepted := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": name, "idempotencyKey": name})
		if status != 202 {
			t.Fatal(status, accepted)
		}
		return accepted["workId"].(string), accepted["operationId"].(string)
	}
	oldIDValue, oldOperation := create(base, auth, "Legacy brain Work")
	waitWorkOperation(t, ctx, a, oldOperation)
	oldID := &oldIDValue
	oldWork, err := a.Store.Work(ctx, *oldID, false)
	if err != nil {
		t.Fatal(err)
	}
	configuration, err := a.Store.Configuration(ctx, *oldID)
	if err != nil {
		t.Fatal(err)
	}
	beforeConfig, _ := json.Marshal(configuration)
	file := func(base, auth, method string, locations ...string) string {
		t.Helper()
		path, content := "upgrade-proof.txt", "preserve-user-data"
		putStatus := http.StatusCreated
		if len(locations) > 0 {
			path, content = locations[0], "User edited brain source awaiting Apply"
			putStatus = http.StatusNoContent
		}
		request, err := http.NewRequestWithContext(ctx, method, base+"/api/v1/works/"+*oldID+"/files/"+path, strings.NewReader(content))
		if err != nil {
			t.Fatal(err)
		}
		request.Header.Set("Authorization", auth)
		response, err := (&http.Client{Timeout: 30 * time.Second}).Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		raw, _ := io.ReadAll(response.Body)
		if method == "PUT" && response.StatusCode != putStatus || method == "GET" && response.StatusCode != http.StatusOK {
			t.Fatal(method, response.StatusCode, string(raw))
		}
		return string(raw)
	}
	file(base, auth, "PUT")
	file(base, auth, "PUT", ".pi/packages/piwork-brain/brain.md")
	readiness := func(app *Application, id string, digest string, expectedSkills uint32) {
		t.Helper()
		work, err := app.Store.Work(ctx, id, false)
		if err != nil {
			t.Fatal(err)
		}
		var generation int64
		var instance string
		if err := app.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT generation,instance_id FROM runtime_generations WHERE work_id=? AND state='ready' ORDER BY generation DESC LIMIT 1`, id).Scan(&generation, &instance)
		}); err != nil {
			t.Fatal(err)
		}
		client, _, err := app.agentRoutes.Admission(internaltls.Scope{InstallationID: app.Store.InstallationID(), WorkID: id, Generation: generation, InstanceID: instance}, *work.ActiveContextID)
		if err != nil {
			t.Fatal(err)
		}
		ready, err := client.Readiness(ctx, *work.ActiveContextID, false)
		if err != nil || len(ready.GetLoadedPackages()) != 1 || ready.GetLoadedPackages()[0].GetContentDigest() != digest || ready.GetLoadedPackages()[0].GetSkills() != expectedSkills {
			t.Fatal("real SDK loaded the wrong brain", ready, err)
		}
		var awareness bool
		for _, resource := range ready.GetPackageResources() {
			if resource.PackageName == "piwork-brain" && resource.Kind == "skill" && resource.Name == "application-awareness" {
				awareness = true
			}
		}
		if awareness != (expectedSkills == 2) {
			t.Fatal("captured package awareness discovery mismatch", ready)
		}
	}
	readiness(a, *oldID, legacy.ContentDigest, 1)
	directory := a.options.DataDirectory
	options := a.options
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	options.Initialization = Initialization{}
	updated, updatedBase, _ := appFixture(t, options)
	if updated.Store.InstallationID() != a.Store.InstallationID() || !updated.Status().Ready {
		t.Fatal("restarted installation not ready", updated.Status())
	}
	login, err := updated.Identity.Login(ctx, "admin", "development-fixture-pass", "brain-upgrade")
	if err != nil {
		t.Fatal(err)
	}
	updatedAuth := "Bearer " + login.Token
	head, generation := brainHead(t, updated)
	if !strings.HasPrefix(head, bundledBrainArtifactID+":1.2.2:") || generation != 3 {
		t.Fatal("Core did not update its seeded brain", head, generation)
	}
	configuration, err = updated.Store.Configuration(ctx, *oldID)
	afterConfig, _ := json.Marshal(configuration)
	if err != nil || string(beforeConfig) != string(afterConfig) {
		t.Fatal("existing Work configuration changed", err)
	}
	recovered, err := updated.Store.Work(ctx, *oldID, false)
	if err != nil || *recovered.ActiveContextID != *oldWork.ActiveContextID || recovered.ObservedState != "ready" {
		t.Fatal("old Work did not recover its original context", recovered, err)
	}
	readiness(updated, *oldID, legacy.ContentDigest, 1)
	if file(updatedBase, updatedAuth, "GET") != "preserve-user-data" {
		t.Fatal("workspace data lost")
	}
	if file(updatedBase, updatedAuth, "GET", ".pi/packages/piwork-brain/brain.md") != "User edited brain source awaiting Apply" {
		t.Fatal("upgrade replaced user editable source")
	}
	newIDValue, newOperation := create(updatedBase, updatedAuth, "Current brain Work")
	waitWorkOperation(t, ctx, updated, newOperation)
	newID := &newIDValue
	var current corestore.PackageArtifact
	if err := updated.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		current, err = corestore.ReadPackageArtifact(tx, head)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	readiness(updated, *newID, current.ContentDigest, 2)
	manifest := filepath.Join(directory, "works", *newID)
	found := map[string]bool{}
	if err := filepath.WalkDir(manifest, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		name := filepath.Base(filepath.Dir(path))
		if entry.Name() == "SKILL.md" && (name == "deploy-work-service" || name == "application-awareness") {
			content, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			if name == "deploy-work-service" && (!strings.Contains(string(content), "Python + NiceGUI + SQLite") || strings.Contains(string(content), "use FastAPI + React + TypeScript + Vite")) {
				t.Fatal("new Work captured obsolete deployment guidance")
			}
			if name == "application-awareness" && !strings.Contains(string(content), "Engineering Judgment") {
				t.Fatal("new Work omitted full application cognition")
			}
			found[name] = true
		}
		return nil
	}); err != nil || len(found) != 2 {
		t.Fatal("new Work deployment Skill unavailable", err)
	}
	if err := updated.ensureBundledBrain(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, actual := brainHead(t, updated); actual != generation {
		t.Fatal("repeated preparation changed catalog generation", actual)
	}
	t.Log("Core restart updated only the seeded catalog; real SDK kept old Work context/content/data/editable source and discovered both current peer Skills in a new Work")
}

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
	spec, _, err := a.capturedStartSpec(ctx, id, generation, instance)
	if err != nil {
		t.Fatal(err)
	}
	capabilities, err := a.inspector.InspectNativeAgent(ctx, spec.ImageID)
	if err != nil {
		t.Fatal(err)
	}
	if int64(ready.WorkHistorySchemaVersion) != capabilities.WorkHistorySchema || ready.RunModelContractVersion != 1 || ready.WorkFeedbackContractVersion != 1 || len(ready.LoadedPackages) != 1 || ready.LoadedPackages[0].Name != "piwork-brain" {
		t.Fatal(ready)
	}
	if ready.LoadedPackages[0].Skills != 2 {
		t.Fatal("actual SDK omitted peer Skills", ready.LoadedPackages)
	}
	for _, name := range []string{"application-awareness", "deploy-work-service"} {
		found := false
		for _, resource := range ready.PackageResources {
			found = found || resource.PackageName == "piwork-brain" && resource.Kind == "skill" && resource.Name == name
		}
		if !found {
			t.Fatal("actual SDK did not discover", name)
		}
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
