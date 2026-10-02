package safefs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRenameNoReplacePreservesExistingIdentity(t *testing.T) {
	directory := t.TempDir()
	root, err := OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.Lock(); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{"stage": "new", "published": "old"} {
		if err := root.AtomicWrite(name, "tmp-"+name, []byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := root.RenameNoReplace("stage", "published"); err == nil {
		t.Fatal("immutable publication replaced an existing identity")
	}
	for name, content := range map[string]string{"stage": "new", "published": "old"} {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil || string(raw) != content {
			t.Fatal("failed publication changed content", name, err)
		}
	}
}
