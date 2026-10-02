package pipackage

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/unix"
)

func createPackageTree(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	for _, dir := range []string{"extensions", "skills/demo", "data", "empty", "node_modules/runtime"} {
		if err := os.MkdirAll(filepath.Join(root, dir), 0755); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range map[string][]byte{
		"package.json":         []byte(" {\"name\":\"tools\",\"version\":\"1.0.0\",\"dependencies\":{\"runtime\":\"1.0.0\"}}\n"),
		"extensions/tool.js":   []byte("throw new Error('must never execute');\n"),
		"skills/demo/SKILL.md": []byte("# 中文说明\n"), "data/binary": {0, 255, 128, 1, 10, 0},
		"node_modules/runtime/index.js": []byte("export default 1;\n"),
	} {
		if err := os.WriteFile(filepath.Join(root, name), data, 0644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(filepath.Join(root, "extensions/tool.js"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("data/binary", filepath.Join(root, "link")); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestTreeArchiveRoundTripPreservesContentModeAndSharedDigest(t *testing.T) {
	ctx := context.Background()
	source := createPackageTree(t)
	tree, err := OpenTree(ctx, source)
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	if err := tree.ValidateDependencies(); err != nil {
		t.Fatal(err)
	}
	digest, err := tree.Digest()
	if err != nil {
		t.Fatal(err)
	}
	filename := filepath.Join(t.TempDir(), "artifact.zip")
	packed, err := PackArchive(ctx, tree, filename)
	if err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(filename)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.New()
	count, err := io.Copy(hash, file)
	file.Close()
	if err != nil || packed.Bytes != count || packed.Digest != hex.EncodeToString(hash.Sum(nil)) {
		t.Fatal("packed stream hash mismatch", err)
	}
	archive, err := OpenArchive(ctx, filename)
	if err != nil {
		t.Fatal(err)
	}
	archive.Close()
	output := filepath.Join(t.TempDir(), "result")
	if _, err := ExtractArchive(ctx, filename, output); err != nil {
		t.Fatal(err)
	}
	restored, err := OpenTree(ctx, output)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	after, err := restored.Digest()
	if err != nil || after != digest || !bytes.Equal(tree.ManifestBytes, restored.ManifestBytes) || tree.RestoredBytes != restored.RestoredBytes {
		t.Fatal("tree identity changed", err)
	}
	mode, err := os.Stat(filepath.Join(output, "extensions/tool.js"))
	if err != nil || mode.Mode().Perm() != 0755 {
		t.Fatal("execution bit lost")
	}
	link, err := os.Readlink(filepath.Join(output, "link"))
	if err != nil || link != "data/binary" {
		t.Fatal("link target changed")
	}
	if _, err := ExtractArchive(ctx, filename, output); !errors.Is(err, ErrUnsafe) {
		t.Fatal("existing output overwritten", err)
	}
}

type zipFixtureEntry struct {
	name  string
	mode  os.FileMode
	bytes []byte
}

func zipFixture(t *testing.T, entries []zipFixtureEntry) string {
	t.Helper()
	filename := filepath.Join(t.TempDir(), "input.zip")
	file, err := os.Create(filename)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(file)
	for _, entry := range entries {
		header := &zip.FileHeader{Name: entry.name, Method: zip.Store}
		header.SetMode(entry.mode)
		part, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := part.Write(entry.bytes); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return filename
}

func TestArchiveSingleRootAndUnsafeEntries(t *testing.T) {
	manifest := zipFixtureEntry{"package.json", 0644, []byte(`{"name":"tools"}`)}
	for _, test := range []struct {
		name    string
		entries []zipFixtureEntry
		success bool
	}{
		{"root", []zipFixtureEntry{manifest}, true},
		{"single-prefix", []zipFixtureEntry{{"tools/", os.ModeDir | 0755, nil}, {"tools/package.json", 0644, manifest.bytes}, {"tools/data", 0644, []byte("content")}}, true},
		{"duplicate", []zipFixtureEntry{manifest, manifest}, false},
		{"traversal", []zipFixtureEntry{manifest, {"../escape", 0644, []byte("x")}}, false},
		{"absolute", []zipFixtureEntry{manifest, {"/escape", 0644, []byte("x")}}, false},
		{"drive", []zipFixtureEntry{manifest, {"C:escape", 0644, []byte("x")}}, false},
		{"backslash", []zipFixtureEntry{manifest, {"a\\b", 0644, []byte("x")}}, false},
		{"below-file", []zipFixtureEntry{manifest, {"data", 0644, []byte("x")}, {"data/child", 0644, []byte("x")}}, false},
		{"below-link", []zipFixtureEntry{manifest, {"link", os.ModeSymlink | 0777, []byte("empty")}, {"link/child", 0644, []byte("x")}}, false},
		{"special-file", []zipFixtureEntry{manifest, {"fifo", os.ModeNamedPipe | 0600, nil}}, false},
		{"outside-prefix", []zipFixtureEntry{{"tools/package.json", 0644, manifest.bytes}, {"other", 0644, []byte("x")}}, false},
		{"escaped-link", []zipFixtureEntry{manifest, {"link", os.ModeSymlink | 0777, []byte("../escape")}}, false},
		{"broken-link", []zipFixtureEntry{manifest, {"link", os.ModeSymlink | 0777, []byte("missing")}}, false},
		{"cyclic-link", []zipFixtureEntry{manifest, {"one", os.ModeSymlink | 0777, []byte("two")}, {"two", os.ModeSymlink | 0777, []byte("one")}}, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			input := zipFixture(t, test.entries)
			output := filepath.Join(t.TempDir(), "result")
			_, err := ExtractArchive(context.Background(), input, output)
			if (err == nil) != test.success {
				t.Fatal("archive result", err)
			}
			if !test.success {
				if _, err := os.Lstat(output); !errors.Is(err, os.ErrNotExist) {
					t.Fatal("failed archive published output")
				}
			}
		})
	}
}

func TestArchiveCRCSizeEncryptionAndActualDirectoryCountLimits(t *testing.T) {
	for _, kind := range []string{"crc", "size", "encrypted", "count", "truncated"} {
		t.Run(kind, func(t *testing.T) {
			filename := zipFixture(t, []zipFixtureEntry{{"package.json", 0644, []byte(`{"name":"tools"}`)}})
			raw, err := os.ReadFile(filename)
			if err != nil {
				t.Fatal(err)
			}
			central := bytes.Index(raw, []byte{'P', 'K', 1, 2})
			end := bytes.LastIndex(raw, []byte{'P', 'K', 5, 6})
			switch kind {
			case "crc":
				binary.LittleEndian.PutUint32(raw[central+16:], 0)
			case "size":
				binary.LittleEndian.PutUint32(raw[central+24:], uint32(FileBytes+1))
			case "encrypted":
				binary.LittleEndian.PutUint16(raw[central+8:], 1)
			case "count":
				binary.LittleEndian.PutUint16(raw[end+10:], 2)
			case "truncated":
				raw = raw[:len(raw)-10]
			}
			if err := os.WriteFile(filename, raw, 0600); err != nil {
				t.Fatal(err)
			}
			output := filepath.Join(t.TempDir(), "result")
			if _, err := ExtractArchive(context.Background(), filename, output); err == nil {
				t.Fatal("malformed archive accepted")
			}
			if _, err := os.Lstat(output); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("malformed archive published output")
			}
		})
	}
	// Lie in the 16-bit count while providing more than the actual allowed
	// records. The native pre-scan must reject before zip.NewReader allocates.
	var raw bytes.Buffer
	var record [46]byte
	binary.LittleEndian.PutUint32(record[:], 0x02014b50)
	for range MaxEntries + 1 {
		raw.Write(record[:])
	}
	var footer [22]byte
	binary.LittleEndian.PutUint32(footer[:], 0x06054b50)
	binary.LittleEndian.PutUint16(footer[10:], uint16((MaxEntries+1)%65536))
	binary.LittleEndian.PutUint32(footer[12:], uint32(raw.Len()))
	raw.Write(footer[:])
	filename := filepath.Join(t.TempDir(), "excess.zip")
	if err := os.WriteFile(filename, raw.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenArchive(context.Background(), filename); !errors.Is(err, ErrLimit) {
		t.Fatal("actual record count cap bypassed", err)
	}
}

func TestTreeRefusesUnsafeDataAndRacedFileAndMeasuresSparseOutput(t *testing.T) {
	for _, kind := range []string{"escape", "broken", "cyclic", "special", "oversized", "unsafe-path", "missing-dependency"} {
		t.Run(kind, func(t *testing.T) {
			root := createPackageTree(t)
			switch kind {
			case "escape":
				os.Symlink("../../outside", filepath.Join(root, "escape"))
			case "broken":
				os.Symlink("missing", filepath.Join(root, "broken"))
			case "cyclic":
				os.Symlink("cyclic", filepath.Join(root, "cyclic"))
			case "special":
				os.Mkdir(filepath.Join(root, "special"), 0755)
				os.Remove(filepath.Join(root, "special"))
				unix.Mkfifo(filepath.Join(root, "special"), 0600)
			case "oversized":
				file, _ := os.Create(filepath.Join(root, "large"))
				file.Truncate(FileBytes + 1)
				file.Close()
			case "unsafe-path":
				os.WriteFile(filepath.Join(root, "a\\b"), []byte("x"), 0644)
			case "missing-dependency":
				os.RemoveAll(filepath.Join(root, "node_modules"))
			}
			tree, err := OpenTree(context.Background(), root)
			if err == nil {
				defer tree.Close()
				err = tree.ValidateDependencies()
			}
			if err == nil {
				t.Fatal("unsafe tree accepted")
			}
		})
	}
	root := createPackageTree(t)
	tree, err := OpenTree(context.Background(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	path := filepath.Join(root, "data", "binary")
	os.Remove(path)
	os.Symlink("../package.json", path)
	if _, err := tree.Digest(); !errors.Is(err, ErrUnsafe) {
		t.Fatal("raced leaf followed", err)
	}
	work := t.TempDir()
	file, err := os.Create(filepath.Join(work, "sparse"))
	if err != nil {
		t.Fatal(err)
	}
	file.Truncate(PreparationBytes + 1)
	file.Close()
	bytes, err := Measure(context.Background(), work)
	if err != nil || bytes <= PreparationBytes {
		t.Fatal("sparse measurement", bytes, err)
	}
}
