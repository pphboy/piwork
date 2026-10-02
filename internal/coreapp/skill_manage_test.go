package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/identity"
	"piwork/internal/skillartifact"
)

func TestSkillCrashStagingIsRemovedOnCoreStart(t *testing.T) {
	directory := t.TempDir()
	options := Options{DataDirectory: directory}
	first, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	root, err := first.Store.OpenSkillsRoot()
	if err != nil {
		t.Fatal(err)
	}
	skill, err := root.OpenDirectory("interrupted-skill")
	if err != nil {
		t.Fatal(err)
	}
	artifacts, err := skill.OpenDirectory("artifacts")
	if err != nil {
		t.Fatal(err)
	}
	stage, err := artifacts.OpenDirectory("stage-123e4567-e89b-12d3-a456-426614174000")
	if err != nil {
		t.Fatal(err)
	}
	stage.Close()
	artifacts.Close()
	skill.Close()
	root.Close()
	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	second, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(context.Background())
	root, err = second.Store.OpenSkillsRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	skill, err = root.OpenDirectory("interrupted-skill")
	if err != nil {
		t.Fatal(err)
	}
	defer skill.Close()
	artifacts, err = skill.OpenDirectory("artifacts")
	if err != nil {
		t.Fatal(err)
	}
	defer artifacts.Close()
	if entries, err := artifacts.Entries(); err != nil || len(entries) != 0 {
		t.Fatal("startup retained interrupted Skill upload", entries, err)
	}
}

func TestOperatorSkillImportAndDefaultSelectionProtection(t *testing.T) {
	runtime := RuntimeInput{AgentImage: "fixture/native-default", Provider: "piwork-deterministic", Model: "fixture-v1", Credential: "fixture-only"}
	a, base, operator := appFixture(t, Options{Initialization: Initialization{
		Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &runtime,
	}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := a.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "skill-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	ownerLogin, err := a.Identity.Login(context.Background(), string(owner.Account), "development-fixture-pass", "test")
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "custom-skill")
	if err := os.MkdirAll(filepath.Join(source, "refs"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("# Skill"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "refs", "note.txt"), []byte("first"), 0600); err != nil {
		t.Fatal(err)
	}
	operatorAuth := "Operator " + operator
	if status, body := httpCall(t, base, "/control/skills", "POST", "Bearer "+ownerLogin.Token, map[string]any{"path": source}); status != 401 || body["code"] != "OPERATOR_AUTHENTICATION_REQUIRED" {
		t.Fatal("user credential reached local operator Skill path", status, body)
	}
	if status, body := httpCall(t, base, "/control/skills", "POST", operatorAuth, map[string]any{"path": source}); status != 201 || body["name"] != "custom-skill" || body["fileCount"] != float64(2) || body["resolvedDigest"] != nil {
		t.Fatal("local Skill import did not publish safe catalog metadata", status, body)
	}
	if status, body := httpCall(t, base, "/control/skills", "POST", operatorAuth, map[string]any{"path": source}); status != 409 || body["code"] != "SKILL_ALREADY_EXISTS" {
		t.Fatal("duplicate local Skill import did not use the specified error", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/skills/custom-skill", "GET", "Bearer "+ownerLogin.Token, nil); status != 200 || body["name"] != "custom-skill" || len(body) != 1 {
		t.Fatal("public Skill discovery leaked internals or hid enabled Skill", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/default-work", "PATCH", "Bearer "+login.Token, map[string]any{"skills": []string{"custom-skill"}}); status != 200 || len(body["configuration"].(map[string]any)["skills"].([]any)) != 1 {
		t.Fatal("custom managed Skill could not be selected as default", status, body)
	}
	if status, body := httpCall(t, base, "/control/skills/custom-skill/disable", "POST", operatorAuth, nil); status != 409 || body["code"] != "CONFLICT" {
		t.Fatal("selected default Skill could be disabled", status, body)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/default-work", "PATCH", "Bearer "+login.Token, map[string]any{"skills": []string{}}); status != 200 || len(body["configuration"].(map[string]any)["skills"].([]any)) != 0 {
		t.Fatal("explicit empty default Skill selection failed", status, body)
	}
	if status, body := httpCall(t, base, "/control/skills/custom-skill/disable", "POST", operatorAuth, nil); status != 200 || body["enabled"] != false {
		t.Fatal("unselected Skill could not be disabled", status, body)
	}
	if status, _ := httpCall(t, base, "/api/v1/skills/custom-skill", "GET", "Bearer "+ownerLogin.Token, nil); status != 404 {
		t.Fatal("disabled Skill remained publicly discoverable", status)
	}
	if status, body := httpCall(t, base, "/control/skills/custom-skill/enable", "POST", operatorAuth, nil); status != 200 || body["enabled"] != true {
		t.Fatal("Skill enable failed", status, body)
	}
	if err := os.WriteFile(filepath.Join(source, "refs", "note.txt"), []byte("updated"), 0600); err != nil {
		t.Fatal(err)
	}
	var oldIdentity string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT resolved_digest FROM catalog_entries WHERE id='custom-skill'`).Scan(&oldIdentity)
	}); err != nil {
		t.Fatal(err)
	}
	if status, body := httpCall(t, base, "/control/skills/custom-skill", "PUT", operatorAuth, map[string]any{"path": source}); status != 200 || body["fileCount"] != float64(2) {
		t.Fatal("Skill update failed", status, body)
	}
	if _, err := skillartifact.Load(a.Store, "custom-skill", oldIdentity); err == nil {
		t.Fatal("unreferenced old Skill content remained after update")
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	if status, _ := httpCall(t, base, "/control/skills/custom-skill", "DELETE", operatorAuth, nil); status != 204 {
		t.Fatal("unselected Skill could not be removed", status)
	}
	if status, _ := httpCall(t, base, "/api/v1/skills/custom-skill", "GET", "Bearer "+ownerLogin.Token, nil); status != 404 {
		t.Fatal("removed Skill remained discoverable", status)
	}
	root, err := a.Store.OpenSkillsRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	skill, err := root.OpenDirectory("custom-skill")
	if err != nil {
		t.Fatal(err)
	}
	defer skill.Close()
	artifacts, err := skill.OpenDirectory("artifacts")
	if err != nil {
		t.Fatal(err)
	}
	defer artifacts.Close()
	if entries, err := artifacts.Entries(); err != nil || len(entries) != 0 {
		t.Fatal("unreferenced Skill artifacts remained after removal", entries, err)
	}
}
