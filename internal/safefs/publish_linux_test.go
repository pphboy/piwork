//go:build linux

package safefs

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestPrivatePublicationRejectsLinksFIFOAndUnintendedReplacement(t *testing.T) {
	source, sourcePath := privateTestRoot(t)
	target, targetPath := privateTestRoot(t)
	if err := os.WriteFile(filepath.Join(sourcePath, "new"), []byte("new"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetPath, "existing"), []byte("old"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := source.PublishTo("new", target, "existing", false); err == nil {
		t.Fatal("replaced an existing credential")
	}
	if data, _ := target.ReadFile("existing", 100); string(data) != "old" {
		t.Fatal("old bytes changed")
	}
	if err := source.PublishTo("new", target, "existing", true); err != nil {
		t.Fatal(err)
	}
	if data, _ := target.ReadFile("existing", 100); string(data) != "new" {
		t.Fatal("publication failed")
	}
	for _, kind := range []string{"symlink", "hardlink", "fifo", "public"} {
		t.Run(kind, func(t *testing.T) {
			name := filepath.Join(targetPath, kind)
			var err error
			switch kind {
			case "symlink":
				err = os.Symlink(filepath.Join(targetPath, "existing"), name)
			case "hardlink":
				err = os.Link(filepath.Join(targetPath, "existing"), name)
			case "fifo":
				err = unix.Mkfifo(name, 0600)
			case "public":
				err = os.WriteFile(name, []byte("keep"), 0644)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := target.ReadFile(kind, 100); err == nil {
				t.Fatal("unsafe target was readable")
			}
			if err := os.WriteFile(filepath.Join(sourcePath, "candidate"), []byte("candidate"), 0600); err != nil {
				t.Fatal(err)
			}
			if err := source.PublishTo("candidate", target, kind, true); err == nil {
				t.Fatal("unsafe target was overwritten")
			}
			if data, _ := source.ReadFile("candidate", 100); string(data) != "candidate" {
				t.Fatal("rejected publication removed its source")
			}
			os.Remove(filepath.Join(sourcePath, "candidate"))
			os.Remove(name)
		})
	}
}

func TestExistingPrivateRootReadCreatesNothing(t *testing.T) {
	parent := t.TempDir()
	missing := filepath.Join(parent, "missing")
	if root, err := OpenExistingRoot(missing); err == nil {
		root.Close()
		t.Fatal("accepted missing parent")
	}
	if _, err := os.Stat(missing); !os.IsNotExist(err) {
		t.Fatal("read created a parent")
	}
}
