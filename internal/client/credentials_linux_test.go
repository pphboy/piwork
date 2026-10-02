//go:build linux

package client

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"golang.org/x/sys/unix"
)

func TestCredentialDirectorySafetyAcrossAllOperations(t *testing.T) {
	for _, kind := range []string{"public-parent", "group-parent", "file-mode", "read-only-file", "file-link", "parent-link", "ancestor-link", "hard-link", "fifo"} {
		t.Run(kind, func(t *testing.T) {
			base := t.TempDir()
			path := filepath.Join(base, "credentials", "client.json")
			store := CredentialStore{Path: path}
			value := fixtureCredential("http://127.0.0.1:7171/")
			if err := store.Save(value); err != nil {
				t.Fatal(err)
			}
			original, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			preserved := path
			switch kind {
			case "public-parent", "group-parent":
				mode := os.FileMode(0777)
				if kind == "group-parent" {
					mode = 0750
				}
				if err := os.Chmod(filepath.Dir(path), mode); err != nil {
					t.Fatal(err)
				}
			case "file-mode", "read-only-file":
				mode := os.FileMode(0644)
				if kind == "read-only-file" {
					mode = 0400
				}
				if err := os.Chmod(path, mode); err != nil {
					t.Fatal(err)
				}
			case "file-link", "fifo":
				preserved = filepath.Join(base, "original.json")
				if err := os.Rename(path, preserved); err != nil {
					t.Fatal(err)
				}
				if kind == "fifo" {
					err = unix.Mkfifo(path, 0600)
				} else {
					err = os.Symlink(preserved, path)
				}
				if err != nil {
					t.Fatal(err)
				}
			case "parent-link":
				link := filepath.Join(base, "linked-credentials")
				if err := os.Symlink(filepath.Dir(path), link); err != nil {
					t.Fatal(err)
				}
				store.Path = filepath.Join(link, "client.json")
			case "ancestor-link":
				link := filepath.Join(t.TempDir(), "linked-ancestor")
				if err := os.Symlink(base, link); err != nil {
					t.Fatal(err)
				}
				store.Path = filepath.Join(link, "credentials", "client.json")
			case "hard-link":
				if err := os.Link(path, filepath.Join(base, "hard-linked.json")); err != nil {
					t.Fatal(err)
				}
			}
			beforeFile, _ := os.Lstat(store.Path)
			beforeDir, _ := os.Stat(filepath.Dir(store.Path))
			if loaded, err := store.Load(); err == nil || loaded != nil {
				t.Fatal("unsafe credential was loaded", loaded, err)
			}
			if err := store.Save(value); err == nil {
				t.Fatal("unsafe credential was overwritten")
			}
			if err := store.Clear(); err == nil {
				t.Fatal("unsafe credential was deleted")
			}
			if err := store.ClearSession(value.CoreURL, value.Token); err == nil {
				t.Fatal("unsafe credential accepted by conditional cleanup")
			}
			afterFile, _ := os.Lstat(store.Path)
			afterDir, _ := os.Stat(filepath.Dir(store.Path))
			after, err := os.ReadFile(preserved)
			if err != nil || !bytes.Equal(original, after) || beforeFile.Mode() != afterFile.Mode() || beforeDir.Mode() != afterDir.Mode() {
				t.Fatal("rejection changed the credential, target or permissions", err)
			}
		})
	}
}

func TestCredentialDirectoryCreationAndFileOwnership(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "config", "piwork", "client.json")
	store := CredentialStore{Path: path}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal("missing credentials must remain readable as signed out", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(base, "config")); !os.IsNotExist(err) {
		t.Fatal("read/delete created credential directories", err)
	}
	value := fixtureCredential("http://127.0.0.1:7171/")
	if err := store.Save(value); err != nil {
		t.Fatal(err)
	}
	for _, directory := range []string{filepath.Join(base, "config"), filepath.Dir(path)} {
		info, err := os.Stat(directory)
		if err != nil || info.Mode().Perm() != 0700 {
			t.Fatal("new credential directory is not private", err)
		}
	}
	info := unix.Stat_t{Mode: unix.S_IFREG | 0600, Uid: uint32(os.Geteuid()), Nlink: 1}
	if !validCredentialFile(&info) {
		t.Fatal("current user's credential rejected")
	}
	info.Uid++
	if validCredentialFile(&info) {
		t.Fatal("foreign credential owner accepted")
	}
	info = unix.Stat_t{Mode: unix.S_IFDIR | 0700, Uid: uint32(os.Geteuid())}
	if !validCredentialDirectory(&info) {
		t.Fatal("current user's private directory rejected")
	}
	info.Uid++
	if validCredentialDirectory(&info) {
		t.Fatal("foreign private directory owner accepted")
	}
	if os.Geteuid() != 0 {
		if directory, err := openCredentialDirectory("/usr/piwork-verification-credential", false); err == nil {
			directory.close()
			t.Fatal("foreign public parent accepted")
		}
	}
	value.Token = "updated-token"
	if err := store.Save(value); err != nil {
		t.Fatal(err)
	}
	if loaded, err := store.Load(); err != nil || loaded == nil || *loaded != value {
		t.Fatal("safe replacement failed", err)
	}
	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	if loaded, err := store.Load(); err != nil || loaded != nil {
		t.Fatal("safe deletion failed", err)
	}
}

func TestCredentialDirectoryReplacementCannotRedirectOperations(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, "credentials", "client.json")
	store := CredentialStore{Path: path}
	if err := store.Save(fixtureCredential("http://127.0.0.1:7171/")); err != nil {
		t.Fatal(err)
	}
	directory, err := openCredentialDirectory(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer directory.close()
	pinned := filepath.Join(base, "pinned")
	if err := os.Rename(filepath.Dir(path), pinned); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside")
	if err := os.Mkdir(outside, 0700); err != nil {
		t.Fatal(err)
	}
	outsideFile := filepath.Join(outside, "client.json")
	outsideBytes := []byte("outside target must remain untouched")
	if err := os.WriteFile(outsideFile, outsideBytes, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Dir(path)); err != nil {
		t.Fatal(err)
	}
	if raw, err := directory.read(); err != nil || !bytes.Contains(raw, []byte("token-1")) {
		t.Fatal("read escaped the pinned directory", err)
	}
	if err := directory.replace([]byte("updated pinned credential")); err != nil {
		t.Fatal(err)
	}
	if raw, err := os.ReadFile(filepath.Join(pinned, "client.json")); err != nil || string(raw) != "updated pinned credential" {
		t.Fatal("write escaped the pinned directory", err)
	}
	if err := directory.remove(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(pinned, "client.json")); !os.IsNotExist(err) {
		t.Fatal("pinned credential was not removed", err)
	}
	if raw, err := os.ReadFile(outsideFile); err != nil || !bytes.Equal(raw, outsideBytes) {
		t.Fatal("operation altered the replacement link target", err)
	}
}

func TestCredentialLeafLinkRaceNeverReadsOrChangesExternalTarget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	store := CredentialStore{Path: path}
	value := fixtureCredential("http://127.0.0.1:7171/")
	if err := store.Save(value); err != nil {
		t.Fatal(err)
	}
	external := filepath.Join(t.TempDir(), "external.json")
	other := value
	other.Token = "external-token-must-not-be-read"
	outsideBytes, _ := json.Marshal(other)
	if err := os.WriteFile(external, outsideBytes, 0600); err != nil {
		t.Fatal(err)
	}
	owned, _ := json.Marshal(value)
	stop := make(chan struct{})
	var group sync.WaitGroup
	group.Add(1)
	go func() {
		defer group.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = os.Remove(path)
			_ = os.Symlink(external, path)
			_ = os.Remove(path)
			temporary := filepath.Join(filepath.Dir(path), "owned-race-input")
			_ = os.WriteFile(temporary, owned, 0600)
			_ = os.Rename(temporary, path)
		}
	}()
	defer func() { close(stop); group.Wait() }()
	for range 100 {
		if loaded, err := store.Load(); err == nil && loaded != nil && loaded.Token != value.Token {
			t.Fatal("link race disclosed an external credential")
		}
		_ = store.Save(value)
		_ = store.Clear()
		_ = store.ClearSession(value.CoreURL, value.Token)
	}
	if raw, err := os.ReadFile(external); err != nil || !bytes.Equal(raw, outsideBytes) {
		t.Fatal("link race changed the external target", err)
	}
}
