package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workcontext"
)

type editorUser struct {
	principal identity.Principal
	userID    string
}

func editorApplication(t *testing.T) (*Application, editorUser, editorUser) {
	t.Helper()
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	adminLogin, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "editor")
	if err != nil {
		t.Fatal(err)
	}
	admin, err := a.Identity.Authenticate(context.Background(), adminLogin.Token)
	if err != nil {
		t.Fatal(err)
	}
	create := func(account, role string) editorUser {
		user, err := a.Identity.CreateUser(context.Background(), admin.Principal(), account, "development-fixture-pass", role)
		if err != nil {
			t.Fatal(err)
		}
		login, err := a.Identity.Login(context.Background(), string(user.Account), "development-fixture-pass", "editor")
		if err != nil {
			t.Fatal(err)
		}
		authenticated, err := a.Identity.Authenticate(context.Background(), login.Token)
		if err != nil {
			t.Fatal(err)
		}
		return editorUser{principal: authenticated.Principal(), userID: string(user.Id)}
	}
	return a, create("owner", "user"), create("other-admin", "admin")
}

func importEditorSkill(t *testing.T, a *Application, name string, files map[string][]byte) {
	t.Helper()
	source := filepath.Join(t.TempDir(), name)
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	for path, data := range files {
		full := filepath.Join(source, filepath.FromSlash(path))
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, data, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := a.importSkill(context.Background(), identity.OperatorPrincipal(), source, name, false); err != nil {
		t.Fatal(err)
	}
}

func seedEditorWork(t *testing.T, a *Application, owner editorUser, skills ...contracts.SkillName) (string, contracts.WorkConfig) {
	t.Helper()
	workID := "work-editor-00000000001"
	now := time.Now().UTC().Format(time.RFC3339Nano)
	image := "sha256:" + strings.Repeat("a", 64)
	config := contracts.WorkConfig{
		AgentImage: contracts.ImageSelection{CatalogId: "runtime-image-00000001"},
		Skills:     contracts.SkillSelection(skills), Packages: contracts.PiPackageSelection{},
		AgentsMd: "# Agent", ModelRef: "runtime-model-00000001", McpServers: []contracts.McpServer{},
		Resources: contracts.ResourcePolicy{CpuMillis: 2000, MemoryBytes: 1610612736, AgentCpuMillis: 1000, AgentMemoryBytes: 805306368, MaxServices: 4, MaxRetainedVolumes: 2},
		Tools:     contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{"read"}, Denied: []contracts.WorkToolPolicyKey{"bash"}},
	}
	if config.Skills == nil {
		config.Skills = contracts.SkillSelection{}
	}
	published, err := workcontext.BuildDefault(a.Store, a.options.DataDirectory, workID, config, image, now)
	if err != nil {
		t.Fatal(err)
	}
	revision := int64(1)
	profile := `{"fixture":true}`
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: workID, OwnerUserID: owner.userID, Name: "Editor Work", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return err
		}
		if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: workID, Revision: 1, ConfigJSON: published.ConfigurationJSON, ResolvedImageDigest: &image, RuntimeProfileJSON: &profile, CreatedByUserID: owner.userID, CreatedAt: now}); err != nil {
			return err
		}
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: published.ID, WorkID: workID, InternalRevision: &revision, ConfigurationJSON: published.ConfigurationJSON, ImageIdentity: image, CreatedByUserID: owner.userID, CreatedAt: now}); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE works SET desired_context_id=? WHERE id=?`, published.ID, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return workID, config
}

func callEditor(t *testing.T, a *Application, principal identity.Principal, method, path string, body any) (int, map[string]any) {
	t.Helper()
	var reader io.Reader
	if body != nil {
		raw, _ := json.Marshal(body)
		reader = bytes.NewReader(raw)
	}
	request := httptest.NewRequest(method, path, reader)
	recorder := httptest.NewRecorder()
	var handled bool
	var err error
	if strings.HasSuffix(path, "/configuration/editor/read") {
		handled, err = a.workConfigurationEditorRead(recorder, request, principal)
	} else {
		handled, err = a.workConfigurationEditorSave(recorder, request, principal)
	}
	if !handled {
		t.Fatalf("editor route was not handled: %s %s", method, path)
	}
	if err != nil {
		status, view := contracts.ProjectError(err)
		return status, map[string]any{"code": view.Code}
	}
	var result map[string]any
	if recorder.Body.Len() > 0 {
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
	}
	return recorder.Code, result
}

func contextFile(t *testing.T, a *Application, workID, path string) string {
	t.Helper()
	state, err := a.Store.Configuration(context.Background(), workID)
	if err != nil || state.DesiredContextID == nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(a.options.DataDirectory, "works", workID, "contexts", *state.DesiredContextID, filepath.FromSlash(path)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestEditorReadIsOwnerScopedAndReportsFileEditability(t *testing.T) {
	a, owner, otherAdmin := editorApplication(t)
	importEditorSkill(t, a, "code-review", map[string][]byte{
		"SKILL.md": []byte("# Review"), "references/checklist.md": []byte("checklist"), "asset.bin": {0, 1, 2},
	})
	workID, _ := seedEditorWork(t, a, owner, "code-review")
	path := "/api/v1/works/" + workID + "/configuration/editor/read"
	status, body := callEditor(t, a, owner.principal, "POST", path, map[string]any{"skillName": "code-review", "files": []map[string]string{{"skillName": "code-review", "path": "SKILL.md"}}})
	if status != 200 {
		t.Fatal(status, body)
	}
	desired := body["desired"].(map[string]any)
	if desired["agentsMd"] != "# Agent" || len(desired["skills"].([]any)) != 1 || body["active"] != nil || body["pendingApply"] != true {
		t.Fatal("read did not project the saved baseline", body)
	}
	files := body["skillFiles"].([]any)
	reasons := map[string]any{}
	for _, raw := range files {
		file := raw.(map[string]any)
		reasons[file["path"].(string)] = file["reason"]
	}
	if reasons["SKILL.md"] != nil || reasons["references/checklist.md"] != nil || reasons["asset.bin"] != "binary" {
		t.Fatal("file editability projection was wrong", reasons)
	}
	texts := body["files"].([]any)
	if len(texts) != 1 || texts[0].(map[string]any)["text"] != "# Review" {
		t.Fatal("requested text was not returned", body)
	}
	if status, body := callEditor(t, a, otherAdmin.principal, "POST", path, map[string]any{}); status != 403 || body["code"] != "PERMISSION_DENIED" {
		t.Fatal("non-owner admin read was not denied", status, body)
	}
	if status, body := callEditor(t, a, identity.OperatorPrincipal(), "POST", path, map[string]any{}); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("operator read was not denied", status, body)
	}
	if status, body := callEditor(t, a, owner.principal, "POST", path, map[string]any{"files": []map[string]string{{"skillName": "code-review", "path": "../private"}}}); status != 400 || body["code"] != "INVALID_REQUEST" {
		t.Fatal("unsafe read path was accepted", status, body)
	}
	if status, body := callEditor(t, a, owner.principal, "POST", path, map[string]any{"files": []map[string]string{{"skillName": "missing", "path": "SKILL.md"}}}); status != 400 || body["code"] != "INVALID_REQUEST" {
		t.Fatal("unknown Skill read was accepted", status, body)
	}
}

func TestEditorSaveAppliesExplicitDeltaAndPreservesHiddenFields(t *testing.T) {
	a, owner, otherAdmin := editorApplication(t)
	importEditorSkill(t, a, "code-review", map[string][]byte{
		"SKILL.md": []byte("# Review"), "references/checklist.md": []byte("checklist"), "asset.bin": {0, 1, 2},
	})
	importEditorSkill(t, a, "other-skill", map[string][]byte{"SKILL.md": []byte("# Other")})
	workID, _ := seedEditorWork(t, a, owner, "code-review")
	path := "/api/v1/works/" + workID + "/configuration/editor"
	status, body := callEditor(t, a, owner.principal, "PATCH", path, map[string]any{
		"skillFiles": []map[string]string{
			{"skillName": "code-review", "path": "SKILL.md", "text": "# Review v2"},
			{"skillName": "code-review", "path": "references/checklist.md", "text": "checklist v2"},
		},
		"agentsMd": "# Agent v2",
	})
	if status != 200 {
		t.Fatal(status, body)
	}
	if body["pendingApply"] != true || body["active"] != nil || body["desired"].(map[string]any)["agentsMd"] != "# Agent v2" {
		t.Fatal("save response did not confirm the captured baseline", body)
	}
	for path, want := range map[string]string{
		"skills/code-review/SKILL.md": "# Review v2", "skills/code-review/references/checklist.md": "checklist v2",
		"skills/code-review/asset.bin": "\x00\x01\x02", "AGENTS.md": "# Agent v2",
	} {
		if got := contextFile(t, a, workID, path); got != want {
			t.Fatal("saved context content mismatch", path, got)
		}
	}
	state, err := a.Store.Configuration(context.Background(), workID)
	if err != nil {
		t.Fatal(err)
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil || config.ModelRef != "runtime-model-00000001" || config.AgentImage.CatalogId != "runtime-image-00000001" ||
		len(config.McpServers) != 0 || len(config.Tools.Allowed) != 1 || config.Resources.AgentCpuMillis != 1000 {
		t.Fatal("hidden fields were not preserved", err, config)
	}

	status, body = callEditor(t, a, owner.principal, "PATCH", path, map[string]any{"addSkills": []string{"other-skill"}, "skillFiles": []map[string]string{{"skillName": "code-review", "path": "SKILL.md", "text": "# Review v3"}}})
	if status != 200 {
		t.Fatal("add with edit failed", status, body)
	}
	if got := contextFile(t, a, workID, "skills/other-skill/SKILL.md"); got != "# Other" {
		t.Fatal("new Skill was not captured", got)
	}
	if got := contextFile(t, a, workID, "skills/code-review/SKILL.md"); got != "# Review v3" {
		t.Fatal("existing file edit was not preserved", got)
	}

	status, body = callEditor(t, a, owner.principal, "PATCH", path, map[string]any{"removeSkills": []string{"other-skill"}})
	if status != 200 {
		t.Fatal("remove failed", status, body)
	}
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "works", workID, "contexts", *mustContext(t, a, workID), "skills", "other-skill")); !os.IsNotExist(err) {
		t.Fatal("removed Skill remained in desired context", err)
	}

	for _, item := range []struct {
		name string
		body map[string]any
		code string
	}{
		{"duplicate-target", map[string]any{"skillFiles": []map[string]string{{"skillName": "code-review", "path": "SKILL.md", "text": "one"}, {"skillName": "code-review", "path": "SKILL.md", "text": "two"}}}, "INVALID_REQUEST"},
		{"binary-edit", map[string]any{"skillFiles": []map[string]string{{"skillName": "code-review", "path": "asset.bin", "text": "text"}}}, "INVALID_REQUEST"},
		{"escaped-path", map[string]any{"skillFiles": []map[string]string{{"skillName": "code-review", "path": "../private", "text": "x"}}}, "INVALID_REQUEST"},
		{"unknown-package", map[string]any{"packageFlags": []map[string]any{{"name": "missing-package", "enabled": true}}}, "PI_PACKAGE_NOT_INSTALLED"},
		{"empty", map[string]any{}, "INVALID_REQUEST"},
	} {
		before := contextFile(t, a, workID, "skills/code-review/SKILL.md")
		status, body := callEditor(t, a, owner.principal, "PATCH", path, item.body)
		if status != 400 || body["code"] != item.code {
			t.Fatal("invalid patch was accepted", item.name, status, body)
		}
		if after := contextFile(t, a, workID, "skills/code-review/SKILL.md"); after != before {
			t.Fatal("failed patch changed desired content", item.name)
		}
	}
	if status, body := callEditor(t, a, otherAdmin.principal, "PATCH", path, map[string]any{"agentsMd": "# Admin"}); status != 403 || body["code"] != "PERMISSION_DENIED" {
		t.Fatal("non-owner admin saved Work content", status, body)
	}
}

func mustContext(t *testing.T, a *Application, workID string) *string {
	t.Helper()
	state, err := a.Store.Configuration(context.Background(), workID)
	if err != nil || state.DesiredContextID == nil {
		t.Fatal(err)
	}
	return state.DesiredContextID
}

func TestEditorReadSupportsOriginalMultiSkillBatchAndRejectsDuplicates(t *testing.T) {
	a, owner, _ := editorApplication(t)
	var skills []contracts.SkillName
	var files []map[string]string
	for _, name := range []string{"skill-a", "skill-b", "skill-c", "skill-d", "skill-e", "skill-f", "skill-g", "skill-h", "skill-i"} {
		importEditorSkill(t, a, name, map[string][]byte{"SKILL.md": []byte("# " + name), "asset.bin": {0, 1, 2}})
		skills = append(skills, contracts.SkillName(name))
		files = append(files, map[string]string{"skillName": name, "path": "SKILL.md"})
	}
	workID, _ := seedEditorWork(t, a, owner, skills...)
	path := "/api/v1/works/" + workID + "/configuration/editor/read"
	status, body := callEditor(t, a, owner.principal, "POST", path, map[string]any{"files": files})
	if status != 200 || len(body["files"].([]any)) != len(files) {
		t.Fatal("original multi-Skill targets could not be checked together", status, body)
	}
	status, body = callEditor(t, a, owner.principal, "POST", path, map[string]any{"files": []map[string]string{files[0], files[0]}})
	if status != 400 || body["code"] != "INVALID_REQUEST" {
		t.Fatal("duplicate target was accepted", status, body)
	}
}

func TestEditorRejectsNewBinaryTextAtomically(t *testing.T) {
	a, owner, _ := editorApplication(t)
	importEditorSkill(t, a, "code-review", map[string][]byte{"SKILL.md": []byte("# original"), "note.txt": []byte("original note")})
	id, _ := seedEditorWork(t, a, owner, "code-review")
	before, _ := a.Store.Configuration(context.Background(), id)
	status, body := callEditor(t, a, owner.principal, "PATCH", "/api/v1/works/"+id+"/configuration/editor", map[string]any{
		"agentsMd": "must not commit", "skillFiles": []map[string]string{{"skillName": "code-review", "path": "note.txt", "text": "bad\x00text"}},
	})
	if status != 400 || body["code"] != "INVALID_REQUEST" {
		t.Fatal("invalid replacement accepted", status, body)
	}
	after, _ := a.Store.Configuration(context.Background(), id)
	if before.DesiredConfigJSON != after.DesiredConfigJSON || *before.DesiredContextID != *after.DesiredContextID || after.ActiveConfigJSON != nil {
		t.Fatal("rejected batch changed configuration")
	}
	if got := contextFile(t, a, id, "skills/code-review/note.txt"); got != "original note" {
		t.Fatal("rejected batch changed bytes", got)
	}
}

func TestEditorOwnedDuplicateIgnoresCoreAvailability(t *testing.T) {
	for _, deleted := range []bool{false, true} {
		t.Run(map[bool]string{false: "disabled", true: "deleted"}[deleted], func(t *testing.T) {
			a, owner, _ := editorApplication(t)
			importEditorSkill(t, a, "code-review", map[string][]byte{"SKILL.md": []byte("# owned")})
			id, _ := seedEditorWork(t, a, owner, "code-review")
			if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
				query := `UPDATE catalog_entries SET enabled=0 WHERE kind='skill' AND name='code-review'`
				if deleted {
					query = `DELETE FROM catalog_entries WHERE kind='skill' AND name='code-review'`
				}
				_, err := tx.Exec(query)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			status, body := callEditor(t, a, owner.principal, "PATCH", "/api/v1/works/"+id+"/configuration/editor", map[string]any{"addSkills": []string{"code-review"}})
			if status != 200 {
				t.Fatal("owned duplicate needs no Core source", status, body)
			}
			if got := contextFile(t, a, id, "skills/code-review/SKILL.md"); got != "# owned" {
				t.Fatal("owned copy changed", got)
			}
			second := *mustContext(t, a, id)
			status, _ = callEditor(t, a, owner.principal, "PATCH", "/api/v1/works/"+id+"/configuration/editor", map[string]any{"addSkills": []string{"unavailable-new"}})
			if status != 409 || *mustContext(t, a, id) != second {
				t.Fatal("unavailable new Skill was accepted", status)
			}
		})
	}
}

func TestEditorSaveActiveUsesSettingsFactsContract(t *testing.T) {
	a, owner, _ := editorApplication(t)
	importEditorSkill(t, a, "code-review", map[string][]byte{"SKILL.md": []byte("# owned")})
	id, _ := seedEditorWork(t, a, owner, "code-review")
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET active_revision=desired_revision,active_context_id=desired_context_id WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, body := callEditor(t, a, owner.principal, "PATCH", "/api/v1/works/"+id+"/configuration/editor", map[string]any{"agentsMd": "updated"})
	if status != 200 {
		t.Fatal(status, body)
	}
	raw, _ := json.Marshal(body)
	if _, err := contracts.Decode[contracts.WorkSettingsState](bytes.NewReader(raw), "WorkSettingsStateSchema", 2<<20); err != nil {
		t.Fatal("actual response violates contract", err)
	}
	if len(body["active"].(map[string]any)) != 3 || body["active"].(map[string]any)["agentsMd"] != "# Agent" {
		t.Fatal("active projection changed", body["active"])
	}
}

func TestEditorSaveRetriesAndPreservesConcurrentUnrelatedField(t *testing.T) {
	a, owner, _ := editorApplication(t)
	importEditorSkill(t, a, "code-review", map[string][]byte{"SKILL.md": []byte("# Original")})
	id, _ := seedEditorWork(t, a, owner, "code-review")
	injected := false
	update := func(current contracts.WorkConfig) (contracts.WorkConfig, error) {
		if !injected {
			injected = true
			// Another client commits an unrelated field after this attempt
			// captured the desired revision.
			if _, err := a.saveBasicWorkConfiguration(context.Background(), owner.principal, id, owner.userID, false, false, func(inner contracts.WorkConfig) (contracts.WorkConfig, error) {
				inner.AgentsMd = "# Concurrent"
				return inner, nil
			}, nil, nil); err != nil {
				return contracts.WorkConfig{}, err
			}
		}
		return current, nil
	}
	if _, err := a.saveBasicWorkConfiguration(context.Background(), owner.principal, id, owner.userID, false, false, update,
		[]workcontext.SkillEdit{{SkillName: "code-review", Path: "SKILL.md", Text: "# Edited"}}, nil); err != nil {
		t.Fatal(err)
	}
	state, err := a.Store.Configuration(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil || config.AgentsMd != "# Concurrent" {
		t.Fatal("unrelated concurrent field was overwritten", err, config.AgentsMd)
	}
	if got := contextFile(t, a, id, "skills/code-review/SKILL.md"); got != "# Edited" {
		t.Fatal("retried editor save lost its Skill edit", got)
	}
}
