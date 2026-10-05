package pipackage

import (
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
	"testing"
)

func addPackageBaselineLink(t *testing.T, root string) {
	makePackageSymlink(t, "data/binary", filepath.Join(root, "link"))
}
func makeUnsafePackagePath(t *testing.T, root string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(root, "a\\b"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
}

func makePackageFIFO(t *testing.T, name string) {
	t.Helper()
	if err := unix.Mkfifo(name, 0600); err != nil {
		t.Fatal(err)
	}
}
