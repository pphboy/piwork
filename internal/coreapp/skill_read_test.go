package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"piwork/internal/identity"
	"testing"
)

func TestSkillCatalogProjectsPublicAndOperatorViews(t *testing.T) {
	a, base, operator := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	importCatalogSkillFixture(t, a)
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(context.Background(), login.Token)
	if err != nil {
		t.Fatal(err)
	}
	user, err := a.Identity.CreateUser(context.Background(), session.Principal(), "owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	owner, err := a.Identity.Login(context.Background(), string(user.Account), "development-fixture-pass", "fixture")
	if err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/skills"
	if status, body := httpCall(t, base, path, "GET", "Bearer "+owner.Token, nil); status != 200 || len(body["skills"].([]any)) != 1 || body["skills"].([]any)[0].(map[string]any)["name"] != "catalog-skill" || body["skills"].([]any)[0].(map[string]any)["totalBytes"] != nil {
		t.Fatal("public Skill catalog leaked metadata", status, body)
	}
	if status, body := httpCall(t, base, path+"/catalog-skill", "GET", "Bearer "+owner.Token, nil); status != 200 || body["name"] != "catalog-skill" || len(body) != 1 {
		t.Fatal("public Skill detail was wrong", status, body)
	}
	if status, _ := httpCall(t, base, "/api/v1/admin/skills", "GET", "Bearer "+owner.Token, nil); status != 403 {
		t.Fatal("ordinary user entered admin catalog", status)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/skills", "GET", "Bearer "+login.Token, nil); status != 200 || len(body["skills"].([]any)) != 1 || body["skills"].([]any)[0].(map[string]any)["fileCount"] != float64(3) || body["skills"].([]any)[0].(map[string]any)["resolvedDigest"] != nil {
		t.Fatal("admin Skill catalog projection was wrong", status, body)
	}
	if status, body := httpCall(t, base, "/control/skills/catalog-skill", "GET", "Operator "+operator, nil); status != 200 || body["fileCount"] != float64(3) {
		t.Fatal("operator Skill detail was wrong", status, body)
	}
	if status, _ := httpCall(t, base, path+"/missing", "GET", "Bearer "+owner.Token, nil); status != 404 {
		t.Fatal("unknown Skill was discoverable", status)
	}
	if status, _ := httpCall(t, base, path+"/%252e%252e", "GET", "Bearer "+owner.Token, nil); status != 404 {
		t.Fatal("double-encoded Skill name was accepted", status)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE catalog_entries SET enabled=0 WHERE id='catalog-skill'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if status, body := httpCall(t, base, path, "GET", "Bearer "+owner.Token, nil); status != 200 || len(body["skills"].([]any)) != 0 {
		t.Fatal("disabled Skill remained publicly listed", status, body)
	}
	if status, _ := httpCall(t, base, path+"/catalog-skill", "GET", "Bearer "+owner.Token, nil); status != 404 {
		t.Fatal("disabled Skill remained publicly visible", status)
	}
	if status, body := httpCall(t, base, "/api/v1/admin/skills/catalog-skill", "GET", "Bearer "+login.Token, nil); status != 200 || body["enabled"] != false {
		t.Fatal("disabled Skill disappeared from admin catalog", status, body)
	}
}

func importCatalogSkillFixture(t *testing.T, a *Application) {
	t.Helper()
	source := filepath.Join(t.TempDir(), "catalog-skill")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"SKILL.md", "reference.md", "example.md"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte("# Catalog test Skill"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.importSkill(context.Background(), identity.OperatorPrincipal(), source, "catalog-skill", false); err != nil {
		t.Fatal(err)
	}
}
