//go:build integration

package coreapp

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"piwork/internal/webapp"
)

// TestNativeWorkSettingsLocalSkillImportRoundTrip starts from an empty Core
// Skill catalog and adds the Work's own directory through the real browser.
func TestNativeWorkSettingsLocalSkillImportRoundTrip(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node is required for the Work Settings browser driver", err)
	}
	a, base, adminAuth, comparisonID, ctx := nativeApplyFixture(t)
	const account = "local-skill-owner"
	const password = "development-fixture-pass"
	admin, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(adminAuth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, admin.Principal(), account, password, "user"); err != nil {
		t.Fatal(err)
	}
	owner, err := a.Identity.Login(ctx, account, password, "settings-local-import")
	if err != nil {
		t.Fatal(err)
	}
	if owner.User.Role != "user" {
		t.Fatal("the local Skill browser fixture requires an ordinary account")
	}
	auth := "Bearer " + owner.Token
	var coreSkills int
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT COUNT(*) FROM catalog_entries WHERE kind='skill'`).Scan(&coreSkills)
	}); err != nil {
		t.Fatal(err)
	}
	if coreSkills != 0 {
		t.Fatalf("fixture Core Skill catalog is not empty: %d", coreSkills)
	}
	_, baseView := packageHTTPCall(t, base, "/api/v1/works/"+comparisonID+"/configuration", "GET", adminAuth, nil)
	comparisonBefore, err := json.Marshal(baseView["desired"])
	if err != nil {
		t.Fatal(err)
	}
	configuration := baseView["desired"].(map[string]any)
	configuration["skills"] = []any{}
	status, receipt := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{
		"name": "Local Import Work", "configuration": configuration, "idempotencyKey": "local-import-work",
	})
	if status != 202 {
		t.Fatal("create local import Work", status, receipt)
	}
	waitWorkOperation(t, ctx, a, receipt["operationId"].(string))
	workID := receipt["workId"].(string)
	for {
		work, err := a.Store.Work(ctx, workID, false)
		if err != nil {
			t.Fatal(err)
		}
		if work.OwnerUserID != owner.User.ID {
			t.Fatal("the local Skill browser Work must belong to the ordinary account")
		}
		if work.ObservedState == "ready" {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("local import Work did not become ready", work.ObservedState, ctx.Err())
		}
		time.Sleep(100 * time.Millisecond)
	}

	const name = "local-editor-skill"
	manifest := "---\nname: " + name + "\ndescription: Imported local Work Skill\n---\nSupporting file: references/note.txt\n"
	support := "LOCAL_SUPPORT\n"
	editedManifest := manifest + "Work-only editor instructions\n"
	editedSupport := "EDITOR_ONLY\n"

	server := httptest.NewUnstartedServer(nil)
	origin := "http://" + server.Listener.Addr().String()
	web, err := webapp.New(ctx, webapp.Options{Origin: origin, CoreURL: base, SetupSecret: "editor-browser-fixture", DataDirectory: t.TempDir()})
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	server.Config.Handler = web
	server.Start()
	defer server.Close()
	defer web.Close()
	_, file, _, _ := runtime.Caller(0)
	script := filepath.Join(filepath.Dir(file), "..", "..", "apps", "desktop-webui", "test", "work-settings-real-core.mjs")
	input, err := json.Marshal(map[string]string{
		"origin": origin, "coreURL": base, "authorization": auth, "workID": workID, "skillName": name,
		"account": account, "password": password,
		"source": "local", "originalManifest": manifest, "originalSupport": support,
		"editedManifest": editedManifest, "editedSupport": editedSupport, "output": t.TempDir(),
	})
	if err != nil {
		t.Fatal(err)
	}
	driver := exec.CommandContext(ctx, node, script)
	driver.Stdin = bytes.NewReader(input)
	output, err := driver.CombinedOutput()
	if err != nil {
		t.Fatalf("local Skill import browser round trip: %v\n%s", err, output)
	}
	t.Log(strings.TrimSpace(string(output)))

	status, view := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/configuration", "GET", auth, nil)
	if status != 200 || view["pendingApply"] != false {
		t.Fatal("local import Work was not applied", status, view)
	}
	for _, field := range []string{"desired", "active"} {
		facts := view[field].(map[string]any)
		skills := facts["skills"].([]any)
		found := false
		for _, skill := range skills {
			if skill == name {
				found = true
			}
		}
		if !found {
			t.Fatal("imported Skill missing from "+field, facts)
		}
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT COUNT(*) FROM catalog_entries WHERE kind='skill'`).Scan(&coreSkills)
	}); err != nil || coreSkills != 0 {
		t.Fatal("Work import created a Core catalog entry", coreSkills, err)
	}
	_, comparisonAfter := packageHTTPCall(t, base, "/api/v1/works/"+comparisonID+"/configuration", "GET", adminAuth, nil)
	comparisonEncoded, err := json.Marshal(comparisonAfter["desired"])
	if err != nil || !bytes.Equal(comparisonBefore, comparisonEncoded) {
		t.Fatal("local import changed another Work", err)
	}
	t.Log("ordinary Work owner verified: empty Core catalog local directory import, editing, Apply, SDK reads, restart and archive round trip")
}
