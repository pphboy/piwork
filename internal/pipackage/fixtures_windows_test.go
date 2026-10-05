package pipackage

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// Portable artifact tests need only regular files. Real symlinks are explicit
// required fixtures in the common unsafe-tree test and the native test below.
func addPackageBaselineLink(t *testing.T, root string) {}
func makeUnsafePackagePath(t *testing.T, root string) {
	t.Helper()
	path := `\\?\` + filepath.Join(root, "CON.txt")
	if err := os.WriteFile(path, []byte("unsafe reserved native name"), 0600); err != nil {
		t.Fatal(err)
	}
}
func makePackageFIFO(t *testing.T, name string) {
	t.Helper()
	target := t.TempDir()
	command := exec.Command("cmd.exe", "/c", "mklink", "/J", name, target)
	if result, err := command.CombinedOutput(); err != nil {
		t.Fatalf("junction fixture: %v %s", err, result)
	}
}

func TestWindowsRealSymlinkUsesProtocolTargetAndCanonicalModes(t *testing.T) {
	root := createPackageTree(t)
	makePackageSymlink(t, `data\binary`, filepath.Join(root, "link"))
	tree, err := OpenTree(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	found := false
	for _, entry := range tree.Entries {
		if entry.Type == "file" && entry.Mode != 0644 {
			t.Fatal("Windows invented an executable bit")
		}
		if entry.Path == "link" {
			found = true
			if entry.Target != "data/binary" || entry.Mode != 0777 {
				t.Fatal("symlink protocol changed", entry)
			}
		}
	}
	if !found {
		t.Fatal("genuine symlink was omitted")
	}
	if _, err := tree.Digest(); err != nil {
		t.Fatal(err)
	}
}
