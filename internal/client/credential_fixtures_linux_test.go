package client

import (
	"os"
	"testing"
)

func assertCredentialPrivate(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("credential permissions", err)
	}
}

func makeCredentialLink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
}

func makeCredentialUnsafe(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0644); err != nil {
		t.Fatal(err)
	}
}

func restoreCredentialDirectory(t *testing.T, path string) {
	t.Helper()
	if err := os.Chmod(path, 0700); err != nil {
		t.Fatal(err)
	}
}
