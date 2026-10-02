package safefs

import (
	"path/filepath"
	"testing"
)

func TestPrivateChildMutationsRequireLiveInstallationLock(t *testing.T) {
	root, err := OpenRoot(filepath.Join(t.TempDir(), "core"))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if _, err := root.OpenPrivateDirectory("uploads"); err == nil {
		t.Fatal("unlocked root delegated writes")
	}
	if err := root.Lock(); err != nil {
		t.Fatal(err)
	}
	if err := root.EnsureDirectory("uploads"); err != nil {
		t.Fatal(err)
	}
	first, err := root.OpenPrivateDirectory("uploads")
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close()
	second, err := root.OpenPrivateDirectory("uploads")
	if err != nil {
		t.Fatal("independent transfer collided", err)
	}
	defer second.Close()
	if err := first.AtomicWrite("first.zip", "first.tmp", []byte("first")); err != nil {
		t.Fatal(err)
	}
	if err := second.AtomicWrite("second.zip", "second.tmp", []byte("second")); err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	if err := first.Remove("first.zip"); err == nil {
		t.Fatal("write survived installation lock owner")
	}
	if data, err := second.ReadFile("second.zip", 64); err != nil || string(data) != "second" {
		t.Fatal(data, err)
	}
}
