package internaltls

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestModelCredentialInspectionAndImmutablePublication(t *testing.T) {
	m, _, scope := fixtureManager(t)
	ctx := context.Background()
	state, err := m.CheckModelCredential(ctx, scope, []byte("synthetic-old"))
	if err != nil || state != ModelCredentialUnpublished {
		t.Fatalf("new generation: state=%v err=%v", state, err)
	}
	if _, err := os.Lstat(filepath.Join(m.directory, scope.WorkID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("inspection created the Work directory", err)
	}
	if _, err := m.EnsureGeneration(ctx, scope); err != nil {
		t.Fatal(err)
	}
	state, err = m.CheckModelCredential(ctx, scope, []byte("synthetic-old"))
	if err != nil || state != ModelCredentialUnpublished {
		t.Fatalf("unpublished: state=%v err=%v", state, err)
	}
	path, err := m.WriteModelCredential(ctx, scope, []byte("synthetic-old\r\n"))
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name       string
		credential []byte
		want       ModelCredentialState
	}{
		{"same", []byte("synthetic-old"), ModelCredentialSame},
		{"normalized", []byte("synthetic-old\r\n\n"), ModelCredentialSame},
		{"changed", []byte("synthetic-new"), ModelCredentialChanged},
	} {
		t.Run(tc.name, func(t *testing.T) {
			state, err := m.CheckModelCredential(ctx, scope, tc.credential)
			if err != nil || state != tc.want {
				t.Fatalf("state=%v err=%v", state, err)
			}
		})
	}
	if _, err := m.WriteModelCredential(ctx, scope, []byte("synthetic-new")); !errors.Is(err, ErrMaterial) {
		t.Fatal("generation credential was replaced", err)
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("inspection or rejected write altered material", err)
	}
	other := scope
	other.InstanceID = "agent-other"
	if _, err := m.CheckModelCredential(ctx, other, []byte("synthetic-old")); !errors.Is(err, ErrMaterial) {
		t.Fatal("foreign instance accepted", err)
	}
}

func TestModelCredentialInspectionRejectsUnsafeMaterial(t *testing.T) {
	for _, kind := range []string{"symlink", "hardlink", "mode", "empty", "nul", "oversize", "noncanonical"} {
		t.Run(kind, func(t *testing.T) {
			m, _, scope := fixtureManager(t)
			ctx := context.Background()
			if _, err := m.EnsureGeneration(ctx, scope); err != nil {
				t.Fatal(err)
			}
			path, err := m.WriteModelCredential(ctx, scope, []byte("synthetic-old"))
			if err != nil {
				t.Fatal(err)
			}
			switch kind {
			case "symlink", "hardlink":
				other := filepath.Join(t.TempDir(), "source")
				if err := os.WriteFile(other, []byte("synthetic-old\n"), 0644); err != nil {
					t.Fatal(err)
				}
				if err := os.Remove(path); err != nil {
					t.Fatal(err)
				}
				if kind == "symlink" {
					err = os.Symlink(other, path)
				} else {
					err = os.Link(other, path)
				}
			case "mode":
				err = os.Chmod(path, 0600)
			case "empty":
				err = os.WriteFile(path, nil, 0644)
			case "nul":
				err = os.WriteFile(path, []byte("synthetic\x00old\n"), 0644)
			case "oversize":
				err = os.WriteFile(path, []byte(strings.Repeat("x", 65538)), 0644)
			case "noncanonical":
				err = os.WriteFile(path, []byte("synthetic-old\r\n"), 0644)
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := m.CheckModelCredential(ctx, scope, []byte("synthetic-new")); !errors.Is(err, ErrMaterial) {
				t.Fatal("unsafe material treated as credential change", err)
			}
		})
	}
}

func TestModelCredentialInspectionRejectsInvalidInput(t *testing.T) {
	m, _, scope := fixtureManager(t)
	for _, input := range [][]byte{nil, []byte("\r\n"), []byte("bad\x00key"), bytes.Repeat([]byte{'x'}, 65537)} {
		if _, err := m.CheckModelCredential(context.Background(), scope, input); !errors.Is(err, ErrMaterial) {
			t.Fatal("invalid input accepted", err)
		}
		if _, err := m.WriteModelCredential(context.Background(), scope, input); !errors.Is(err, ErrMaterial) {
			t.Fatal("invalid input published", err)
		}
	}
}
