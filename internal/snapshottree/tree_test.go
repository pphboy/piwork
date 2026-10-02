package snapshottree

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

func fixture(t *testing.T) (string, string, *workpackage.BlobDirectory) {
	t.Helper()
	root := t.TempDir()
	source, target, spool := filepath.Join(root, "source"), filepath.Join(root, "target"), filepath.Join(root, "spool")
	for _, name := range []string{source, target, spool} {
		if err := os.Mkdir(name, 0700); err != nil {
			t.Fatal(err)
		}
	}
	blobs, err := workpackage.OpenBlobDirectory(spool)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { blobs.Close() })
	return source, target, blobs
}
func TestCaptureRestorePreservesOpaqueTreeMetadataAndHardLinks(t *testing.T) {
	source, target, blobs := fixture(t)
	ctx := context.Background()
	for _, name := range []string{"empty-directory", "node_modules", "node_modules/example"} {
		if err := os.Mkdir(filepath.Join(source, name), 0750); err != nil {
			t.Fatal(err)
		}
	}
	for name, data := range map[string][]byte{".env": []byte("private=value\n"), "empty": {}, "executable": []byte("#!/usr/bin/env never-execute\n"), "node_modules/example/index.js": []byte("throw Error('never execute');"), "opaque-\xff": {0, 255, 1, 0}} {
		if err := os.WriteFile(filepath.Join(source, name), data, 0640); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chmod(filepath.Join(source, "executable"), 0751); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(filepath.Join(source, ".env"), filepath.Join(source, "hardlink")); err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{"absolute-link": "/outside/secret", "broken-link": "missing", "relative-link": "node_modules/example/index.js", "opaque-link": "opaque-\xff"} {
		if err := os.Symlink(link, filepath.Join(source, name)); err != nil {
			t.Fatal(err)
		}
	}
	stamp := unix.Timespec{Sec: 1727049600, Nsec: 123456789}
	if err := unix.UtimesNanoAt(unix.AT_FDCWD, filepath.Join(source, ".env"), []unix.Timespec{stamp, stamp}, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		t.Fatal(err)
	}
	captured, err := Capture(ctx, source, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Restore(ctx, target, blobs, captured.Tree, false); err != nil {
		t.Fatal(err)
	}
	recaptured, err := Capture(ctx, target, blobs)
	if err != nil {
		t.Fatal(err)
	}
	left, _ := blobs.ReadMetadata(ctx, captured.Tree)
	right, _ := blobs.ReadMetadata(ctx, recaptured.Tree)
	if captured.Tree != recaptured.Tree || !bytes.Equal(left, right) {
		t.Fatal("metadata round trip changed", string(left), string(right))
	}
	var a, b unix.Stat_t
	if unix.Stat(filepath.Join(target, ".env"), &a) != nil || unix.Stat(filepath.Join(target, "hardlink"), &b) != nil || a.Ino != b.Ino {
		t.Fatal("hardlink lost")
	}
	for _, name := range []string{"absolute-link", "broken-link", "relative-link", "opaque-link"} {
		left, _ := os.Readlink(filepath.Join(source, name))
		right, _ := os.Readlink(filepath.Join(target, name))
		if left != right {
			t.Fatal(name, left, right)
		}
	}
}
func TestMalformedTreeAndCorruptBlobDoNotCreateTargetEntries(t *testing.T) {
	source, target, blobs := fixture(t)
	ctx := context.Background()
	if err := os.WriteFile(filepath.Join(source, "data"), []byte("original"), 0600); err != nil {
		t.Fatal(err)
	}
	captured, err := Capture(ctx, source, blobs)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := blobs.ReadMetadata(ctx, captured.Tree)
	if err != nil {
		t.Fatal(err)
	}
	var tree workpackage.Tree
	if json.Unmarshal(raw, &tree) != nil {
		t.Fatal("tree")
	}
	tree.Entries[1].SegmentsBase64 = []string{base64.StdEncoding.EncodeToString([]byte("..")), base64.StdEncoding.EncodeToString([]byte("escape"))}
	encoded, err := contracts.EncodeCanonicalJSON(tree)
	if err != nil {
		t.Fatal(err)
	}
	bad, err := blobs.Put(ctx, bytes.NewReader(encoded), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Restore(ctx, target, blobs, bad.Digest, false); err == nil {
		t.Fatal("traversal accepted")
	}
	if entries, _ := os.ReadDir(target); len(entries) != 0 {
		t.Fatal("target changed before validation")
	}
	var original workpackage.Tree
	json.Unmarshal(raw, &original)
	fd, err := unix.Openat(blobs.FD(), string(original.Entries[1].Blob), unix.O_WRONLY|unix.O_TRUNC|unix.O_NOFOLLOW, 0)
	if err != nil {
		t.Fatal(err)
	}
	unix.Write(fd, []byte("corrupt!"))
	unix.Close(fd)
	if _, err := Restore(ctx, target, blobs, captured.Tree, false); err == nil {
		t.Fatal("bad file hash accepted")
	}
	if entries, _ := os.ReadDir(target); len(entries) != 0 {
		t.Fatal("corrupt file created target")
	}
}
func TestCaptureRejectsXattrsAndSpecialFiles(t *testing.T) {
	for _, kind := range []string{"fifo", "xattr"} {
		t.Run(kind, func(t *testing.T) {
			source, _, blobs := fixture(t)
			name := filepath.Join(source, "unsupported")
			if kind == "fifo" {
				if err := unix.Mkfifo(name, 0600); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := os.WriteFile(name, []byte("x"), 0600); err != nil {
					t.Fatal(err)
				}
				if err := unix.Setxattr(name, "user.snapshot-test", []byte("value"), 0); err != nil {
					t.Fatal(err)
				}
			}
			_, err := Capture(context.Background(), source, blobs)
			if !errors.Is(err, ErrUnsupported) {
				t.Fatal(err)
			}
		})
	}
}
func TestOwnedContextAndNonEmptyTarget(t *testing.T) {
	source, target, blobs := fixture(t)
	ctx := context.Background()
	os.WriteFile(filepath.Join(source, "package.json"), []byte("{}"), 0600)
	captured, err := Capture(ctx, source, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := Restore(ctx, target, blobs, captured.Tree, true); err != nil {
		t.Fatal(err)
	}
	if _, err := Restore(ctx, target, blobs, captured.Tree, false); err == nil {
		t.Fatal("non-empty volume overwritten")
	}
	left, _ := os.ReadFile(filepath.Join(source, "package.json"))
	right, _ := os.ReadFile(filepath.Join(target, "package.json"))
	if !reflect.DeepEqual(left, right) {
		t.Fatal("existing target changed")
	}
}
