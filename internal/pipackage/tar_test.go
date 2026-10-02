package pipackage

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type tarEntry struct {
	name, target string
	kind         byte
	mode         int64
	raw          []byte
}

func npmTar(t *testing.T, entries []tarEntry) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "source.tgz")
	var buffer bytes.Buffer
	gz := gzip.NewWriter(&buffer)
	writer := tar.NewWriter(gz)
	for _, item := range entries {
		header := &tar.Header{Name: item.name, Linkname: item.target, Typeflag: item.kind, Mode: item.mode, Size: int64(len(item.raw))}
		if err := writer.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(item.raw); err != nil {
			t.Fatal(err)
		}
	}
	if writer.Close() != nil || gz.Close() != nil {
		t.Fatal("fixture compression failed")
	}
	if err := os.WriteFile(file, buffer.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return file
}
func TestNativeNPMTarPreservesModesLinksAndManifest(t *testing.T) {
	original := []byte(" {\"name\":\"tools\",\"version\":\"1.0.0\"}\n")
	archive := npmTar(t, []tarEntry{{name: "package/package.json", kind: tar.TypeReg, mode: 0644, raw: original}, {name: "package/hard", target: "package/script.js", kind: tar.TypeLink}, {name: "package/link", target: "script.js", kind: tar.TypeSymlink}, {name: "package/script.js", kind: tar.TypeReg, mode: 0755, raw: []byte("must never execute")}, {name: "package/empty/", kind: tar.TypeDir, mode: 0700}})
	output := filepath.Join(t.TempDir(), "result")
	manifest, err := ExtractNPMArchive(context.Background(), archive, output)
	if err != nil || manifest.Name != "tools" {
		t.Fatal(err, manifest)
	}
	tree, err := OpenTree(context.Background(), output)
	if err != nil {
		t.Fatal(err)
	}
	defer tree.Close()
	if !bytes.Equal(tree.ManifestBytes, original) {
		t.Fatal("manifest bytes changed")
	}
	for _, name := range []string{"script.js", "hard"} {
		info, err := os.Stat(filepath.Join(output, name))
		if err != nil || info.Mode().Perm() != 0755 {
			t.Fatal("execute mode lost", name, err)
		}
	}
	target, err := os.Readlink(filepath.Join(output, "link"))
	if err != nil || target != "script.js" {
		t.Fatal(err, target)
	}
	if _, err := ExtractNPMArchive(context.Background(), archive, output); !errors.Is(err, ErrUnsafe) {
		t.Fatal("overwrite accepted", err)
	}
}
func TestNativeNPMTarRejectsUnsafeTreesAndCorruption(t *testing.T) {
	manifest := tarEntry{name: "package/package.json", kind: tar.TypeReg, mode: 0644, raw: []byte(`{"name":"tools"}`)}
	cases := map[string][]tarEntry{
		"traversal":        {{name: "package/../../outside", kind: tar.TypeReg, raw: []byte("private")}},
		"multiple roots":   {{name: "other/file", kind: tar.TypeReg}},
		"absolute":         {{name: "/package/file", kind: tar.TypeReg}},
		"duplicate":        {manifest},
		"special":          {{name: "package/fifo", kind: tar.TypeFifo}},
		"escaping symlink": {{name: "package/link", target: "../outside", kind: tar.TypeSymlink}},
		"broken symlink":   {{name: "package/link", target: "missing", kind: tar.TypeSymlink}},
		"cyclic symlink":   {{name: "package/a", target: "b", kind: tar.TypeSymlink}, {name: "package/b", target: "a", kind: tar.TypeSymlink}},
		"hardlink escape":  {{name: "package/a", target: "../outside", kind: tar.TypeLink}},
		"hardlink cycle":   {{name: "package/a", target: "package/b", kind: tar.TypeLink}, {name: "package/b", target: "package/a", kind: tar.TypeLink}},
		"link parent":      {{name: "package/link", target: ".", kind: tar.TypeSymlink}, {name: "package/link/file", kind: tar.TypeReg}},
	}
	for name, entries := range cases {
		t.Run(name, func(t *testing.T) {
			archive := npmTar(t, append([]tarEntry{manifest}, entries...))
			output := filepath.Join(t.TempDir(), "result")
			if _, err := ExtractNPMArchive(context.Background(), archive, output); err == nil {
				t.Fatal("unsafe tar accepted")
			}
			if _, err := os.Lstat(output); !errors.Is(err, os.ErrNotExist) {
				t.Fatal("failed extraction published output")
			}
		})
	}
	archive := npmTar(t, []tarEntry{manifest})
	raw, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	raw[len(raw)-8] ^= 1
	if err := os.WriteFile(archive, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ExtractNPMArchive(context.Background(), archive, filepath.Join(t.TempDir(), "result")); !errors.Is(err, ErrUnsafe) {
		t.Fatal("gzip checksum not checked", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := ExtractNPMArchive(ctx, archive, filepath.Join(t.TempDir(), "result")); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation lost", err)
	}
}
