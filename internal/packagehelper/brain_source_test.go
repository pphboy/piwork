package packagehelper

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/pipackage"
)

func brainSourceFixture(t *testing.T) (Helper, string, string) {
	t.Helper()
	workspace := t.TempDir()
	source := filepath.Join(workspace, BrainSourcePath)
	if err := os.MkdirAll(filepath.Join(source, "extensions"), 0700); err != nil {
		t.Fatal(err)
	}
	for name, text := range map[string]string{"package.json": `{"name":"piwork-brain","version":"1.0.0","type":"module","pi":{"extensions":["extensions/brain.js"]}}`, "extensions/brain.js": "export default function(pi) {}", "brain.md": "First immutable cognition"} {
		if err := os.WriteFile(filepath.Join(source, name), []byte(text), 0600); err != nil {
			t.Fatal(err)
		}
	}
	tree, err := pipackage.OpenTree(context.Background(), source)
	if err != nil {
		t.Fatal(err)
	}
	digest, err := tree.Digest()
	tree.Close()
	if err != nil {
		t.Fatal(err)
	}
	spool := t.TempDir()
	raw, _ := json.Marshal(map[string]any{"contractVersion": 1, "expectedSourceDigest": digest})
	if err = os.WriteFile(filepath.Join(spool, "capture-request.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return Helper{Paths: Paths{SpoolRoot: spool, BrainSourceRoot: workspace}}, source, digest
}
func TestBrainSourceCaptureIsFixedAndImmutableAfterSourceEdit(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	h, source, digest := brainSourceFixture(t)
	result, err := h.captureBrainSource(context.Background())
	if err != nil || result.SourceDigest != digest || result.ZipBytes <= 0 {
		t.Fatal(result, err)
	}
	if err = os.WriteFile(filepath.Join(source, "brain.md"), []byte("Later mutable cognition"), 0600); err != nil {
		t.Fatal(err)
	}
	archive, err := pipackage.OpenArchive(context.Background(), filepath.Join(h.Paths.SpoolRoot, "input.zip"))
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	actual, err := archive.Digest()
	if err != nil || actual != digest {
		t.Fatal("later source changed accepted capture", err)
	}
	if _, err = h.captureBrainSource(context.Background()); err == nil {
		t.Fatal("captured source was overwritten")
	}
}
func TestBrainSourceCaptureRejectsSourceConflictAndUnsafePaths(t *testing.T) {
	for _, damage := range []string{"changed", "root-link", "parent-link", "escaping-link", "manifest", "path-input", "oversized-request"} {
		t.Run(damage, func(t *testing.T) {
			h, source, _ := brainSourceFixture(t)
			switch damage {
			case "changed":
				os.WriteFile(filepath.Join(source, "brain.md"), []byte("before capture edit"), 0600)
			case "root-link":
				os.Rename(source, source+"-other")
				os.Symlink(source+"-other", source)
			case "parent-link":
				parent := filepath.Join(h.Paths.BrainSourceRoot, ".pi")
				os.Rename(parent, parent+"-other")
				os.Symlink(parent+"-other", parent)
			case "escaping-link":
				os.Symlink("../../../../host", filepath.Join(source, "secret"))
			case "manifest":
				os.WriteFile(filepath.Join(source, "package.json"), []byte(`{"name":"other-brain","pi":{}}`), 0600)
			case "path-input":
				os.WriteFile(filepath.Join(h.Paths.SpoolRoot, "capture-request.json"), []byte(`{"contractVersion":1,"expectedSourceDigest":"sha256:`+strings.Repeat("a", 64)+`","path":"/etc"}`), 0600)
			case "oversized-request":
				os.WriteFile(filepath.Join(h.Paths.SpoolRoot, "capture-request.json"), []byte(strings.Repeat("a", 4097)), 0600)
			}
			_, err := h.captureBrainSource(context.Background())
			if err == nil {
				t.Fatal("unsafe capture admitted")
			}
			if damage == "changed" && !errors.Is(err, ErrBrainSourceConflict) {
				t.Fatal(err)
			}
			if _, err := os.Stat(filepath.Join(h.Paths.SpoolRoot, "input.zip")); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("failed capture published output")
			}
		})
	}
}
