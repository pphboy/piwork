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

func TestSnapshotXattrsOnlyPermitHostSELinuxLabel(t *testing.T) {
	for _, test := range []struct {
		name string
		list string
		want error
	}{
		{"none", "", nil},
		{"host-label", "security.selinux\x00", nil},
		{"user-data", "user.snapshot-test\x00", ErrUnsupported},
		{"label-and-user-data", "security.selinux\x00user.snapshot-test\x00", ErrUnsupported},
		{"acl", "system.posix_acl_access\x00security.selinux\x00", ErrUnsupported},
		{"default-acl", "system.posix_acl_default\x00", ErrUnsupported},
		{"capability", "security.capability\x00", ErrUnsupported},
		{"other-security", "security.ima\x00", ErrUnsupported},
		{"similar-name", "security.selinux.extra\x00", ErrUnsupported},
		{"empty-name", "\x00", ErrUnsupported},
		{"label-and-empty-name", "security.selinux\x00\x00", ErrUnsupported},
		{"unterminated", "security.selinux", ErrUnsupported},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := noPortableAttrs(func(raw []byte) (int, error) {
				if raw != nil {
					copy(raw, test.list)
				}
				return len(test.list), nil
			})
			if !errors.Is(err, test.want) {
				t.Fatalf("xattr policy returned %v, want %v", err, test.want)
			}
		})
	}
	for _, queryError := range []bool{true, false} {
		err := noPortableAttrs(func(raw []byte) (int, error) {
			if queryError || raw != nil {
				return 0, unix.ERANGE
			}
			return len("security.selinux\x00"), nil
		})
		if !errors.Is(err, ErrUnreadable) {
			t.Fatal("failed xattr enumeration was accepted", err)
		}
	}
}

func TestSnapshotXattrEnumerationFailsClosed(t *testing.T) {
	for _, test := range []struct {
		name                  string
		querySize, readSize   int
		queryError, readError error
	}{
		{name: "query-permission", queryError: unix.EACCES},
		{name: "negative-query-size", querySize: -1},
		{name: "oversized-query", querySize: (64 << 10) + 1},
		{name: "read-permission", querySize: 17, readError: unix.EACCES},
		{name: "list-grew", querySize: 17, readError: unix.ERANGE},
		{name: "negative-read-size", querySize: 17, readSize: -1},
		{name: "read-beyond-buffer", querySize: 17, readSize: 18},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := noPortableAttrs(func(raw []byte) (int, error) {
				if raw == nil {
					return test.querySize, test.queryError
				}
				return test.readSize, test.readError
			})
			if !errors.Is(err, ErrUnreadable) {
				t.Fatalf("unreadable attribute list accepted: %v", err)
			}
		})
	}
}

func TestCaptureRejectsUserAttributesWithoutChangingSource(t *testing.T) {
	for _, location := range []string{"root", "directory", "file"} {
		t.Run(location, func(t *testing.T) {
			source, _, blobs := fixture(t)
			directory := filepath.Join(source, "directory")
			file := filepath.Join(directory, "keep")
			if err := os.Mkdir(directory, 0750); err != nil {
				t.Fatal(err)
			}
			content := []byte("original bytes")
			if err := os.WriteFile(file, content, 0640); err != nil {
				t.Fatal(err)
			}
			path := map[string]string{"root": source, "directory": directory, "file": file}[location]
			if err := unix.Setxattr(path, "user.snapshot-test", []byte("keep"), 0); err != nil {
				t.Fatal(err)
			}
			before := snapshotStat(t, path)
			if _, err := Capture(context.Background(), source, blobs); !errors.Is(err, ErrUnsupported) {
				t.Fatalf("user attribute accepted: %v", err)
			}
			if after := snapshotStat(t, path); before != after {
				t.Fatal("source metadata changed", before, after)
			}
			if got, err := os.ReadFile(file); err != nil || !bytes.Equal(got, content) {
				t.Fatal("source bytes changed", err)
			}
			raw := make([]byte, 4)
			if n, err := unix.Getxattr(path, "user.snapshot-test", raw); err != nil || n != 4 || string(raw) != "keep" {
				t.Fatal("source attribute changed", n, err)
			}
		})
	}
}

// atime and ctime are not part of the portable metadata contract.
func snapshotStat(t *testing.T, path string) [5]int64 {
	t.Helper()
	var info unix.Stat_t
	if err := unix.Lstat(path, &info); err != nil {
		t.Fatal(err)
	}
	return [5]int64{int64(info.Uid), int64(info.Gid), int64(info.Mode), info.Mtim.Sec, info.Mtim.Nsec}
}

func TestCaptureOwnedPreservesTypeAndAttributeBoundaries(t *testing.T) {
	for _, packageTree := range []bool{false, true} {
		name := "skill"
		if packageTree {
			name = "package"
		}
		t.Run(name, func(t *testing.T) {
			source, target, blobs := fixture(t)
			file := filepath.Join(source, "entry")
			if err := os.WriteFile(file, []byte("owned content"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := os.Link(file, filepath.Join(source, "alias")); err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			captured, err := CaptureOwned(ctx, source, blobs, packageTree)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := blobs.ReadMetadata(ctx, captured.Tree)
			if err != nil {
				t.Fatal(err)
			}
			var tree workpackage.Tree
			if err := json.Unmarshal(raw, &tree); err != nil {
				t.Fatal(err)
			}
			for _, entry := range tree.Entries[1:] {
				if entry.Type != "file" {
					t.Fatal("owned hardlink was not expanded", entry.Type)
				}
			}
			if _, err := Restore(ctx, target, blobs, captured.Tree, true); err != nil {
				t.Fatal(err)
			}
			if got, err := os.ReadFile(filepath.Join(target, "alias")); err != nil || string(got) != "owned content" {
				t.Fatal("owned content changed", err)
			}
			if err := unix.Setxattr(file, "user.snapshot-test", []byte("keep"), 0); err != nil {
				t.Fatal(err)
			}
			if _, err := CaptureOwned(ctx, source, blobs, packageTree); !errors.Is(err, ErrUnsupported) {
				t.Fatal("owned tree user attribute accepted", err)
			}
			if err := unix.Removexattr(file, "user.snapshot-test"); err != nil {
				t.Fatal(err)
			}
			// An external target with unsupported attributes must never be read.
			outside := filepath.Join(filepath.Dir(source), "outside")
			if err := os.WriteFile(outside, []byte("outside content"), 0644); err != nil {
				t.Fatal(err)
			}
			if err := unix.Setxattr(outside, "user.snapshot-test", []byte("keep"), 0); err != nil {
				t.Fatal(err)
			}
			if err := os.Symlink(outside, filepath.Join(source, "external-link")); err != nil {
				t.Fatal(err)
			}
			_, err = CaptureOwned(ctx, source, blobs, packageTree)
			if packageTree && err != nil || !packageTree && !errors.Is(err, ErrUnsupported) {
				t.Fatal("owned link policy changed", err)
			}
		})
	}
}

func TestRestoreRejectsTargetUserXattrs(t *testing.T) {
	source, target, blobs := fixture(t)
	ctx := context.Background()
	captured, err := Capture(ctx, source, blobs)
	if err != nil {
		t.Fatal(err)
	}
	if err := unix.Setxattr(target, "user.snapshot-test", []byte("keep"), 0); err != nil {
		t.Fatal(err)
	}
	before := snapshotStat(t, target)
	if _, err := Restore(ctx, target, blobs, captured.Tree, false); !errors.Is(err, ErrUnsupported) {
		t.Fatal("target user metadata was discarded", err)
	}
	if after := snapshotStat(t, target); before != after {
		t.Fatal("target metadata changed on rejection", before, after)
	}
	raw := make([]byte, 4)
	if n, err := unix.Getxattr(target, "user.snapshot-test", raw); err != nil || n != 4 || string(raw) != "keep" {
		t.Fatal("target xattr changed", n, err)
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
	before := snapshotStat(t, target)
	if _, err := Restore(ctx, target, blobs, captured.Tree, false); err == nil {
		t.Fatal("non-empty volume overwritten")
	}
	if after := snapshotStat(t, target); before != after {
		t.Fatal("non-empty target metadata changed", before, after)
	}
	left, _ := os.ReadFile(filepath.Join(source, "package.json"))
	right, _ := os.ReadFile(filepath.Join(target, "package.json"))
	if !reflect.DeepEqual(left, right) {
		t.Fatal("existing target changed")
	}
}
