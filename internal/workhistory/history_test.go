package workhistory

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

type historyCase struct {
	Name         string
	Code         *string
	Summary      *Summary
	SourceWorkID string
	ContextIDs   []string
}

func historyCases(t *testing.T) []historyCase {
	t.Helper()
	raw, err := os.ReadFile("testdata/cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []historyCase
	if json.Unmarshal(raw, &cases) != nil {
		t.Fatal("current history cases JSON")
	}
	return cases
}
func copyFixture(t *testing.T, name, target string) {
	t.Helper()
	err := filepath.WalkDir("testdata/"+name, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel("testdata/"+name, path)
		if err != nil {
			return err
		}
		out := filepath.Join(target, relative)
		if entry.IsDir() {
			return os.MkdirAll(out, 0700)
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(out, raw, 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
}
func fingerprint(t *testing.T, name string) map[string]string {
	t.Helper()
	values := map[string]string{}
	err := filepath.WalkDir(name, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		sum := sha256.Sum256(raw)
		relative, _ := filepath.Rel(name, path)
		values[relative] = hex.EncodeToString(sum[:])
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return values
}
func scopeFor(test historyCase, scratch string) Scope {
	contexts := map[string]bool{}
	for _, id := range test.ContextIDs {
		contexts[id] = true
	}
	return Scope{SourceWorkID: test.SourceWorkID, ContextIDs: contexts, ScratchDirectory: scratch}
}
func TestCurrentHistoryCasesWithoutSourceMutation(t *testing.T) {
	for _, test := range historyCases(t) {
		t.Run(test.Name, func(t *testing.T) {
			root := t.TempDir()
			private := filepath.Join(root, "private")
			copyFixture(t, test.Name, private)
			before := fingerprint(t, private)
			snapshot, err := Open(context.Background(), private, scopeFor(test, root))
			if test.Code == nil {
				if err != nil || snapshot == nil {
					t.Fatal("valid current history rejected", err)
				}
				if !reflect.DeepEqual(snapshot.Summary, *test.Summary) {
					t.Fatal(snapshot.Summary, test.Summary)
				}
				if err := snapshot.Close(); err != nil {
					t.Fatal(err)
				}
				if err := snapshot.Close(); err != nil {
					t.Fatal(err)
				}
			} else {
				if snapshot != nil {
					snapshot.Close()
				}
				own, ok := err.(*Error)
				if !ok || own.Code != *test.Code {
					t.Fatal("current history rejection mismatch", test.Code, err)
				}
			}
			if !reflect.DeepEqual(before, fingerprint(t, private)) {
				t.Fatal("source DB/WAL/SHM/SDK bytes changed")
			}
			entries, _ := os.ReadDir(root)
			for _, entry := range entries {
				if entry.Name() != "private" {
					t.Fatal("history scratch leaked", entry.Name())
				}
			}
		})
	}
}
func TestUninitializedHistoryRejectsOrphanSidecarsAndLinks(t *testing.T) {
	for _, kind := range []string{"empty", "orphan", "link"} {
		t.Run(kind, func(t *testing.T) {
			root := t.TempDir()
			private := filepath.Join(root, "private")
			os.Mkdir(private, 0700)
			if kind == "orphan" {
				os.WriteFile(filepath.Join(private, "work.sqlite-wal"), []byte("not SQLite"), 0600)
			}
			if kind == "link" {
				os.Symlink("/outside/secret", filepath.Join(private, "work.sqlite"))
			}
			snapshot, err := Open(context.Background(), private, Scope{SourceWorkID: "source-work", ContextIDs: map[string]bool{}, ScratchDirectory: root})
			if snapshot != nil {
				snapshot.Close()
				t.Fatal("uninitialized history returned a DB")
			}
			if (kind == "empty") != (err == nil) {
				t.Fatal(kind, err)
			}
		})
	}
}
