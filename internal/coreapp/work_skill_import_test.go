package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

type deadlineRecorder struct {
	*httptest.ResponseRecorder
}

func (deadlineRecorder) SetReadDeadline(time.Time) error { return nil }

func skillImportRequest(t *testing.T, workID, name string, files map[string][]byte) (*http.Request, deadlineRecorder) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	field, err := writer.CreateFormField("directoryName")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = field.Write([]byte(name))
	for path, data := range files {
		part, err := writer.CreateFormFile("files", url.PathEscape(path))
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write(data)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/api/v1/works/"+workID+"/configuration/skills/import", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return request, deadlineRecorder{httptest.NewRecorder()}
}

func callSkillImport(t *testing.T, a *Application, principal identity.Principal, workID, name string, files map[string][]byte) (int, map[string]any) {
	t.Helper()
	request, recorder := skillImportRequest(t, workID, name, files)
	handled, err := a.workSkillImport(recorder, request, principal)
	if !handled {
		t.Fatal("import route was not handled")
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

func catalogSkillCount(t *testing.T, a *Application) int {
	t.Helper()
	var count int
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT COUNT(*) FROM catalog_entries WHERE kind='skill'`).Scan(&count)
	}); err != nil {
		t.Fatal(err)
	}
	return count
}

func TestWorkSkillImportAddsOwnerDirectoryWithoutCoreCatalog(t *testing.T) {
	a, owner, _ := editorApplication(t)
	id, config := seedEditorWork(t, a, owner)
	if count := catalogSkillCount(t, a); count != 0 {
		t.Fatalf("fixture unexpectedly has Core Skills: %d", count)
	}
	files := map[string][]byte{"SKILL.md": []byte("# Review"), "references/checklist.md": []byte("checklist")}
	status, body := callSkillImport(t, a, owner.principal, id, "code-review", files)
	if status != 200 {
		t.Fatal(status, body)
	}
	desired := body["desired"].(map[string]any)
	skills := desired["skills"].([]any)
	if len(skills) != 1 || skills[0] != "code-review" {
		t.Fatal("imported Skill missing from desired", body)
	}
	if desired["agentsMd"] != config.AgentsMd || body["pendingApply"] != true || body["active"] != nil {
		t.Fatal("import did not preserve the saved baseline", body)
	}
	for path, want := range map[string]string{
		"skills/code-review/SKILL.md": "# Review", "skills/code-review/references/checklist.md": "checklist",
		"AGENTS.md": "# Agent",
	} {
		if got := contextFile(t, a, id, path); got != want {
			t.Fatal("imported context mismatch", path, got)
		}
	}
	if count := catalogSkillCount(t, a); count != 0 {
		t.Fatalf("Work import created a Core catalog entry: %d", count)
	}
}

func TestWorkSkillImportDeniesNonOwnersAndCleansFailure(t *testing.T) {
	a, owner, otherAdmin := editorApplication(t)
	importEditorSkill(t, a, "existing-skill", map[string][]byte{"SKILL.md": []byte("# existing")})
	id, _ := seedEditorWork(t, a, owner, "existing-skill")
	valid := map[string][]byte{"SKILL.md": []byte("# Imported")}
	if status, body := callSkillImport(t, a, otherAdmin.principal, id, "new-skill", valid); status != 403 || body["code"] != "PERMISSION_DENIED" {
		t.Fatal("non-owner admin imported Work content", status, body)
	}
	if status, body := callSkillImport(t, a, identity.OperatorPrincipal(), id, "new-skill", valid); status != 404 || body["code"] != "NOT_FOUND" {
		t.Fatal("operator imported Work content", status, body)
	}
	before := *mustContext(t, a, id)
	if status, body := callSkillImport(t, a, owner.principal, id, "existing-skill", valid); status != 409 || body["code"] != "SKILL_ALREADY_EXISTS" {
		t.Fatal("duplicate name was accepted", status, body)
	}
	if got := contextFile(t, a, id, "skills/existing-skill/SKILL.md"); got != "# existing" {
		t.Fatal("duplicate import replaced the owned copy", got)
	}
	if status, body := callSkillImport(t, a, owner.principal, id, "bad-name", map[string][]byte{"../escape.md": []byte("x"), "SKILL.md": []byte("# Bad")}); status != 400 || body["code"] != "SKILL_UPLOAD_INVALID" {
		t.Fatal("escaped upload path was accepted", status, body)
	}
	if status, body := callSkillImport(t, a, owner.principal, id, "no-manifest", map[string][]byte{"notes.md": []byte("x")}); status != 400 || body["code"] != "SKILL_UPLOAD_INVALID" {
		t.Fatal("upload without SKILL.md was accepted", status, body)
	}
	if *mustContext(t, a, id) != before {
		t.Fatal("rejected import changed the desired context")
	}
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "works", id, "contexts", before, "skills", "new-skill")); !os.IsNotExist(err) {
		t.Fatal("rejected import left a visible Skill tree", err)
	}
}

func TestWorkSkillImportPreservesExistingContentAndHiddenFields(t *testing.T) {
	a, owner, _ := editorApplication(t)
	importEditorSkill(t, a, "existing-skill", map[string][]byte{"SKILL.md": []byte("# existing")})
	id, _ := seedEditorWork(t, a, owner, "existing-skill")
	status, body := callSkillImport(t, a, owner.principal, id, "code-review", map[string][]byte{"SKILL.md": []byte("# Review")})
	if status != 200 {
		t.Fatal(status, body)
	}
	skills := body["desired"].(map[string]any)["skills"].([]any)
	if len(skills) != 2 || skills[0] != "existing-skill" || skills[1] != "code-review" {
		t.Fatal("import did not append to the current selection", skills)
	}
	if got := contextFile(t, a, id, "skills/existing-skill/SKILL.md"); got != "# existing" {
		t.Fatal("existing Skill content changed", got)
	}
	state, err := a.Store.Configuration(context.Background(), id)
	if err != nil {
		t.Fatal(err)
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil {
		t.Fatal(err)
	}
	if config.ModelRef != "runtime-model-00000001" || config.AgentImage.CatalogId != "runtime-image-00000001" || len(config.Tools.Allowed) != 1 {
		t.Fatal("hidden configuration fields were not preserved", config)
	}
}
