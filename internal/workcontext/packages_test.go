package workcontext

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/pipackage"
)

func TestPackageContextCopiesOwnedBytesAndRetainsSelection(t *testing.T) {
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	source := t.TempDir()
	if err := os.Mkdir(filepath.Join(source, "bin"), 0755); err != nil {
		t.Fatal(err)
	}
	for name, data := range map[string]string{"package.json": `{"name":"@team/tools","version":"1.0.0","pi":{"prompts":["review.md"]}}`, "review.md": "Review this Work.\n", "bin/tool": "#!/bin/sh\nexit 99\n"} {
		mode := os.FileMode(0644)
		if name == "bin/tool" {
			mode = 0755
		}
		if err := os.WriteFile(filepath.Join(source, name), []byte(data), mode); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink("bin/tool", filepath.Join(source, "tool")); err != nil {
		t.Fatal(err)
	}
	tree, err := pipackage.OpenTree(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	env := contracts.PiPackagePreparedEnvironment{Os: "linux", Architecture: "amd64", Variant: json.RawMessage(`null`), NodeAbi: "137", PiSdkVersion: "0.86.1"}
	artifact, err := pipackage.ValidateArtifact(tree, "local", "tools-dir", env, "")
	tree.Close()
	if err != nil {
		t.Fatal(err)
	}
	config := contracts.WorkConfig{AgentImage: contracts.ImageSelection{CatalogId: "runtime-image-00000001"}, Skills: contracts.SkillSelection{}, Packages: contracts.PiPackageSelection{}, AgentsMd: "", ModelRef: "runtime-model-00000001", McpServers: []contracts.McpServer{}, Resources: contracts.ResourcePolicy{CpuMillis: 2000, MemoryBytes: 1610612736, AgentCpuMillis: 1000, AgentMemoryBytes: 805306368, MaxServices: 4, MaxRetainedVolumes: 2}, Tools: contracts.ToolPolicy{Allowed: []contracts.WorkToolPolicyKey{}, Denied: []contracts.WorkToolPolicyKey{}}}
	config.Packages = contracts.PiPackageSelection{{Name: "@team/tools", Enabled: true}}
	image := "sha256:" + strings.Repeat("a", 64)
	now := "2026-10-01T00:00:00Z"
	first, err := BuildWithPackages(store, directory, "work-owned", "", true, config, image, now, []PackageSource{{Name: "@team/tools", Directory: source, Metadata: artifact.Metadata}})
	if err != nil {
		t.Fatal(err)
	}
	key := contracts.PackageNameKey("@team/tools")
	original, _ := os.Stat(filepath.Join(source, "review.md"))
	owned, err := os.Stat(filepath.Join(first.Directory, "packages", key, "review.md"))
	if err != nil || os.SameFile(original, owned) || owned.Mode().Perm() != 0444 {
		t.Fatal("package was not copied/sealed", owned, err)
	}
	if executable, err := os.Stat(filepath.Join(first.Directory, "packages", key, "bin/tool")); err != nil || executable.Mode().Perm() != 0555 {
		t.Fatal(executable, err)
	}
	if link, err := os.Readlink(filepath.Join(first.Directory, "packages", key, "tool")); err != nil || link != "bin/tool" {
		t.Fatal(link, err)
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	config.Packages[0].Enabled = false
	config.AgentsMd = "Updated context"
	second, err := BuildPreservingSkills(store, directory, "work-owned", first.ID, config, image, now)
	if err != nil {
		t.Fatal("Save depended on removed source", err)
	}
	metadata, err := Metadata(store, "work-owned", second.ID)
	if err != nil || len(metadata.PackageBindings) != 1 || metadata.PackageBindings[0].Artifact.ContentDigest != artifact.Metadata.ContentDigest {
		t.Fatal(metadata, err)
	}
	if content, err := os.ReadFile(filepath.Join(second.Directory, "packages", key, "review.md")); err != nil || string(content) != "Review this Work.\n" {
		t.Fatal(string(content), err)
	}
}
