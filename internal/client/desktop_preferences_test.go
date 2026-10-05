package client

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/clientfs"
)

func preferenceFixture(t *testing.T) (DesktopPreferencesStore, *clientfs.Directory, string) {
	t.Helper()
	store := DesktopPreferencesStore{CredentialPath: filepath.Join(t.TempDir(), "配置 空格", "client.json")}
	path, _ := store.directory()
	d, err := clientfs.OpenPrivateDirectory(path, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { d.Close() })
	return store, d, path
}

func TestDesktopPreferencesStrictFormatAndExplicitCorruptRecovery(t *testing.T) {
	for _, raw := range []string{
		`{`, `null`, `[]`, `{"version":2,"coreUrl":"https://core.example"}`,
		`{"version":1,"coreUrl":"https://core.example","token":"never"}`,
		`{"version":1,"version":1,"coreUrl":"https://core.example"}`,
		`{"version":1,"coreUrl":"https://a.example","coreUrl":"https://b.example"}`,
		`{"version":1,"coreUrl":null}`, `{"coreUrl":"https://core.example"}`,
		`{"version":1,"coreUrl":"http://remote.example/path"}`, `{"version":1,"coreUrl":"https://core.example/path"}`,
		`{"version":1,"coreUrl":"https://core.example"} {}`, string(bytes.Repeat([]byte("x"), DesktopPreferencesLimit+1)),
	} {
		t.Run("corrupt", func(t *testing.T) {
			store, d, _ := preferenceFixture(t)
			if err := d.AtomicWrite(context.Background(), "preferences.json", []byte(raw)); err != nil {
				t.Fatal(err)
			}
			if _, err := store.Load(); !errors.Is(err, ErrDesktopPreferencesUnavailable) {
				t.Fatal("invalid record loaded", err)
			}
			if _, err := store.Save(context.Background(), "https://replacement.example", nil); !errors.Is(err, ErrDesktopPreferencesUnavailable) {
				t.Fatal("corrupt record overwritten", err)
			}
			if got, err := d.ReadFile("preferences.json", DesktopPreferencesLimit+1); err != nil || string(got) != raw {
				t.Fatal("corrupt original changed", err)
			}
			if err := store.Clear(context.Background(), nil); err != nil {
				t.Fatal("safe corrupt clear failed", err)
			}
			if value, err := store.Load(); err != nil || value != nil {
				t.Fatal("clear not confirmed", err)
			}
		})
	}
}

func TestDesktopPreferenceInputAndOriginValidation(t *testing.T) {
	for _, raw := range []string{`{"coreUrl":"https://core.example/"}`, `{"coreUrl":"http://remote.example"}`, `{"coreUrl":"http://192.168.14.134:7171/"}`, `{"coreUrl":"http://[2001:db8::1]:7171"}`, `{"coreUrl":"http://127.0.0.1:7171"}`, `{"coreUrl":"http://[::1]:7171"}`} {
		if _, err := ParseDesktopPreferenceInput([]byte(raw)); err != nil {
			t.Fatal(raw, err)
		}
	}
	for _, raw := range []string{`{"coreUrl":"https://core.example","coreUrl":"https://other.example"}`, `{"coreUrl":"https://core.example","version":1}`, `{"coreUrl":"http://remote.example/path"}`, `{"coreUrl":"https://user:password@core.example"}`, `{"coreUrl":"https://core.example?q=x"}`, `{"coreUrl":"https://core.example#ticket=x"}`, `{"coreUrl":42}`, `{}`} {
		if _, err := ParseDesktopPreferenceInput([]byte(raw)); !errors.Is(err, ErrDesktopPreferencesInvalid) {
			t.Fatal("invalid input accepted", raw, err)
		}
	}
}

func TestDesktopPreferencesMissingAndCredentialIndependence(t *testing.T) {
	store := DesktopPreferencesStore{CredentialPath: filepath.Join(t.TempDir(), "missing", "client.json")}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal(value, err)
	}
	if err := store.Clear(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Dir(store.CredentialPath)); !os.IsNotExist(err) {
		t.Fatal("read/clear created state", err)
	}
	credentials := CredentialStore{Path: store.CredentialPath}
	value := fixtureCredential("https://original.example/")
	if err := credentials.Save(value); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(store.CredentialPath)
	if core, err := store.Save(context.Background(), "http://default.example/", nil); err != nil || core != "http://default.example" {
		t.Fatal(core, err)
	}
	after, _ := os.ReadFile(store.CredentialPath)
	if !bytes.Equal(before, after) {
		t.Fatal("preferences changed credentials")
	}
	if err := credentials.Clear(); err != nil {
		t.Fatal(err)
	}
	if core, err := store.Load(); err != nil || core == nil || *core != "http://default.example" {
		t.Fatal("logout removed preference", err)
	}
}

func TestDesktopPreferencesLockCancellationAndCommitEdges(t *testing.T) {
	store, d, _ := preferenceFixture(t)
	ctx := context.Background()
	if _, err := store.Save(ctx, "https://old.example", nil); err != nil {
		t.Fatal(err)
	}
	lock, err := d.TryLock(".lock")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(ctx, "https://new.example", nil); !errors.Is(err, clientfs.ErrBusy) {
		t.Fatal("lock conflict not reported", err)
	}
	if err := store.Clear(ctx, nil); !errors.Is(err, clientfs.ErrBusy) {
		t.Fatal("clear bypassed lock", err)
	}
	lock.Close()
	canceled, cancel := context.WithCancel(ctx)
	if _, err := store.Save(canceled, "https://new.example", func() error { cancel(); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal("canceled write committed", err)
	}
	if core, err := store.Load(); err != nil || core == nil || *core != "https://old.example" {
		t.Fatal("precommit failure changed value", err)
	}
	store.write = func(ctx context.Context, d *clientfs.Directory, raw []byte, check func() error) error {
		if err := d.AtomicWriteChecked(ctx, "preferences.json", raw, check); err != nil {
			return err
		}
		return clientfs.ErrOutcomeUnknown
	}
	if _, err := store.Save(ctx, "https://new.example", nil); !errors.Is(err, clientfs.ErrOutcomeUnknown) {
		t.Fatal("committed unknown result hidden", err)
	}
	if core, err := store.Load(); err != nil || core == nil || *core != "https://new.example" {
		t.Fatal("read-back did not confirm committed value", err)
	}
}

func TestDesktopResolverPriorityAndBusinessResolverIndependence(t *testing.T) {
	store, d, _ := preferenceFixture(t)
	t.Setenv("PIWORK_CORE_URL", "")
	if _, err := store.Save(context.Background(), "http://default.example", nil); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct{ explicit, env, want string }{
		{"http://flag.example", "http://env.example", "http://flag.example"},
		{"", "http://env.example", "http://env.example"},
		{"", "", "http://default.example"},
	} {
		t.Setenv("PIWORK_CORE_URL", test.env)
		got, err := ResolveDesktopCoreURL(test.explicit, "https://saved.example", store)
		if err != nil || got != test.want {
			t.Fatal("Desktop resolution", got, err)
		}
	}
	t.Setenv("PIWORK_CORE_URL", "")
	if got, err := ResolveCoreURL("", "https://saved.example"); err != nil || got != "https://saved.example" {
		t.Fatal("business priority changed", got, err)
	}
	if err := d.AtomicWrite(context.Background(), "preferences.json", []byte("{bad")); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolveDesktopCoreURL("https://override.example", "", store); err != nil || got != "https://override.example" {
		t.Fatal("overridden corrupt preferences read", got, err)
	}
	if _, err := ResolveDesktopCoreURL("", "", store); !errors.Is(err, ErrDesktopPreferencesUnavailable) {
		t.Fatal("corrupt preference fell back", err)
	}
	if err := store.Clear(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolveDesktopCoreURL("", "https://saved.example/", store); err != nil || got != "https://saved.example" {
		t.Fatal(got, err)
	}
	if got, err := ResolveDesktopCoreURL("", "", store); err != nil || got != "http://127.0.0.1:7171" {
		t.Fatal(got, err)
	}
	for _, invalid := range []string{"bad", "http://remote.example/path"} {
		if _, err := ResolveDesktopCoreURL(invalid, "https://saved.example", store); err == nil {
			t.Fatal("invalid explicit address fell back")
		}
	}
}

func TestDesktopPreferencesRejectUnsafePermissionsAndHardLinks(t *testing.T) {
	for _, kind := range []string{"file-permissions", "directory-permissions", "hard-link"} {
		t.Run(kind, func(t *testing.T) {
			store, d, path := preferenceFixture(t)
			if _, err := store.Save(t.Context(), "https://original.example", nil); err != nil {
				t.Fatal(err)
			}
			record := filepath.Join(path, "preferences.json")
			before, _ := os.ReadFile(record)
			switch kind {
			case "file-permissions":
				makeCredentialUnsafe(t, record)
			case "directory-permissions":
				makeCredentialUnsafe(t, path)
			case "hard-link":
				if err := os.Link(record, filepath.Join(path, "extra-link")); err != nil {
					t.Fatal(err)
				}
			}
			if value, err := store.Load(); err == nil || value != nil {
				t.Fatal("unsafe preference read")
			}
			if _, err := store.Save(t.Context(), "https://replacement.example", nil); err == nil {
				t.Fatal("unsafe preference replaced")
			}
			if err := store.Clear(t.Context(), nil); err == nil {
				t.Fatal("unsafe preference cleared")
			}
			if kind == "directory-permissions" {
				restoreCredentialDirectory(t, path)
			}
			if after, err := os.ReadFile(record); err != nil || !bytes.Equal(before, after) {
				t.Fatal("unsafe record changed", err)
			}
			_ = d
		})
	}
}

// Loading a valid v1 record is read-only, including records rejected by older clients.
func TestDesktopPreferencesExistingHTTPV1IsReadWithoutMigration(t *testing.T) {
	store, d, _ := preferenceFixture(t)
	raw := []byte(`{"version":1,"coreUrl":"http://192.168.14.134:7171/"}`)
	if err := d.AtomicWrite(t.Context(), "preferences.json", raw); err != nil {
		t.Fatal(err)
	}
	value, err := store.Load()
	if err != nil || value == nil || *value != "http://192.168.14.134:7171" {
		t.Fatal(value, err)
	}
	after, err := d.ReadFile("preferences.json", DesktopPreferencesLimit)
	if err != nil || !bytes.Equal(raw, after) {
		t.Fatal("read migrated the existing record", err)
	}
	if _, err := store.Save(t.Context(), "http://remote.example", nil); err != nil {
		t.Fatal(err)
	}
	if err := store.Clear(t.Context(), nil); err != nil {
		t.Fatal(err)
	}
	if value, err := store.Load(); err != nil || value != nil {
		t.Fatal(value, err)
	}
}
