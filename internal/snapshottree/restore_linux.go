//go:build linux

package snapshottree

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"math/big"
	"os"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/workpackage"
)

func invalid() error { return &workpackage.ValidationError{Code: "PACKAGE_INVALID", Field: "tree"} }
func parentFD(root int, parts []string) (int, error) {
	fd, err := unix.Openat(root, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, ErrUnreadable
	}
	for _, part := range parts[:max(0, len(parts)-1)] {
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if err != nil {
			return -1, ErrUnreadable
		}
		fd = next
	}
	return fd, nil
}
func pathParts(entry workpackage.TreeEntry) ([]string, error) {
	raw, err := workpackage.DecodePath(entry.SegmentsBase64, workpackage.DefaultLimits)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return []string{}, nil
	}
	return strings.Split(string(raw), "/"), nil
}
func leaf(parts []string) string {
	if len(parts) == 0 {
		return "."
	}
	return parts[len(parts)-1]
}
func timespec(value string) (unix.Timespec, error) {
	n, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return unix.Timespec{}, invalid()
	}
	sec, nsec := new(big.Int), new(big.Int)
	sec.QuoRem(n, big.NewInt(1000000000), nsec)
	if nsec.Sign() < 0 {
		sec.Sub(sec, big.NewInt(1))
		nsec.Add(nsec, big.NewInt(1000000000))
	}
	if !sec.IsInt64() {
		return unix.Timespec{}, ErrUnsupported
	}
	return unix.Timespec{Sec: sec.Int64(), Nsec: nsec.Int64()}, nil
}

// Restore validates the complete tree and every file blob before creating an
// entry. The target must be empty and isolated from Work writers. Links are
// created only after all ordinary directories/files, then metadata is applied
// in reverse order using pinned directory descriptors and no-follow leaves.
func Restore(ctx context.Context, rootPath string, blobs *workpackage.BlobDirectory, digest string, ownedContext bool) (Result, error) {
	raw, err := blobs.ReadMetadata(ctx, digest)
	if err != nil {
		return Result{}, err
	}
	var declared workpackage.Tree
	if json.Unmarshal(raw, &declared) != nil {
		return Result{}, invalid()
	}
	descriptors := map[string]contracts.WorkBlob{}
	for _, entry := range declared.Entries {
		if entry.Type == "file" {
			descriptors[string(entry.Blob)] = contracts.WorkBlob{Digest: entry.Blob, Size: contracts.WorkByteSize(entry.Size), Kinds: []string{"file"}}
		}
	}
	valid, err := workpackage.ValidateTree(raw, descriptors, workpackage.DefaultLimits)
	if err != nil {
		return Result{}, err
	}
	for _, blob := range descriptors {
		if err := blobs.Verify(ctx, string(blob.Digest), int64(blob.Size)); err != nil {
			return Result{}, err
		}
	}
	// Validate representability before touching the target; valid V1 timestamps
	// need not be representable by this Linux filesystem.
	for _, entry := range valid.Tree.Entries {
		if _, err := timespec(entry.MtimeNS); err != nil {
			return Result{}, err
		}
	}
	root, err := workpackage.OpenDirectoryFD(rootPath)
	if err != nil {
		return Result{}, ErrUnreadable
	}
	defer unix.Close(root)
	items, err := names(ctx, root)
	if err != nil {
		return Result{}, err
	}
	if len(items) != 0 {
		return Result{}, invalid()
	}
	if err := noAttrs(root); err != nil {
		return Result{}, err
	}
	for _, entry := range valid.Tree.Entries[1:] {
		if ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		parts, err := pathParts(entry)
		if err != nil {
			return Result{}, err
		}
		parent, err := parentFD(root, parts)
		if err != nil {
			return Result{}, err
		}
		if entry.Type == "directory" {
			err = unix.Mkdirat(parent, leaf(parts), 0700)
		}
		if entry.Type == "file" {
			err = restoreFile(ctx, parent, leaf(parts), entry, blobs)
		}
		unix.Close(parent)
		if err != nil {
			return Result{}, err
		}
	}
	for _, kind := range []string{"hardlink", "symlink"} {
		for _, entry := range valid.Tree.Entries {
			if entry.Type != kind {
				continue
			}
			if ctx.Err() != nil {
				return Result{}, ctx.Err()
			}
			parts, err := pathParts(entry)
			if err != nil {
				return Result{}, err
			}
			parent, err := parentFD(root, parts)
			if err != nil {
				return Result{}, err
			}
			if kind == "symlink" {
				target, decodeErr := workpackage.DecodeBase64(entry.TargetBase64)
				if decodeErr != nil {
					unix.Close(parent)
					return Result{}, decodeErr
				}
				err = unix.Symlinkat(string(target), parent, leaf(parts))
			} else {
				target, decodeErr := workpackage.DecodePath(entry.TargetSegmentsBase64, workpackage.DefaultLimits)
				if decodeErr != nil {
					unix.Close(parent)
					return Result{}, decodeErr
				}
				sourceParts := strings.Split(string(target), "/")
				source, sourceErr := parentFD(root, sourceParts)
				if sourceErr != nil {
					unix.Close(parent)
					return Result{}, sourceErr
				}
				err = unix.Linkat(source, leaf(sourceParts), parent, leaf(parts), 0)
				unix.Close(source)
			}
			unix.Close(parent)
			if err != nil {
				return Result{}, ErrUnreadable
			}
		}
	}
	uid, gid := blobs.Owner()
	for index := len(valid.Tree.Entries) - 1; index >= 0; index-- {
		entry := valid.Tree.Entries[index]
		if entry.Type == "hardlink" {
			continue
		}
		if ctx.Err() != nil {
			return Result{}, ctx.Err()
		}
		if ownedContext {
			entry.UID, entry.GID = int64(uid), int64(gid)
		}
		if err := restoreMetadata(root, entry); err != nil {
			return Result{}, err
		}
	}
	if err := unix.Fsync(root); err != nil {
		return Result{}, ErrUnreadable
	}
	return Result{Tree: digest, Entries: int64(len(valid.Tree.Entries)), LogicalBytes: valid.FileBytes}, nil
}
func restoreFile(ctx context.Context, parent int, name string, entry workpackage.TreeEntry, blobs *workpackage.BlobDirectory) error {
	source, err := blobs.Read(string(entry.Blob))
	if err != nil {
		return err
	}
	defer source.Close()
	fd, err := unix.Openat(parent, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return ErrUnreadable
	}
	target := os.NewFile(uintptr(fd), name)
	defer target.Close()
	hash := sha256.New()
	n, err := io.CopyBuffer(io.MultiWriter(target, hash), io.LimitReader(&ctxReader{ctx, source}, entry.Size+1), make([]byte, 1<<20))
	if err != nil {
		return err
	}
	if n != entry.Size || hex.EncodeToString(hash.Sum(nil)) != string(entry.Blob) {
		return invalid()
	}
	if target.Sync() != nil {
		return ErrUnreadable
	}
	return nil
}
func restoreMetadata(root int, entry workpackage.TreeEntry) error {
	parts, err := pathParts(entry)
	if err != nil {
		return err
	}
	parent, err := parentFD(root, parts)
	if err != nil {
		return err
	}
	defer unix.Close(parent)
	stamp, err := timespec(entry.MtimeNS)
	if err != nil {
		return err
	}
	name := leaf(parts)
	if entry.Type == "symlink" {
		if unix.Fchownat(parent, name, int(entry.UID), int(entry.GID), unix.AT_SYMLINK_NOFOLLOW) != nil {
			return ErrUnreadable
		}
		if unix.UtimesNanoAt(parent, name, []unix.Timespec{stamp, stamp}, unix.AT_SYMLINK_NOFOLLOW) != nil {
			return ErrUnsupported
		}
	} else {
		flags := unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_CLOEXEC
		if entry.Type == "directory" {
			flags |= unix.O_DIRECTORY
		}
		fd, err := unix.Openat(parent, name, flags, 0)
		if err != nil {
			return ErrUnreadable
		}
		defer unix.Close(fd)
		if unix.Fchown(fd, int(entry.UID), int(entry.GID)) != nil || unix.Fchmod(fd, uint32(entry.Mode)) != nil {
			return ErrUnreadable
		}
		if unix.UtimesNanoAt(fd, "", []unix.Timespec{stamp, stamp}, unix.AT_EMPTY_PATH) != nil {
			return ErrUnsupported
		}
		if unix.Fsync(fd) != nil {
			return ErrUnreadable
		}
	}
	var observed unix.Stat_t
	if unix.Fstatat(parent, name, &observed, unix.AT_SYMLINK_NOFOLLOW) != nil {
		return ErrUnreadable
	}
	if int64(observed.Uid) != entry.UID || int64(observed.Gid) != entry.GID || nanoseconds(observed.Mtim) != entry.MtimeNS || (entry.Type != "symlink" && int64(observed.Mode&07777) != entry.Mode) {
		return ErrUnsupported
	}
	return nil
}

type ctxReader struct {
	ctx    context.Context
	source io.Reader
}

func (r *ctxReader) Read(raw []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.source.Read(raw)
}
