//go:build linux

// Package safefs provides fd-relative no-follow operations for platform files.
package safefs

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

var ErrUnsafePath = errors.New("data directory or managed file is unsafe")
var ErrLocked = errors.New("another Core owns this data directory")

type Root struct {
	fd        int
	locked    bool
	lockOwner *Root
}

func (r *Root) writable() bool {
	return r.fd >= 0 && (r.locked || r.lockOwner != nil && r.lockOwner.fd >= 0 && r.lockOwner.locked)
}

// OpenRoot walks each directory component without following symlinks. Only a
// missing final directory is created: callers must name an existing parent.
func OpenRoot(input string) (*Root, error) {
	return openRoot(input, true, true)
}

// OpenExistingRoot is used for explicitly supplied credential locations. Reading
// a credential never creates a parent directory or changes its permissions.
func OpenExistingRoot(input string) (*Root, error) {
	return openRoot(input, false, true)
}

func openRoot(input string, create, owned bool) (*Root, error) {
	if strings.TrimSpace(input) == "" || strings.ContainsRune(input, 0) {
		return nil, ErrUnsafePath
	}
	name, err := filepath.Abs(input)
	if err != nil {
		return nil, ErrUnsafePath
	}
	if name == "/" {
		return nil, ErrUnsafePath
	}
	parts := strings.Split(strings.TrimPrefix(filepath.Clean(name), "/"), "/")
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnsafePath
	}
	for i, part := range parts {
		next, err := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if create && errors.Is(err, unix.ENOENT) && i == len(parts)-1 {
			if err = unix.Mkdirat(fd, part, 0700); err == nil || errors.Is(err, unix.EEXIST) {
				_ = unix.Fsync(fd)
				next, err = unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
			}
		}
		unix.Close(fd)
		if err != nil {
			return nil, ErrUnsafePath
		}
		fd = next
	}
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || owned && info.Uid != uint32(os.Geteuid()) {
		unix.Close(fd)
		return nil, ErrUnsafePath
	}
	return &Root{fd: fd}, nil
}

// ReadProtectedFile permits a private user-owned file in a public directory,
// while pinning every existing ancestor and refusing links/FIFO/hard links.
// Unlike operator storage, a supplied API key file needs no private parent.
func ReadProtectedFile(input string, limit int64) ([]byte, error) {
	root, err := openRoot(filepath.Dir(input), false, false)
	if err != nil {
		return nil, err
	}
	defer root.Close()
	return root.ReadFile(filepath.Base(input), limit)
}
func (r *Root) Lock() error {
	if r.locked {
		return nil
	}
	if err := unix.Flock(r.fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return ErrLocked
	}
	r.locked = true
	return nil
}
func (r *Root) Unlock() error {
	if !r.locked {
		return nil
	}
	if err := unix.Flock(r.fd, unix.LOCK_UN); err != nil {
		return ErrLocked
	}
	r.locked = false
	return nil
}
func (r *Root) Close() error {
	if r.fd < 0 {
		return nil
	}
	fd := r.fd
	r.fd = -1
	r.locked = false
	return unix.Close(fd)
}
func (r *Root) Sync() error        { return unix.Fsync(r.fd) }
func (r *Root) MakePrivate() error { return unix.Fchmod(r.fd, 0700) }
func (r *Root) CheckPrivate() error {
	var info unix.Stat_t
	if unix.Fstat(r.fd, &info) != nil || info.Uid != uint32(os.Geteuid()) || info.Mode&0077 != 0 {
		return ErrUnsafePath
	}
	return nil
}
func ValidFileName(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 && utf8.ValidString(name) && !strings.ContainsAny(name, "/\\\x00")
}
func leaf(name string) bool { return ValidFileName(name) }

func (r *Root) SameDirectory(other *Root) bool {
	if other == nil {
		return false
	}
	var a, b unix.Stat_t
	return unix.Fstat(r.fd, &a) == nil && unix.Fstat(other.fd, &b) == nil && a.Dev == b.Dev && a.Ino == b.Ino
}
func (r *Root) Entries() ([]string, error) {
	fd, err := unix.Openat(r.fd, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnsafePath
	}
	file := os.NewFile(uintptr(fd), "core directory")
	defer file.Close()
	entries, err := file.ReadDir(-1)
	if err != nil {
		return nil, ErrUnsafePath
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	return names, nil
}
func (r *Root) CheckEntry(name string, directory bool) error {
	if !leaf(name) {
		return ErrUnsafePath
	}
	var info unix.Stat_t
	if unix.Fstatat(r.fd, name, &info, unix.AT_SYMLINK_NOFOLLOW) != nil {
		return ErrUnsafePath
	}
	expected := uint32(unix.S_IFREG)
	if directory {
		expected = unix.S_IFDIR
	}
	if info.Mode&unix.S_IFMT != expected || info.Uid != uint32(os.Geteuid()) || info.Mode&0077 != 0 || (!directory && info.Nlink != 1) {
		return ErrUnsafePath
	}
	return nil
}
func (r *Root) OpenFile(name string, flags int) (*os.File, error) {
	if !leaf(name) {
		return nil, ErrUnsafePath
	}
	fd, err := unix.Openat(r.fd, name, flags|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG || info.Uid != uint32(os.Geteuid()) || info.Nlink != 1 || info.Mode&0077 != 0 {
		unix.Close(fd)
		return nil, ErrUnsafePath
	}
	return os.NewFile(uintptr(fd), name), nil
}
func (r *Root) ReadFile(name string, limit int64) ([]byte, error) {
	file, err := r.OpenFile(name, unix.O_RDONLY)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, ErrUnsafePath
	}
	return raw, nil
}

// ReadPublishedFile reads a Core-owned immutable input that is deliberately
// readable by the Agent container. It retains no-follow and regular-file
// checks, but permits read bits for the container UID.
func (r *Root) ReadPublishedFile(name string, limit int64) ([]byte, error) {
	if !leaf(name) || limit < 0 {
		return nil, ErrUnsafePath
	}
	fd, err := unix.Openat(r.fd, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	file := os.NewFile(uintptr(fd), name)
	defer file.Close()
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG || info.Uid != uint32(os.Geteuid()) || info.Nlink != 1 || info.Mode&0022 != 0 {
		return nil, ErrUnsafePath
	}
	raw, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(raw)) > limit {
		return nil, ErrUnsafePath
	}
	return raw, nil
}
func (r *Root) AtomicWrite(name, temp string, data []byte) error {
	if !r.writable() || !leaf(name) || !leaf(temp) {
		return ErrUnsafePath
	}
	file, err := r.OpenFile(temp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL)
	if err != nil {
		return err
	}
	_, err = file.Write(data)
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if err := unix.Renameat(r.fd, temp, r.fd, name); err != nil {
		return err
	}
	return r.Sync()
}
func (r *Root) Rename(old, new string) error {
	if !r.writable() || !leaf(old) || !leaf(new) {
		return ErrUnsafePath
	}
	if err := unix.Renameat(r.fd, old, r.fd, new); err != nil {
		return err
	}
	return r.Sync()
}

// RenameNoReplace publishes an immutable sibling without ever replacing a
// context or artifact that already owns the requested identity.
func (r *Root) RenameNoReplace(old, new string) error {
	if !r.writable() || !leaf(old) || !leaf(new) {
		return ErrUnsafePath
	}
	if err := unix.Renameat2(r.fd, old, r.fd, new, unix.RENAME_NOREPLACE); err != nil {
		return err
	}
	return r.Sync()
}
func (r *Root) Remove(name string) error {
	if !r.writable() || !leaf(name) {
		return ErrUnsafePath
	}
	if err := unix.Unlinkat(r.fd, name, 0); err != nil {
		return err
	}
	return r.Sync()
}

// RemoveTree removes one owned child beneath a pinned private directory. It
// never follows links while descending; it is used for unpublished context
// candidates whose Work acceptance did not commit.
func (r *Root) RemoveTree(name string) error {
	if !r.writable() || !leaf(name) || r.CheckPrivate() != nil {
		return ErrUnsafePath
	}
	if err := removeTreeAt(r.fd, name); err != nil {
		return err
	}
	return r.Sync()
}

func removeTreeAt(parent int, name string) error {
	if !leaf(name) {
		return ErrUnsafePath
	}
	var before unix.Stat_t
	if err := unix.Fstatat(parent, name, &before, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return err
	}
	if before.Uid != uint32(os.Geteuid()) {
		return ErrUnsafePath
	}
	if before.Mode&unix.S_IFMT != unix.S_IFDIR {
		return unix.Unlinkat(parent, name, 0)
	}
	fd, err := unix.Openat(parent, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return ErrUnsafePath
	}
	child := os.NewFile(uintptr(fd), name)
	var opened unix.Stat_t
	if unix.Fstat(fd, &opened) != nil || opened.Dev != before.Dev || opened.Ino != before.Ino {
		child.Close()
		return ErrUnsafePath
	}
	entries, err := child.ReadDir(-1)
	if err == nil {
		for _, entry := range entries {
			if err = removeTreeAt(fd, entry.Name()); err != nil {
				break
			}
		}
	}
	if closeErr := child.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	var current unix.Stat_t
	if unix.Fstatat(parent, name, &current, unix.AT_SYMLINK_NOFOLLOW) != nil || current.Dev != before.Dev || current.Ino != before.Ino {
		return ErrUnsafePath
	}
	return unix.Unlinkat(parent, name, unix.AT_REMOVEDIR)
}
func (r *Root) EnsureDirectory(name string) error {
	if !r.writable() || !leaf(name) {
		return ErrUnsafePath
	}
	err := unix.Mkdirat(r.fd, name, 0700)
	if err != nil && !errors.Is(err, unix.EEXIST) {
		return err
	}
	fd, err := unix.Openat(r.fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return ErrUnsafePath
	}
	defer unix.Close(fd)
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Uid != uint32(os.Geteuid()) || info.Mode&0077 != 0 {
		return ErrUnsafePath
	}
	if err := unix.Fsync(fd); err != nil {
		return err
	}
	return r.Sync()
}

// Path is for libraries (SQLite) which require a filename. The pinned directory
// fd prevents a renamed/replaced ancestor from redirecting the operation.
func (r *Root) Path(name string) (string, error) {
	if !leaf(name) {
		return "", ErrUnsafePath
	}
	return fmt.Sprintf("/proc/self/fd/%d/%s", r.fd, name), nil
}

// OpenDirectory pins an owned private child without reopening any ancestor.
func (r *Root) OpenDirectory(name string) (*Root, error) {
	if err := r.EnsureDirectory(name); err != nil {
		return nil, err
	}
	fd, err := unix.Openat(r.fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnsafePath
	}
	child := &Root{fd: fd}
	if child.CheckPrivate() != nil || child.Lock() != nil {
		child.Close()
		return nil, ErrUnsafePath
	}
	return child, nil
}

// OpenPrivateDirectory opens an existing owned child without a second flock.
// The caller must already own the enclosing Core store lock and coordinate
// mutations; this is used by independent, uniquely named upload transfers.
func (r *Root) OpenPrivateDirectory(name string) (*Root, error) {
	if !r.writable() || !leaf(name) {
		return nil, ErrUnsafePath
	}
	fd, err := unix.Openat(r.fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnsafePath
	}
	owner := r.lockOwner
	if r.locked {
		owner = r
	}
	child := &Root{fd: fd, lockOwner: owner}
	if err := child.CheckPrivate(); err != nil {
		child.Close()
		return nil, err
	}
	return child, nil
}

// OpenPublishedDirectory reads an already published, Agent-traversable
// directory without creating it or accepting links and writable ancestors.
func (r *Root) OpenPublishedDirectory(name string) (*Root, error) {
	if !leaf(name) {
		return nil, ErrUnsafePath
	}
	fd, err := unix.Openat(r.fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, ErrUnsafePath
	}
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFDIR || info.Uid != uint32(os.Geteuid()) || info.Mode&0022 != 0 {
		unix.Close(fd)
		return nil, ErrUnsafePath
	}
	return &Root{fd: fd}, nil
}

// ReadMaterial is deliberately separate from private Core storage reads. The
// 0644 exception is only for files individually mounted into a numeric Agent
// user; their host directory must remain private.
func (r *Root) ReadMaterial(name string, limit int64, mode os.FileMode) ([]byte, error) {
	if !leaf(name) || limit < 0 || (mode != 0600 && mode != 0644) || r.CheckPrivate() != nil {
		return nil, ErrUnsafePath
	}
	fd, err := unix.Openat(r.fd, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), name)
	defer f.Close()
	var info unix.Stat_t
	if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG || info.Mode&07777 != uint32(mode) || info.Uid != uint32(os.Geteuid()) || info.Nlink != 1 {
		return nil, ErrUnsafePath
	}
	data, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(data)) > limit {
		return nil, ErrUnsafePath
	}
	return data, nil
}

func (r *Root) AtomicMaterialWrite(name, temp string, data []byte, mode os.FileMode) error {
	if !r.writable() || !leaf(name) || !leaf(temp) || name == temp || (mode != 0600 && mode != 0644) || r.CheckPrivate() != nil {
		return ErrUnsafePath
	}
	f, err := r.OpenFile(temp, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	if err == nil {
		err = f.Chmod(mode)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return r.Rename(temp, name)
}
