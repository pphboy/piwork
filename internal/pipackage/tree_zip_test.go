package pipackage

import (
	"archive/zip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
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
	addPackageBaselineLink(t, root)
	return root
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

func TestTreeRefusesUnsafeDataAndRacedFileAndMeasuresSparseOutput(t *testing.T) {
	for _, kind := range []string{"escape", "broken", "cyclic", "special", "oversized", "unsafe-path", "missing-dependency"} {
		t.Run(kind, func(t *testing.T) {
			root := createPackageTree(t)
			switch kind {
			case "escape":
				makePackageSymlink(t, "../../outside", filepath.Join(root, "escape"))
			case "broken":
				makePackageSymlink(t, "missing", filepath.Join(root, "broken"))
			case "cyclic":
				makePackageSymlink(t, "cyclic", filepath.Join(root, "cyclic"))
			case "special":
				os.Mkdir(filepath.Join(root, "special"), 0755)
				os.Remove(filepath.Join(root, "special"))
				makePackageFIFO(t, filepath.Join(root, "special"))
			case "oversized":
				file, _ := os.Create(filepath.Join(root, "large"))
				file.Truncate(FileBytes + 1)
				file.Close()
			case "unsafe-path":
				makeUnsafePackagePath(t, root)
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
	makePackageSymlink(t, "../package.json", path)
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

func makePackageSymlink(t *testing.T, target, link string) {
	t.Helper()
	if err := os.Symlink(target, link); err != nil {
		t.Fatalf("required native symlink fixture unavailable: %v", err)
	}
}
