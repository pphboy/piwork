package workcontext

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/skillartifact"
)

func TestBuildDefaultPublishesAgentReadableIndependentContext(t *testing.T) {
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	source := filepath.Join(t.TempDir(), "context-skill")
	if err := os.MkdirAll(filepath.Join(source, "examples"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{"SKILL.md": "# Context Skill", "reference.md": "Reference", "examples/example.txt": "Example"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	seed, err := skillartifact.Scan(source, "context-skill")
	if err != nil {
		t.Fatal(err)
	}
	if err := skillartifact.Publish(store, seed); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO catalog_entries(id,kind,name,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'skill',?,?,'{}',1,'now','now')`, seed.Name, seed.Name, seed.Identity)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	configuration := contracts.WorkConfig{
		AgentImage: contracts.ImageSelection{CatalogId: "runtime-image-00000001"},
		Skills:     contracts.SkillSelection{"context-skill"}, Packages: contracts.PiPackageSelection{},
		AgentsMd: "# 中文说明", ModelRef: "runtime-model-00000001", McpServers: []contracts.McpServer{},
		Resources: contracts.ResourcePolicy{CpuMillis: 2000, MemoryBytes: 1610612736, AgentCpuMillis: 1000, AgentMemoryBytes: 805306368, MaxServices: 4, MaxRetainedVolumes: 2},
		Tools:     contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}},
	}
	image := "sha256:" + strings.Repeat("a", 64)
	created := time.Now().UTC().Format(time.RFC3339Nano)
	published, err := BuildDefault(store, directory, "work-default-1", configuration, image, created)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(published.Directory, published.ID) || published.ImageID != image {
		t.Fatal("context identity was not pinned", published)
	}
	var metadata contracts.WorkContextMetadata
	data, err := os.ReadFile(filepath.Join(published.Directory, "metadata.json"))
	if err != nil || json.Unmarshal(data, &metadata) != nil || metadata.WorkId != "work-default-1" || metadata.SnapshotId != published.ID || len(metadata.Skills) != 1 {
		t.Fatal("context metadata mismatch", err, metadata)
	}
	if data, err := os.ReadFile(filepath.Join(published.Directory, "AGENTS.md")); err != nil || string(data) != configuration.AgentsMd {
		t.Fatal("AGENTS.md was not captured", err)
	}
	for _, name := range []string{"config.json", "metadata.json", "AGENTS.md", "skills/context-skill/SKILL.md", "skills/context-skill/reference.md", "skills/context-skill/examples/example.txt"} {
		info, err := os.Lstat(filepath.Join(published.Directory, name))
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0444 {
			t.Fatal("context file is not immutable and Agent-readable", name, err)
		}
	}
	if info, err := os.Stat(published.Directory); err != nil || info.Mode().Perm() != 0755 {
		t.Fatal("context root is not Agent-traversable", err)
	}
	configuration.Skills = contracts.SkillSelection{}
	candidate, err := BuildDefault(store, directory, "work-default-1", configuration, image, created)
	if err != nil {
		t.Fatal("second Work context could not be staged", err)
	}
	if err := RemoveCandidate(store, "work-default-1", candidate.ID); err != nil {
		t.Fatal("lost Save candidate could not be removed", err)
	}
	if _, err := os.Stat(candidate.Directory); !os.IsNotExist(err) {
		t.Fatal("lost Save candidate remained", err)
	}
	if _, err := os.Stat(published.Directory); err != nil {
		t.Fatal("candidate cleanup removed prior active context", err)
	}
	empty, err := BuildDefault(store, directory, "work-no-skills", configuration, image, created)
	if err != nil {
		t.Fatal("explicit no-Skills context was rejected", err)
	}
	if names, err := os.ReadDir(filepath.Join(empty.Directory, "skills")); err != nil || len(names) != 0 {
		t.Fatal("no-Skills selection imported a managed Skill", err, names)
	}
	data, err = os.ReadFile(filepath.Join(empty.Directory, "metadata.json"))
	if err != nil || json.Unmarshal(data, &metadata) != nil || len(metadata.Skills) != 0 {
		t.Fatal("no-Skills metadata was not empty", err, metadata)
	}
	if err := RemoveUnaccepted(store, "work-no-skills"); err != nil {
		t.Fatal("unaccepted context cleanup failed", err)
	}
	if _, err := os.Stat(empty.Directory); !os.IsNotExist(err) {
		t.Fatal("unaccepted context remained after cleanup", err)
	}
}

func TestBuildDefaultCopiesSelectedManagedSkillAfterSourceDeletion(t *testing.T) {
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: filepath.Join(directory, "core"), InstallationID: "install-123456789abc"})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	source := filepath.Join(directory, "custom-skill")
	if err := os.MkdirAll(filepath.Join(source, "references", "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("# Custom"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "references", "guide.txt"), []byte("supporting bytes"), 0600); err != nil {
		t.Fatal(err)
	}
	artifact, err := skillartifact.Scan(source, "custom-skill")
	if err != nil {
		t.Fatal(err)
	}
	if err := skillartifact.Publish(store, artifact); err != nil {
		t.Fatal("managed Skill was not captured", err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'skill',?,NULL,?,'{}',1,?,?)`, artifact.Name, artifact.Name, artifact.Identity, now, now); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO managed_skill_artifacts(skill_name,content_identity,file_count,total_bytes,created_at) VALUES(?,?,?,?,?)`, artifact.Name, artifact.Identity, len(artifact.Files), artifact.TotalBytes, now)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	configuration := contracts.WorkConfig{
		AgentImage: contracts.ImageSelection{CatalogId: "runtime-image-00000001"},
		Skills:     contracts.SkillSelection{"custom-skill"}, Packages: contracts.PiPackageSelection{},
		AgentsMd: "", ModelRef: "runtime-model-00000001", McpServers: []contracts.McpServer{},
		Resources: contracts.ResourcePolicy{CpuMillis: 2000, MemoryBytes: 1610612736, AgentCpuMillis: 1000, AgentMemoryBytes: 805306368, MaxServices: 4, MaxRetainedVolumes: 2},
		Tools:     contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}},
	}
	published, err := BuildDefault(store, filepath.Join(directory, "core"), "work-custom", configuration, "sha256:"+strings.Repeat("a", 64), now)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(published.Directory, "skills", "custom-skill", "references", "guide.txt")
	if content, err := os.ReadFile(file); err != nil || string(content) != "supporting bytes" {
		t.Fatal("supporting Skill file was not copied into Work context", err)
	}
	if info, err := os.Stat(file); err != nil || info.Mode().Perm() != 0444 {
		t.Fatal("copied Skill file is not immutable and Agent-readable", err)
	}
	if info, err := os.Stat(filepath.Join(published.Directory, "skills", "custom-skill", "references", "empty")); err != nil || !info.IsDir() {
		t.Fatal("empty Skill directory was not copied", err)
	}
	var metadata contracts.WorkContextMetadata
	content, err := os.ReadFile(filepath.Join(published.Directory, "metadata.json"))
	if err != nil || json.Unmarshal(content, &metadata) != nil || len(metadata.Skills) != 1 || metadata.Skills[0].Identity != artifact.Identity {
		t.Fatal("managed Skill identity was not pinned in Work context", err)
	}
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`DELETE FROM catalog_entries WHERE id='custom-skill'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := skillartifact.CleanupOrphans(store); err != nil {
		t.Fatal(err)
	}
	configuration.AgentsMd = "# Updated without reselecting Skill"
	if rescanned, scanErr := skillartifact.Scan(filepath.Join(published.Directory, "skills", "custom-skill"), "custom-skill"); scanErr != nil || rescanned.Identity != artifact.Identity {
		t.Fatal("prior Work Skill cannot be verified independently", scanErr, rescanned.Identity, artifact.Identity)
	}
	preserved, err := BuildPreservingSkills(store, filepath.Join(directory, "core"), "work-custom", published.ID, configuration, "sha256:"+strings.Repeat("a", 64), now)
	if err != nil {
		t.Fatal("AGENTS save could not preserve a Work-owned Skill after Core removal", err)
	}
	if content, err := os.ReadFile(filepath.Join(preserved.Directory, "skills", "custom-skill", "references", "guide.txt")); err != nil || string(content) != "supporting bytes" {
		t.Fatal("AGENTS save changed the Work-owned Skill bytes", err)
	}
	if content, err := os.ReadFile(filepath.Join(preserved.Directory, "AGENTS.md")); err != nil || string(content) != configuration.AgentsMd {
		t.Fatal("AGENTS save did not update its own content", err)
	}
}
