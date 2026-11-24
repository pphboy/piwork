//go:build linux

package skillartifact

import (
	"bytes"
	"errors"
	"strings"
	"testing"
)

func contentSnapshot(t *testing.T, files []File) Snapshot {
	t.Helper()
	snapshot, err := FromFiles("content-skill", files)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestReplaceFilePreservesOtherFilesAndDirectories(t *testing.T) {
	snapshot := contentSnapshot(t, []File{
		{Path: "SKILL.md", Data: []byte("# Skill")},
		{Path: "references/rules.md", Data: []byte("old rules")},
		{Path: "references/other.md", Data: []byte("other bytes")},
	})
	before, _ := ReadFile(snapshot, "references/other.md")
	replaced, err := ReplaceFile(snapshot, "references/rules.md", []byte("new rules\n"))
	if err != nil {
		t.Fatal(err)
	}
	if replaced.Identity == snapshot.Identity || replaced.TotalBytes != snapshot.TotalBytes-int64(len("old rules"))+int64(len("new rules\n")) {
		t.Fatal("replacement did not produce a new complete identity", replaced)
	}
	if data, ok := ReadFile(replaced, "references/rules.md"); !ok || string(data) != "new rules\n" {
		t.Fatal("target file was not replaced", string(data), ok)
	}
	if data, _ := ReadFile(replaced, "references/other.md"); !bytes.Equal(data, before) {
		t.Fatal("unrelated file bytes changed")
	}
	if data, _ := ReadFile(replaced, "SKILL.md"); string(data) != "# Skill" {
		t.Fatal("manifest changed")
	}
	if strings.Join(replaced.Directories, ",") != "references" || len(replaced.Files) != 3 {
		t.Fatal("directories or file count changed", replaced.Directories)
	}
	if FileVersion([]byte("new rules\n")) == FileVersion([]byte("old rules")) {
		t.Fatal("file version did not change with content")
	}
}

func TestReplaceFileRejectsMissingOrInvalidTargets(t *testing.T) {
	snapshot := contentSnapshot(t, []File{{Path: "SKILL.md", Data: []byte("# Skill")}, {Path: "notes.txt", Data: []byte("text")}})
	if _, err := ReplaceFile(snapshot, "missing.txt", []byte("x")); !errors.Is(err, ErrFileNotFound) {
		t.Fatal("missing target was not reported", err)
	}
	for _, path := range []string{"", "/SKILL.md", "a/../SKILL.md", "a//b.txt", `a\b.txt`, "a/\x00", strings.Repeat("a/", 65) + "file", strings.Repeat("a", 4097)} {
		if _, err := ReplaceFile(snapshot, path, []byte("x")); !errors.Is(err, ErrUnsafeTree) {
			t.Fatalf("invalid path %q was accepted: %v", path, err)
		}
	}
	for _, data := range [][]byte{{0xff, 0xfe}, []byte("nul\x00byte")} {
		if _, err := ReplaceFile(snapshot, "notes.txt", data); !errors.Is(err, ErrFileNotText) {
			t.Fatalf("non-text content was accepted: %v", err)
		}
	}
}

func TestReplaceFileEnforcesFileAndTreeLimits(t *testing.T) {
	manifest := []byte("# Skill")
	snapshot := contentSnapshot(t, []File{{Path: "SKILL.md", Data: manifest}, {Path: "notes.txt", Data: []byte("text")}})
	exact := bytes.Repeat([]byte("a"), maxFileBytes)
	if _, err := ReplaceFile(snapshot, "notes.txt", exact); err != nil {
		t.Fatal("exact file limit was rejected", err)
	}
	if _, err := ReplaceFile(snapshot, "notes.txt", append(exact, 'a')); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("file over limit was accepted", err)
	}
	large := bytes.Repeat([]byte("a"), maxFileBytes)
	tree := contentSnapshot(t, []File{
		{Path: "SKILL.md", Data: manifest},
		{Path: "notes.txt", Data: []byte("text")},
		{Path: "one.bin", Data: large},
		{Path: "two.bin", Data: large},
		{Path: "three.bin", Data: large},
	})
	remaining := maxTotalBytes - 3*int64(maxFileBytes) - int64(len(manifest))
	if _, err := ReplaceFile(tree, "notes.txt", bytes.Repeat([]byte("b"), int(remaining))); err != nil {
		t.Fatal("exact tree limit was rejected", err)
	}
	if _, err := ReplaceFile(tree, "notes.txt", bytes.Repeat([]byte("b"), int(remaining)+1)); !errors.Is(err, ErrUnsafeTree) {
		t.Fatal("tree over limit was accepted", err)
	}
}
