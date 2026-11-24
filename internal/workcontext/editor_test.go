package workcontext

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/skillartifact"
)

func editorFixture(t *testing.T) (*corestore.Store, string, string) {
	t.Helper()
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store, directory, time.Now().UTC().Format(time.RFC3339Nano)
}

func publishEditorSkill(t *testing.T, store *corestore.Store, name string, files map[string][]byte) skillartifact.Snapshot {
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
	snapshot, err := skillartifact.Scan(source, name)
	if err != nil {
		t.Fatal(err)
	}
	if err := skillartifact.Publish(store, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO catalog_entries(id,kind,name,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'skill',?,?,'{}',1,'now','now')`, snapshot.Name, snapshot.Name, snapshot.Identity)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func editorConfig(skills ...contracts.SkillName) contracts.WorkConfig {
	selection := contracts.SkillSelection{}
	selection = append(selection, skills...)
	return contracts.WorkConfig{
		AgentImage: contracts.ImageSelection{CatalogId: "runtime-image-00000001"},
		Skills:     selection, Packages: contracts.PiPackageSelection{},
		AgentsMd: "# Agent", ModelRef: "runtime-model-00000001", McpServers: []contracts.McpServer{},
		Resources: contracts.ResourcePolicy{CpuMillis: 2000, MemoryBytes: 1610612736, AgentCpuMillis: 1000, AgentMemoryBytes: 805306368, MaxServices: 4, MaxRetainedVolumes: 2},
		Tools:     contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}},
	}
}

func readContextFile(t *testing.T, published Published, path string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(published.Directory, filepath.FromSlash(path)))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestBuildWithPackagesAndEditsUsesValidatedImportForNewName(t *testing.T) {
	store, directory, created := editorFixture(t)
	image := "sha256:" + strings.Repeat("a", 64)
	publishEditorSkill(t, store, "owned-skill", map[string][]byte{"SKILL.md": []byte("# Core")})
	prior, err := BuildDefault(store, directory, "work-editor-import", editorConfig("owned-skill"), image, created)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := skillartifact.FromFiles("imported-skill", []skillartifact.File{
		{Path: "SKILL.md", Data: []byte("# Imported")},
		{Path: "references/checklist.md", Data: []byte("checklist")},
	})
	if err != nil {
		t.Fatal(err)
	}
	published, err := BuildWithPackagesAndEdits(store, directory, "work-editor-import", prior.ID, editorConfig("owned-skill", "imported-skill"), nil,
		map[string]skillartifact.Snapshot{"imported-skill": imported, "owned-skill": imported}, image, created, []PackageSource{})
	if err != nil {
		t.Fatal(err)
	}
	if got := readContextFile(t, published, "skills/imported-skill/SKILL.md"); got != "# Imported" {
		t.Fatal("uploaded content was not captured", got)
	}
	if got := readContextFile(t, published, "skills/imported-skill/references/checklist.md"); got != "checklist" {
		t.Fatal("uploaded supporting file was not captured", got)
	}
	if got := readContextFile(t, published, "skills/owned-skill/SKILL.md"); got != "# Core" {
		t.Fatal("import replaced an already owned Skill", got)
	}
	if _, err := os.Stat(filepath.Join(directory, "works", "work-editor-import", "contexts", prior.ID, "skills", "imported-skill")); !os.IsNotExist(err) {
		t.Fatal("import changed the prior published context", err)
	}
}

func TestBuildWithPackagesAndEditsRejectsMismatchedImport(t *testing.T) {
	store, directory, created := editorFixture(t)
	image := "sha256:" + strings.Repeat("a", 64)
	prior, err := BuildDefault(store, directory, "work-editor-import-bad", editorConfig(), image, created)
	if err != nil {
		t.Fatal(err)
	}
	imported, err := skillartifact.FromFiles("other-skill", []skillartifact.File{{Path: "SKILL.md", Data: []byte("# Other")}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = BuildWithPackagesAndEdits(store, directory, "work-editor-import-bad", prior.ID, editorConfig("imported-skill"), nil,
		map[string]skillartifact.Snapshot{"imported-skill": imported}, image, created, []PackageSource{})
	if !errors.Is(err, ErrContext) {
		t.Fatal("mismatched import was accepted", err)
	}
}

func TestBuildWithPackagesAndEditsPreservesWorkOwnedContent(t *testing.T) {
	store, directory, created := editorFixture(t)
	image := "sha256:" + strings.Repeat("a", 64)
	publishEditorSkill(t, store, "code-review", map[string][]byte{
		"SKILL.md": []byte("# Owned"), "references/checklist.md": []byte("old checklist"), "notes.md": []byte("keep"),
	})
	prior, err := BuildDefault(store, directory, "work-editor-1", editorConfig("code-review"), image, created)
	if err != nil {
		t.Fatal(err)
	}
	edited, err := BuildWithPackagesAndEdits(store, directory, "work-editor-1", prior.ID, editorConfig("code-review"), []SkillEdit{
		{SkillName: "code-review", Path: "references/checklist.md", Text: "new checklist"},
	}, nil, image, created, []PackageSource{})
	if err != nil {
		t.Fatal(err)
	}
	if got := readContextFile(t, edited, "skills/code-review/references/checklist.md"); got != "new checklist" {
		t.Fatal("edited file was not captured", got)
	}
	for path, want := range map[string]string{
		"skills/code-review/SKILL.md": "# Owned", "skills/code-review/notes.md": "keep", "AGENTS.md": "# Agent",
	} {
		if got := readContextFile(t, edited, path); got != want {
			t.Fatal("unrelated content changed", path, got)
		}
	}
	if got := readContextFile(t, prior, "skills/code-review/references/checklist.md"); got != "old checklist" {
		t.Fatal("prior published context changed", got)
	}
	if edited.ID == prior.ID {
		t.Fatal("edit reused a published context id")
	}

	// A changed Core catalog entry must not refresh the Work owned copy.
	updated := publishEditorSkill(t, store, "code-review-new", map[string][]byte{
		"SKILL.md": []byte("# Refreshed"), "references/checklist.md": []byte("core checklist"), "notes.md": []byte("core keep"),
	})
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE catalog_entries SET resolved_digest=? WHERE id='code-review'`, updated.Identity)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	retained, err := BuildWithPackagesAndEdits(store, directory, "work-editor-1", edited.ID, editorConfig("code-review"), []SkillEdit{
		{SkillName: "code-review", Path: "notes.md", Text: "edited again"},
	}, nil, image, created, []PackageSource{})
	if err != nil {
		t.Fatal(err)
	}
	if got := readContextFile(t, retained, "skills/code-review/SKILL.md"); got != "# Owned" {
		t.Fatal("retained Skill was refreshed from Core", got)
	}

	// Adding another Skill captures only the new name from the catalog.
	publishEditorSkill(t, store, "other-skill", map[string][]byte{"SKILL.md": []byte("# Other")})
	added, err := BuildWithPackagesAndEdits(store, directory, "work-editor-1", retained.ID, editorConfig("code-review", "other-skill"), nil, nil, image, created, []PackageSource{})
	if err != nil {
		t.Fatal(err)
	}
	if got := readContextFile(t, added, "skills/other-skill/SKILL.md"); got != "# Other" {
		t.Fatal("new Skill was not captured", got)
	}
	if got := readContextFile(t, added, "skills/code-review/SKILL.md"); got != "# Owned" {
		t.Fatal("existing Skill content changed while adding another", got)
	}

	// Removing a Skill keeps the retained copy and drops only the target.
	removed, err := BuildWithPackagesAndEdits(store, directory, "work-editor-1", added.ID, editorConfig("code-review"), nil, nil, image, created, []PackageSource{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(removed.Directory, "skills", "other-skill")); !os.IsNotExist(err) {
		t.Fatal("removed Skill remained in the new context", err)
	}
	if got := readContextFile(t, removed, "skills/code-review/SKILL.md"); got != "# Owned" {
		t.Fatal("removal refreshed the retained Skill", got)
	}
}

func TestBuildWithPackagesAndEditsRejectsNonTextAndUnknownTargets(t *testing.T) {
	store, directory, created := editorFixture(t)
	image := "sha256:" + strings.Repeat("a", 64)
	publishEditorSkill(t, store, "code-review", map[string][]byte{
		"SKILL.md": []byte("# Owned"), "asset.bin": {0, 1, 2},
	})
	prior, err := BuildDefault(store, directory, "work-editor-2", editorConfig("code-review"), image, created)
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name    string
		edits   []SkillEdit
		status  int
		code    string
		context bool
	}{
		{"new-binary", []SkillEdit{{SkillName: "code-review", Path: "SKILL.md", Text: "binary\x00text"}}, 400, "INVALID_REQUEST", false},
		{"new-invalid-utf8", []SkillEdit{{SkillName: "code-review", Path: "SKILL.md", Text: string([]byte{0xff})}}, 400, "INVALID_REQUEST", false},
		{"new-too-large", []SkillEdit{{SkillName: "code-review", Path: "SKILL.md", Text: strings.Repeat("x", 1<<20+1)}}, 400, "INVALID_REQUEST", false},
		{"binary", []SkillEdit{{SkillName: "code-review", Path: "asset.bin", Text: "text"}}, 400, "INVALID_REQUEST", false},
		{"missing-file", []SkillEdit{{SkillName: "code-review", Path: "missing.md", Text: "text"}}, 0, "", true},
		{"missing-skill", []SkillEdit{{SkillName: "unknown", Path: "SKILL.md", Text: "text"}}, 0, "", true},
		{"duplicate", []SkillEdit{{SkillName: "code-review", Path: "SKILL.md", Text: "one"}, {SkillName: "code-review", Path: "SKILL.md", Text: "two"}}, 0, "", true},
	}
	for _, item := range cases {
		t.Run(item.name, func(t *testing.T) {
			_, err := BuildWithPackagesAndEdits(store, directory, "work-editor-2", prior.ID, editorConfig("code-review"), item.edits, nil, image, created, []PackageSource{})
			if item.context {
				if !errors.Is(err, ErrContext) {
					t.Fatal("unexpected result", err)
				}
			} else {
				status, view := contracts.ProjectError(err)
				if status != item.status || view.Code != item.code {
					t.Fatal("unexpected result", status, view, err)
				}
			}
			if _, statErr := os.Stat(filepath.Join(prior.Directory, "skills/code-review/asset.bin")); statErr != nil {
				t.Fatal("failed edit damaged the prior context", statErr)
			}
		})
	}
}

func TestEditorReadRejectsBytesOutsidePublishedIdentity(t *testing.T) {
	store, directory, created := editorFixture(t)
	publishEditorSkill(t, store, "code-review", map[string][]byte{"SKILL.md": []byte("# Published")})
	published, err := BuildDefault(store, directory, "work-editor-1", editorConfig("code-review"), "sha256:"+strings.Repeat("a", 64), created)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ReadSkillFiles(store, directory, "work-editor-1", published.ID, "code-review"); err != nil {
		t.Fatal("published bytes were not readable", err)
	}
	path := filepath.Join(published.Directory, "skills", "code-review", "SKILL.md")
	if err := os.Chmod(path, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("# Tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadSkillFiles(store, directory, "work-editor-1", published.ID, "code-review"); !errors.Is(err, ErrContext) {
		t.Fatal("corrupt context was exposed as a saved baseline", err)
	}
}
