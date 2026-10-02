//go:build linux

package skillartifact

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/coreassets"
)

func TestScanMatchesBundledSkillIdentityAndSurvivesSourceDeletion(t *testing.T) {
	source, err := filepath.Abs(filepath.Join("..", "coreassets", coreassets.DeploymentSkillName))
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := Scan(source, coreassets.DeploymentSkillName)
	if err != nil {
		t.Fatal(err)
	}
	_, embeddedIdentity, err := coreassets.DeploymentSkill()
	if err != nil || snapshot.Identity != embeddedIdentity || len(snapshot.Files) != 3 {
		t.Fatal("source and embedded Skill identities differ", snapshot.Identity, embeddedIdentity, err)
	}
	directory := filepath.Join(t.TempDir(), "my-skill")
	if err := os.MkdirAll(filepath.Join(directory, "nested", "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "SKILL.md"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "nested", "data.txt"), []byte("support"), 0600); err != nil {
		t.Fatal(err)
	}
	captured, err := Scan(directory, "my-skill")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(directory); err != nil {
		t.Fatal(err)
	}
	if len(captured.Directories) != 2 || len(captured.Files) != 2 || string(captured.Files[0].Data) != "original" {
		t.Fatal("complete Skill tree was not copied into the snapshot", captured)
	}
}

func TestScanRejectsLinkAndMissingManifest(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "my-skill")
	if err := os.Mkdir(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := Scan(directory, "my-skill"); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("missing root SKILL.md accepted", err)
	}
	if err := os.WriteFile(filepath.Join(directory, "SKILL.md"), []byte("safe"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(filepath.Join(directory, "SKILL.md"), filepath.Join(directory, "link.md")); err != nil {
		t.Fatal(err)
	}
	if _, err := Scan(directory, "my-skill"); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("linked supporting file accepted", err)
	}
	if _, err := Scan(directory, "other-name"); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("mismatched Skill name accepted", err)
	}
}
