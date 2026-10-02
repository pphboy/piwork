//go:build linux

package safefs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveTreeDoesNotFollowNestedLink(t *testing.T) {
	base := t.TempDir()
	root, err := OpenRoot(filepath.Join(base, "managed"))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.Lock(); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(base, "managed", "candidate", "nested"), 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside")
	if err := os.WriteFile(outside, []byte("keep"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(base, "managed", "candidate", "nested", "link")); err != nil {
		t.Fatal(err)
	}
	if err := root.RemoveTree("candidate"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(base, "managed", "candidate")); !os.IsNotExist(err) {
		t.Fatalf("candidate remained: %v", err)
	}
	if content, err := os.ReadFile(outside); err != nil || string(content) != "keep" {
		t.Fatalf("outside target changed: %q %v", content, err)
	}
}
