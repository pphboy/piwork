package coreapp

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func closeSettingsApp(t *testing.T, a *Application) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
}
func TestCustomOperatorCredentialIsPrivatePersistentAndNeverRotated(t *testing.T) {
	for _, kind := range []string{"external", "root", "secrets"} {
		t.Run(kind, func(t *testing.T) {
			directory := t.TempDir()
			parent := t.TempDir()
			os.Chmod(parent, 0700)
			if kind == "root" {
				parent = directory
			}
			if kind == "secrets" {
				parent = filepath.Join(directory, "secrets")
			}
			path := filepath.Join(parent, "操作凭证.key")
			options := Options{DataDirectory: directory, OperatorCredentialPath: path}
			a, err := New(context.Background(), options)
			if err != nil {
				t.Fatal(err)
			}
			before, err := os.ReadFile(path)
			if err != nil || len(strings.TrimSpace(string(before))) != 64 {
				t.Fatal("credential missing", err)
			}
			if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0600 {
				t.Fatal("credential is not private", err)
			}
			if !a.Settings.VerifyOperator(context.Background(), strings.TrimSpace(string(before))) {
				t.Fatal("credential was not registered")
			}
			closeSettingsApp(t, a)
			b, err := New(context.Background(), options)
			if err != nil {
				t.Fatal(err)
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(before, after) {
				t.Fatal("credential rotated on restart")
			}
			closeSettingsApp(t, b)
			// A missing persisted credential must fail, not regenerate access.
			if err := os.Remove(path); err != nil {
				t.Fatal(err)
			}
			if c, err := New(context.Background(), options); err == nil {
				closeSettingsApp(t, c)
				t.Fatal("missing credential was silently replaced")
			}
			if _, err := os.Stat(path); !os.IsNotExist(err) {
				t.Fatal("failed startup regenerated credential")
			}
		})
	}
}
func TestCustomOperatorRejectsUnsafeFilesAndParentsWithoutChangingThem(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "fifo", "public", "public-parent", "parent-link", "mismatch"} {
		t.Run(kind, func(t *testing.T) {
			directory, parent := t.TempDir(), t.TempDir()
			os.Chmod(parent, 0700)
			path := filepath.Join(parent, "operator.key")
			seed := filepath.Join(parent, "seed")
			os.WriteFile(seed, []byte(strings.Repeat("f", 64)+"\n"), 0600)
			var err error
			switch kind {
			case "symlink":
				err = os.Symlink(seed, path)
			case "hardlink":
				err = os.Link(seed, path)
			case "fifo":
				err = unix.Mkfifo(path, 0600)
			case "public":
				err = os.WriteFile(path, []byte(strings.Repeat("e", 64)), 0644)
			case "public-parent":
				err = os.Chmod(parent, 0755)
			case "parent-link":
				link := filepath.Join(t.TempDir(), "link")
				err = os.Symlink(parent, link)
				path = filepath.Join(link, "operator.key")
			case "mismatch":
				a, openErr := New(context.Background(), Options{DataDirectory: directory, OperatorCredentialPath: path})
				if openErr != nil {
					t.Fatal(openErr)
				}
				closeSettingsApp(t, a)
				err = os.WriteFile(path, []byte(strings.Repeat("e", 64)+"\n"), 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			if a, err := New(context.Background(), Options{DataDirectory: directory, OperatorCredentialPath: path}); err == nil {
				closeSettingsApp(t, a)
				t.Fatal("unsafe operator storage accepted")
			}
			if data, _ := os.ReadFile(seed); string(data) != strings.Repeat("f", 64)+"\n" {
				t.Fatal("rejected startup modified another file")
			}
			if kind == "mismatch" {
				data, _ := os.ReadFile(path)
				if string(data) != strings.Repeat("e", 64)+"\n" {
					t.Fatal("mismatch was repaired without authorization")
				}
			}
		})
	}
}
func TestIndependentCoreCredentialsCanSharePrivateExternalParent(t *testing.T) {
	parent := t.TempDir()
	os.Chmod(parent, 0700)
	first, err := New(context.Background(), Options{DataDirectory: t.TempDir(), OperatorCredentialPath: filepath.Join(parent, "first.key")})
	if err != nil {
		t.Fatal(err)
	}
	defer closeSettingsApp(t, first)
	second, err := New(context.Background(), Options{DataDirectory: t.TempDir(), OperatorCredentialPath: filepath.Join(parent, "second.key")})
	if err != nil {
		t.Fatal("independent installation was blocked by an unrelated credential", err)
	}
	defer closeSettingsApp(t, second)
	a, _ := os.ReadFile(filepath.Join(parent, "first.key"))
	b, _ := os.ReadFile(filepath.Join(parent, "second.key"))
	if bytes.Equal(a, b) || !first.Settings.VerifyOperator(context.Background(), strings.TrimSpace(string(a))) || second.Settings.VerifyOperator(context.Background(), strings.TrimSpace(string(a))) {
		t.Fatal("independent credentials were mixed")
	}
}
func TestCredentialCannotBeConsumedAsPublicationRecoveryTemporaryFile(t *testing.T) {
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	closeSettingsApp(t, a)
	path := filepath.Join(directory, "runtime", "platform", "publish-"+strings.Repeat("f", 32)+".tmp")
	data := []byte(strings.Repeat("a", 64) + "\n")
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if b, err := New(context.Background(), Options{DataDirectory: directory, OperatorCredentialPath: path}); err == nil {
		closeSettingsApp(t, b)
		t.Fatal("reserved temporary namespace was accepted")
	}
	if got, err := os.ReadFile(path); err != nil || !bytes.Equal(got, data) {
		t.Fatal("invalid custom credential was deleted by recovery", err)
	}
}
func TestRuntimePublicationKeepsOldSecretReferencesAndRejectsUnsafeTarget(t *testing.T) {
	directory := t.TempDir()
	a, err := New(context.Background(), Options{DataDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer closeSettingsApp(t, a)
	input := RuntimeInput{AgentImage: "fixture/native", Provider: "fixture", Model: "first", Credential: "first-key"}
	if _, err := a.Settings.ConfigureRuntime(input); err != nil {
		t.Fatal(err)
	}
	first, _, _ := a.Settings.LoadRuntime()
	input.Model, input.Credential = "second", "second-key"
	if _, err := a.Settings.ConfigureRuntime(input); err != nil {
		t.Fatal(err)
	}
	second, _, _ := a.Settings.LoadRuntime()
	if second.Revision != first.Revision+1 || second.Model.CredentialRef == first.Model.CredentialRef {
		t.Fatal("runtime was not independently versioned")
	}
	if raw, err := a.files.ReadSecret(first.Model.CredentialRef); err != nil || string(raw) != "first-key\n" {
		t.Fatal("updating defaults changed an old secret reference", err)
	}
	profile := filepath.Join(directory, "runtime-profile.json")
	old, _ := os.ReadFile(profile)
	copy := filepath.Join(directory, "secrets", "unrelated")
	os.WriteFile(copy, old, 0600)
	os.Remove(profile)
	os.Symlink(copy, profile)
	if _, err := a.Settings.ConfigureRuntime(input); err == nil {
		t.Fatal("followed unsafe runtime target")
	}
	if raw, _ := os.ReadFile(copy); !bytes.Equal(raw, old) {
		t.Fatal("publication modified symlink target")
	}
}
