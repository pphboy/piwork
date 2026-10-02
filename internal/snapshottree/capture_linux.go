//go:build linux

// Package snapshottree copies frozen volume trees through no-follow dirfds.
// User files, absolute symlinks and SDK content are data, never executed.
package snapshottree

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"os"
	"sort"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

type Error struct{ Code string }

func (e *Error) Error() string { return e.Code }

var ErrUnreadable = &Error{"SNAPSHOT_STORAGE_UNREADABLE"}
var ErrUnsupported = &Error{"SNAPSHOT_STORAGE_UNSUPPORTED"}

func limit() error {
	return &workpackage.ValidationError{Code: "PACKAGE_LIMIT_EXCEEDED", Field: "tree"}
}

type Result struct {
	Tree         string `json:"tree"`
	Size         int64  `json:"size,omitempty"`
	Entries      int64  `json:"entries"`
	LogicalBytes int64  `json:"logicalBytes"`
}
type inode struct{ dev, ino uint64 }
type capturedInode struct {
	entry workpackage.TreeEntry
	info  unix.Stat_t
}

func same(a, b unix.Stat_t) bool {
	return a.Dev == b.Dev && a.Ino == b.Ino && a.Mode == b.Mode && a.Uid == b.Uid && a.Gid == b.Gid && a.Size == b.Size && a.Nlink == b.Nlink && a.Mtim == b.Mtim && a.Ctim == b.Ctim
}
func nanoseconds(value unix.Timespec) string {
	n := big.NewInt(value.Sec)
	n.Mul(n, big.NewInt(1000000000))
	n.Add(n, big.NewInt(value.Nsec))
	return n.String()
}
func metadata(info unix.Stat_t, parts []string, kind string) workpackage.TreeEntry {
	encoded := make([]string, len(parts))
	for i, name := range parts {
		encoded[i] = base64.StdEncoding.EncodeToString([]byte(name))
	}
	return workpackage.TreeEntry{SegmentsBase64: encoded, UID: int64(info.Uid), GID: int64(info.Gid), Mode: int64(info.Mode & 07777), MtimeNS: nanoseconds(info.Mtim), Type: kind}
}
func noAttrs(fd int) error {
	n, err := unix.Flistxattr(fd, nil)
	if err != nil {
		return ErrUnreadable
	}
	if n != 0 {
		return ErrUnsupported
	}
	return nil
}
func noLinkAttrs(fd int, name string) error {
	n, err := unix.Llistxattr(fmt.Sprintf("/proc/self/fd/%d/%s", fd, name), nil)
	if err != nil {
		return ErrUnreadable
	}
	if n != 0 {
		return ErrUnsupported
	}
	return nil
}
func names(ctx context.Context, fd int) ([]string, error) {
	duplicate, err := unix.Openat(fd, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnreadable
	}
	dir := os.NewFile(uintptr(duplicate), "directory")
	defer dir.Close()
	var result []string
	for {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		items, err := dir.ReadDir(256)
		if err != nil && err != io.EOF {
			return nil, ErrUnreadable
		}
		for _, item := range items {
			result = append(result, item.Name())
			if int64(len(result)) > workpackage.DefaultLimits.Entries {
				return nil, limit()
			}
		}
		if err == io.EOF {
			break
		}
	}
	sort.Strings(result)
	return result, nil
}
func Capture(ctx context.Context, rootPath string, blobs *workpackage.BlobDirectory) (Result, error) {
	return capture(ctx, rootPath, blobs, false, false)
}

// Core-owned contexts use the frozen V1 representation: skills cannot contain
// links; package hardlinks are captured as independent ordinary files.
func CaptureOwned(ctx context.Context, rootPath string, blobs *workpackage.BlobDirectory, packageTree bool) (Result, error) {
	return capture(ctx, rootPath, blobs, true, !packageTree)
}

func capture(ctx context.Context, rootPath string, blobs *workpackage.BlobDirectory, independentFiles, rejectLinks bool) (Result, error) {
	root, err := workpackage.OpenDirectoryFD(rootPath)
	if err != nil {
		return Result{}, ErrUnreadable
	}
	defer unix.Close(root)
	tree := workpackage.Tree{Version: 1, Entries: []workpackage.TreeEntry{}}
	seen := map[inode]capturedInode{}
	var logical, metadataBytes int64
	add := func(entry workpackage.TreeEntry) error {
		if int64(len(tree.Entries)) >= workpackage.DefaultLimits.Entries {
			return limit()
		}
		raw, err := json.Marshal(entry)
		if err != nil {
			return ErrUnreadable
		}
		metadataBytes += int64(len(raw) + 1)
		if metadataBytes > workpackage.DefaultLimits.MetadataBytes {
			return limit()
		}
		tree.Entries = append(tree.Entries, entry)
		return nil
	}
	var walk func(int, []string) error
	walk = func(fd int, parts []string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		var before unix.Stat_t
		if unix.Fstat(fd, &before) != nil {
			return ErrUnreadable
		}
		if err := noAttrs(fd); err != nil {
			return err
		}
		if err := add(metadata(before, parts, "directory")); err != nil {
			return err
		}
		items, err := names(ctx, fd)
		if err != nil {
			return err
		}
		for _, name := range items {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			path := append(append([]string(nil), parts...), name)
			if len(path) > workpackage.DefaultLimits.Depth || int64(len(strings.Join(path, "/"))) > workpackage.DefaultLimits.PathBytes {
				return limit()
			}
			var info unix.Stat_t
			if unix.Fstatat(fd, name, &info, unix.AT_SYMLINK_NOFOLLOW) != nil {
				return ErrUnreadable
			}
			switch info.Mode & unix.S_IFMT {
			case unix.S_IFDIR:
				child, err := unix.Openat(fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
				if err != nil {
					return ErrUnreadable
				}
				var actual unix.Stat_t
				if unix.Fstat(child, &actual) != nil || !same(info, actual) {
					unix.Close(child)
					return ErrUnreadable
				}
				err = walk(child, path)
				unix.Close(child)
				if err != nil {
					return err
				}
			case unix.S_IFLNK:
				if rejectLinks {
					return ErrUnsupported
				}
				if err := noLinkAttrs(fd, name); err != nil {
					return err
				}
				buffer := make([]byte, workpackage.DefaultLimits.PathBytes+1)
				n, err := unix.Readlinkat(fd, name, buffer)
				if err != nil {
					return ErrUnreadable
				}
				if int64(n) > workpackage.DefaultLimits.PathBytes {
					return limit()
				}
				entry := metadata(info, path, "symlink")
				entry.TargetBase64 = base64.StdEncoding.EncodeToString(buffer[:n])
				if err := add(entry); err != nil {
					return err
				}
			case unix.S_IFREG:
				key := inode{info.Dev, info.Ino}
				if prior, ok := seen[key]; ok && !independentFiles {
					if !same(info, prior.info) {
						return ErrUnreadable
					}
					entry := metadata(info, path, "hardlink")
					entry.TargetSegmentsBase64 = prior.entry.SegmentsBase64
					if err := add(entry); err != nil {
						return err
					}
					break
				}
				sourceFD, err := unix.Openat(fd, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0)
				if err != nil {
					return ErrUnreadable
				}
				source := os.NewFile(uintptr(sourceFD), "source")
				var actual unix.Stat_t
				if unix.Fstat(sourceFD, &actual) != nil || !same(info, actual) {
					source.Close()
					return ErrUnreadable
				}
				if err := noAttrs(sourceFD); err != nil {
					source.Close()
					return err
				}
				if info.Size < 0 || info.Size > workpackage.DefaultLimits.RestoredBytes-logical {
					source.Close()
					return limit()
				}
				blob, err := blobs.Put(ctx, source, info.Size)
				if err != nil {
					source.Close()
					return err
				}
				if unix.Fstat(sourceFD, &actual) != nil || !same(info, actual) || blob.Size != info.Size {
					source.Close()
					return ErrUnreadable
				}
				if source.Close() != nil {
					return ErrUnreadable
				}
				logical += blob.Size
				entry := metadata(info, path, "file")
				entry.Blob = contracts.WorkBlobDigest(blob.Digest)
				entry.Size = blob.Size
				seen[key] = capturedInode{entry, info}
				if err := add(entry); err != nil {
					return err
				}
			default:
				return ErrUnsupported
			}
			var after unix.Stat_t
			if unix.Fstatat(fd, name, &after, unix.AT_SYMLINK_NOFOLLOW) != nil || !same(info, after) {
				return ErrUnreadable
			}
		}
		var after unix.Stat_t
		if unix.Fstat(fd, &after) != nil || !same(before, after) {
			return ErrUnreadable
		}
		return nil
	}
	if err := walk(root, []string{}); err != nil {
		return Result{}, err
	}
	sort.Slice(tree.Entries, func(i, j int) bool {
		a, _ := workpackage.DecodePath(tree.Entries[i].SegmentsBase64, workpackage.DefaultLimits)
		b, _ := workpackage.DecodePath(tree.Entries[j].SegmentsBase64, workpackage.DefaultLimits)
		return bytes.Compare(a, b) < 0
	})
	raw, err := contracts.EncodeCanonicalJSON(tree)
	if err != nil {
		return Result{}, ErrUnreadable
	}
	if int64(len(raw)) > workpackage.DefaultLimits.MetadataBytes {
		return Result{}, limit()
	}
	blob, err := blobs.Put(ctx, bytes.NewReader(raw), workpackage.DefaultLimits.MetadataBytes)
	if err != nil {
		return Result{}, err
	}
	return Result{Tree: blob.Digest, Size: blob.Size, Entries: int64(len(tree.Entries)), LogicalBytes: logical}, nil
}

func Code(err error) string {
	var own *Error
	if errors.As(err, &own) {
		return own.Code
	}
	var format *workpackage.ValidationError
	if errors.As(err, &format) {
		return format.Code
	}
	return "SNAPSHOT_STORAGE_UNREADABLE"
}
