//go:build linux

package skillartifact

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/corestore"
)

func TestPublishCopiesCompleteSkillAndRejectsTamperedIdentity(t *testing.T) {
	directory := t.TempDir()
	store, err := corestore.Open(context.Background(), corestore.Options{Directory: filepath.Join(directory, "core"), InstallationID: "install-123456789abc"})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	source := filepath.Join(directory, "my-skill")
	if err := os.MkdirAll(filepath.Join(source, "nested", "empty"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "SKILL.md"), []byte("# Original"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "nested", "support.txt"), []byte("support"), 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := Scan(source, "my-skill")
	if err != nil {
		t.Fatal(err)
	}
	if err := Publish(store, snapshot); err != nil {
		t.Fatal(err)
	}
	if err := os.RemoveAll(source); err != nil {
		t.Fatal(err)
	}
	if err := Publish(store, snapshot); err != nil {
		t.Fatal("identical artifact was not reusable after source deletion", err)
	}
	loaded, err := Load(store, "my-skill", snapshot.Identity)
	if err != nil || loaded.Identity != snapshot.Identity || len(loaded.Files) != len(snapshot.Files) {
		t.Fatal("published Skill was not independently readable", err)
	}
	artifact := filepath.Join(directory, "core", "skills", "my-skill", "artifacts", strings.TrimPrefix(snapshot.Identity, "sha256:"))
	if _, err := os.Stat(filepath.Join(artifact, "nested", "empty")); err != nil {
		t.Fatal("empty supporting directory was not copied", err)
	}
	if err := os.WriteFile(filepath.Join(artifact, "SKILL.md"), []byte("# Tampered"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := Publish(store, snapshot); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("tampered immutable identity was reused", err)
	}
	if _, err := Load(store, "my-skill", snapshot.Identity); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("tampered immutable identity was loaded", err)
	}
}
