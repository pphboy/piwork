package client

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestWindowsCredentialSafetyAcrossAllOperations(t *testing.T) {
	for _, kind := range []string{"file-acl", "directory-acl", "hard-link", "junction-parent", "directory-target"} {
		t.Run(kind, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			store := CredentialStore{Path: path}
			value := fixtureCredential("http://127.0.0.1:7171/")
			if err := store.Save(value); err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			preserved := path
			switch kind {
			case "file-acl":
				makeCredentialUnsafe(t, path)
			case "directory-acl":
				makeCredentialUnsafe(t, filepath.Dir(path))
			case "hard-link":
				if err := os.Link(path, path+"-link"); err != nil {
					t.Fatal(err)
				}
			case "junction-parent":
				junction := filepath.Join(t.TempDir(), "redirect")
				if out, err := exec.Command("cmd.exe", "/d", "/c", "mklink", "/j", junction, filepath.Dir(path)).CombinedOutput(); err != nil {
					t.Fatalf("junction fixture unavailable: %v %s", err, out)
				}
				store.Path = filepath.Join(junction, "client.json")
			case "directory-target":
				preserved = path + "-original"
				if err := os.Rename(path, preserved); err != nil {
					t.Fatal(err)
				}
				if err := os.Mkdir(path, 0700); err != nil {
					t.Fatal(err)
				}
			}
			if value, err := store.Load(); err == nil || value != nil {
				t.Fatal("unsafe credentials loaded", err)
			}
			for _, mutation := range []func() error{func() error { return store.Save(value) }, store.Clear, func() error { return store.ClearSession(value.CoreURL, value.Token) }} {
				if err := mutation(); err == nil {
					t.Fatal("unsafe credentials changed")
				}
			}
			if after, err := os.ReadFile(preserved); err != nil || !bytes.Equal(before, after) {
				t.Fatal("unsafe rejection changed original", err)
			}
		})
	}
}

func TestWindowsCredentialDeleteFailurePreservesRecord(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	store := CredentialStore{Path: path}
	value := fixtureCredential("https://core.example/")
	if err := store.Save(value); err != nil {
		t.Fatal(err)
	}
	name, err := windows.UTF16PtrFromString(path)
	if err != nil {
		t.Fatal(err)
	}
	// A native reader that does not share DELETE prevents removal. This is
	// a real storage failure rather than a malformed/private-permission test.
	h, err := windows.CreateFile(name, windows.GENERIC_READ, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, windows.FILE_ATTRIBUTE_NORMAL, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer windows.CloseHandle(h)
	for _, clear := range []func() error{store.Clear, func() error { return store.ClearSession(value.CoreURL, value.Token) }} {
		if err := clear(); err == nil {
			t.Fatal("native deletion failure reported success")
		}
		if loaded, err := store.Load(); err != nil || loaded == nil || *loaded != value {
			t.Fatal("failed deletion changed credential", err)
		}
	}
}

func TestWindowsCredentialPrivateCreationAndMissingReads(t *testing.T) {
	path := filepath.Join(t.TempDir(), "用户 配置", "piwork", "client.json")
	store := CredentialStore{Path: path}
	if loaded, err := store.Load(); err != nil || loaded != nil {
		t.Fatal("missing credentials not signed out", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(filepath.Dir(path))); !os.IsNotExist(err) {
		t.Fatal("missing read/delete created state", err)
	}
	value := fixtureCredential("https://core.example/")
	if err := store.Save(value); err != nil {
		t.Fatal(err)
	}
	assertCredentialPrivate(t, path)
	if loaded, err := store.Load(); err != nil || loaded == nil || *loaded != value {
		t.Fatal("private credential round trip", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	if loaded, err := store.Load(); err != nil || loaded != nil {
		t.Fatal("credential removal failed", err)
	}
}
