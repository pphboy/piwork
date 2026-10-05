package clientfs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPrivateTemporaryTreeUsesNativeCreationAndPinnedCleanup(t *testing.T) {
	parent, path := privateDirectory(t)
	child, name, err := parent.CreateTempDirectory("scratch-")
	if err != nil {
		t.Fatal(err)
	}
	defer child.Close()
	nested, err := child.Child("中文 空格", true)
	if err != nil {
		t.Fatal(err)
	}
	defer nested.Close()
	if err := nested.AtomicWrite(t.Context(), "content", []byte("private content")); err != nil {
		t.Fatal(err)
	}
	if err := parent.RemoveTree(name); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(filepath.Join(path, name)); !os.IsNotExist(err) {
		t.Fatal("private tree was retained", err)
	}
	if err := parent.RemoveTree(name); err != nil {
		t.Fatal("missing cleanup not idempotent", err)
	}
	if err := parent.RemoveTree("../escape"); err == nil {
		t.Fatal("unsafe cleanup name accepted")
	}
}

func TestPrivateTreeCleanupRefusesHardLinkedSentinel(t *testing.T) {
	parent, path := privateDirectory(t)
	child, name, err := parent.CreateTempDirectory("scratch-")
	if err != nil {
		t.Fatal(err)
	}
	defer child.Close()
	if err := child.AtomicWrite(t.Context(), "sentinel", []byte("must remain")); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "external")
	if err := os.Link(filepath.Join(path, name, "sentinel"), external); err != nil {
		t.Fatal(err)
	}
	if err := parent.RemoveTree(name); err == nil {
		t.Fatal("hard-link cleanup accepted")
	}
	raw, err := os.ReadFile(external)
	if err != nil || string(raw) != "must remain" {
		t.Fatal("external sentinel changed", err)
	}
	if _, err := os.Lstat(filepath.Join(path, name, "sentinel")); err != nil {
		t.Fatal("unsafe tree deleted", err)
	}
}
