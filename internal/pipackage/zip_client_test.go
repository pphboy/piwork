package pipackage

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
)

func TestClientArchivePackingPreservesBytesAndZIPExecutionMetadata(t *testing.T) {
	tree, err := OpenTree(t.Context(), createPackageTree(t))
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	output := filepath.Join(t.TempDir(), "中文 空格.zip")
	packed, err := PackArchive(t.Context(), tree, output)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	if packed.Bytes != int64(len(raw)) || packed.Digest != hex.EncodeToString(hash[:]) {
		t.Fatal("archive identity differs from stream")
	}
	archive, err := OpenArchive(t.Context(), output)
	if err != nil {
		t.Fatal(err)
	}
	archive.Close()
	// ZIP attributes are the Core protocol, independent of host filesystem modes.
	fixture := zipFixture(t, []zipFixtureEntry{{"package.json", 0644, []byte(`{"name":"tools"}`)}, {"run.js", 0755, []byte("never execute")}})
	archive, err = OpenArchive(t.Context(), fixture)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	found := false
	for _, entry := range archive.Entries {
		if entry.Path == "run.js" {
			found = true
			if entry.Mode&0777 != 0755 {
				t.Fatal("ZIP execution metadata lost")
			}
		}
	}
	if !found {
		t.Fatal("ZIP entry missing")
	}
	reader, err := zip.OpenReader(output)
	if err != nil {
		t.Fatal(err)
	}
	reader.Close()
}

func TestClientTreeModificationCannotPublishArchive(t *testing.T) {
	root := createPackageTree(t)
	tree, err := OpenTree(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	if err := os.WriteFile(filepath.Join(root, "data", "binary"), []byte("modified"), 0644); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "must-not-publish.zip")
	if _, err := PackArchive(t.Context(), tree, output); err == nil {
		t.Fatal("changed tree packed")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("failed packing published output", err)
	}
}
