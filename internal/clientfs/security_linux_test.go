package clientfs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func TestPrivateLinuxStorageRejectsLinksBroadModesAndNonregularFiles(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "fifo", "directory", "broad-mode"} {
		t.Run(kind, func(t *testing.T) {
			d, path := privateDirectory(t)
			outside := filepath.Join(t.TempDir(), "sentinel")
			if err := os.WriteFile(outside, []byte("untouched"), 0600); err != nil {
				t.Fatal(err)
			}
			target := filepath.Join(path, "record")
			var err error
			switch kind {
			case "symlink":
				err = os.Symlink(outside, target)
			case "hardlink":
				err = os.Link(outside, target)
			case "fifo":
				err = unix.Mkfifo(target, 0600)
			case "directory":
				err = os.Mkdir(target, 0700)
			case "broad-mode":
				err = os.WriteFile(target, []byte("old"), 0644)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := d.ReadFile("record", 64); !errors.Is(err, ErrUnsafe) {
				t.Fatal("unsafe read", err)
			}
			if err := d.AtomicWrite(context.Background(), "record", []byte("bad")); !errors.Is(err, ErrUnsafe) {
				t.Fatal("unsafe overwrite", err)
			}
			if err := d.Remove("record"); !errors.Is(err, ErrUnsafe) {
				t.Fatal("unsafe remove", err)
			}
			if raw, err := os.ReadFile(outside); err != nil || string(raw) != "untouched" {
				t.Fatal("sentinel changed", string(raw), err)
			}
		})
	}
}

func TestLinuxParentsCannotRedirectPinnedReadsWritesAndChildren(t *testing.T) {
	base := t.TempDir()
	parent := filepath.Join(base, "parent")
	state := filepath.Join(parent, "state")
	d, err := OpenPrivateDirectory(state, true)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := d.AtomicWrite(context.Background(), "record", []byte("original")); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Mkdir(filepath.Join(outside, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(outside, "state", "record"), []byte("sentinel"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(parent, filepath.Join(base, "held")); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, parent); err != nil {
		t.Fatal(err)
	}
	if redirected, err := OpenPrivateDirectory(state, false); !errors.Is(err, ErrUnsafe) {
		if redirected != nil {
			redirected.Close()
		}
		t.Fatal("followed replaced parent", err)
	}
	if raw, err := d.ReadFile("record", 64); err != nil || string(raw) != "original" {
		t.Fatal("read redirected", string(raw), err)
	}
	if err := d.AtomicWrite(context.Background(), "record", []byte("updated")); err != nil {
		t.Fatal(err)
	}
	child, err := d.Child("child", true)
	if err != nil {
		t.Fatal(err)
	}
	child.Close()
	if raw, err := os.ReadFile(filepath.Join(outside, "state", "record")); err != nil || string(raw) != "sentinel" {
		t.Fatal("outside written", string(raw), err)
	}
	if _, err := os.Stat(filepath.Join(outside, "state", "child")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("outside child created", err)
	}
}

func TestLinuxPrivateDirectoryMustBeOwnedAndPrivate(t *testing.T) {
	name := filepath.Join(t.TempDir(), "state")
	if err := os.Mkdir(name, 0755); err != nil {
		t.Fatal(err)
	}
	if d, err := OpenPrivateDirectory(name, true); !errors.Is(err, ErrUnsafe) {
		if d != nil {
			d.Close()
		}
		t.Fatal("broad directory accepted", err)
	}
	info, err := os.Stat(name)
	if err != nil || info.Mode().Perm() != 0755 {
		t.Fatal("existing directory silently chmodded", err)
	}
	ordinary, err := OpenDirectory(name)
	if err != nil {
		t.Fatal(err)
	}
	ordinary.Close()
}

func TestLinuxExclusiveCreationKeepsPrivateModesUnderRestrictiveUmask(t *testing.T) {
	d, path := privateDirectory(t)
	previous := unix.Umask(0777)
	defer unix.Umask(previous)
	f, err := d.CreateExclusive("file")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
	lock, err := d.TryLock(".lock")
	if err != nil {
		t.Fatal(err)
	}
	lock.Close()
	for _, name := range []string{"file", ".lock"} {
		info, err := os.Stat(filepath.Join(path, name))
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatal(name, err)
		}
	}
}
