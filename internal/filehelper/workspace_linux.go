//go:build linux

package filehelper

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/fileprotocol"
)

const directoryFlags = unix.O_RDONLY | unix.O_DIRECTORY | unix.O_NOFOLLOW | unix.O_CLOEXEC
const fileFlags = unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_CLOEXEC
const MaxEntries = 10000

type Workspace struct{ root int }

func pathError(code string) error { return fileprotocol.Failure(code) }
func filesystemError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, unix.ENOENT):
		return pathError("FILE_NOT_FOUND")
	case errors.Is(err, unix.EACCES), errors.Is(err, unix.EPERM):
		return pathError("FILE_PERMISSION_DENIED")
	case errors.Is(err, unix.ELOOP), errors.Is(err, unix.ENOTDIR):
		return pathError("FILE_TYPE_UNSUPPORTED")
	case errors.Is(err, unix.EEXIST):
		return pathError("FILE_PRECONDITION_FAILED")
	case errors.Is(err, unix.ENOTEMPTY):
		return pathError("FILE_CONFLICT")
	case errors.Is(err, unix.ENOSPC), errors.Is(err, unix.EDQUOT):
		return pathError("FILE_STORAGE_FULL")
	default:
		return pathError("FILE_RUNTIME_UNAVAILABLE")
	}
}
func ValidateSegments(parts []string) error {
	if len(parts) > 128 {
		return pathError("FILE_PATH_INVALID")
	}
	size := 0
	for index, part := range parts {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "/\\") || !utf8.ValidString(part) {
			return pathError("FILE_PATH_INVALID")
		}
		for _, char := range part {
			if !(char == 9 || char == 10 || char == 13 || char >= 0x20 && char <= 0xD7FF || char >= 0xE000 && char <= 0xFFFD || char >= 0x10000 && char <= 0x10FFFF) {
				return pathError("FILE_PATH_INVALID")
			}
		}
		if len(part) > 255 {
			return pathError("FILE_PATH_TOO_LONG")
		}
		size += len(part)
		if index > 0 {
			size++
		}
	}
	if size > 4096 {
		return pathError("FILE_PATH_TOO_LONG")
	}
	return nil
}

// Pin every ancestor of the fixed helper mount. This root is a Work volume,
// not a Core installation root and must not acquire its exclusive owner lock.
func OpenWorkspace(path string) (*Workspace, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return nil, pathError("FILE_PATH_INVALID")
	}
	fd, err := unix.Open("/", directoryFlags, 0)
	if err != nil {
		return nil, filesystemError(err)
	}
	for _, part := range strings.Split(strings.TrimPrefix(path, "/"), "/") {
		next, err := unix.Openat(fd, part, directoryFlags, 0)
		unix.Close(fd)
		if err != nil {
			return nil, filesystemError(err)
		}
		fd = next
	}
	return &Workspace{root: fd}, nil
}
func (work *Workspace) Close() error {
	if work.root < 0 {
		return nil
	}
	fd := work.root
	work.root = -1
	return unix.Close(fd)
}
func (work *Workspace) openDirectory(parts []string) (int, error) {
	if err := ValidateSegments(parts); err != nil {
		return -1, err
	}
	current, err := unix.Openat(work.root, ".", directoryFlags, 0)
	if err != nil {
		return -1, filesystemError(err)
	}
	for _, part := range parts {
		next, err := unix.Openat(current, part, directoryFlags, 0)
		unix.Close(current)
		if err != nil {
			return -1, filesystemError(err)
		}
		current = next
	}
	return current, nil
}
func (work *Workspace) openParent(parts []string, creating bool) (int, error) {
	if err := ValidateSegments(parts); err != nil {
		return -1, err
	}
	if len(parts) == 0 {
		return -1, pathError("FILE_ROOT_PROTECTED")
	}
	parent, err := work.openDirectory(parts[:len(parts)-1])
	if creating && fileprotocol.Code(err) == "FILE_NOT_FOUND" {
		return -1, pathError("FILE_CONFLICT")
	}
	return parent, err
}
func (work *Workspace) verifyParent(fd int, parts []string) error {
	fresh, err := work.openDirectory(parts)
	if err != nil {
		return err
	}
	defer unix.Close(fresh)
	var old, current unix.Stat_t
	if err := unix.Fstat(fd, &old); err != nil {
		return filesystemError(err)
	}
	if err := unix.Fstat(fresh, &current); err != nil {
		return filesystemError(err)
	}
	if old.Dev != current.Dev || old.Ino != current.Ino {
		return pathError("FILE_CONFLICT")
	}
	return nil
}
func fileKind(mode uint32) string {
	switch mode & unix.S_IFMT {
	case unix.S_IFDIR:
		return "directory"
	case unix.S_IFREG:
		return "file"
	case unix.S_IFLNK:
		return "symlink"
	default:
		return "unsupported"
	}
}
func jsonValue(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }
func metadata(parts []string, stat unix.Stat_t) (contracts.FileHelperMeta, error) {
	kind := fileKind(stat.Mode)
	if parts == nil {
		parts = []string{}
	}
	result := contracts.FileHelperMeta{PathSegments: append([]string{}, parts...), Kind: kind, Size: jsonValue(nil)}
	if kind == "file" {
		if stat.Size < 0 || stat.Size > contracts.MaxSafeInteger {
			return result, pathError("FILE_LIMIT_EXCEEDED")
		}
		result.Size = jsonValue(stat.Size)
	}
	if stat.Mtim.Sec > contracts.MaxSafeInteger/1000 {
		return result, pathError("FILE_LIMIT_EXCEEDED")
	}
	modified := int64(0)
	if stat.Mtim.Sec >= 0 {
		modified = stat.Mtim.Sec*1000 + stat.Mtim.Nsec/1000000
	}
	result.ModifiedMs = jsonValue(modified)
	return result, nil
}
func (work *Workspace) Stat(parts []string) (contracts.FileHelperMeta, error) {
	if err := ValidateSegments(parts); err != nil {
		return contracts.FileHelperMeta{}, err
	}
	var info unix.Stat_t
	if len(parts) == 0 {
		if err := unix.Fstat(work.root, &info); err != nil {
			return contracts.FileHelperMeta{}, filesystemError(err)
		}
		return metadata(parts, info)
	}
	parent, err := work.openParent(parts, false)
	if err != nil {
		return contracts.FileHelperMeta{}, err
	}
	defer unix.Close(parent)
	if err := work.verifyParent(parent, parts[:len(parts)-1]); err != nil {
		return contracts.FileHelperMeta{}, err
	}
	if err := unix.Fstatat(parent, parts[len(parts)-1], &info, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return contracts.FileHelperMeta{}, filesystemError(err)
	}
	return metadata(parts, info)
}
func (work *Workspace) StatOptional(parts []string) (*contracts.FileHelperMeta, error) {
	value, err := work.Stat(parts)
	if err != nil {
		if fileprotocol.Code(err) == "FILE_NOT_FOUND" {
			return nil, nil
		}
		return nil, err
	}
	return &value, nil
}
func (work *Workspace) List(parts []string) ([]contracts.FileHelperMeta, error) {
	fd, err := work.openDirectory(parts)
	if err != nil {
		return nil, err
	}
	directory := os.NewFile(uintptr(fd), "workspace-directory")
	defer directory.Close()
	if err := work.verifyParent(fd, parts); err != nil {
		return nil, err
	}
	names, err := directory.Readdirnames(MaxEntries + 1)
	if err != nil && err != io.EOF {
		return nil, filesystemError(err)
	}
	if len(names) > MaxEntries {
		return nil, pathError("FILE_LIMIT_EXCEEDED")
	}
	sort.Strings(names)
	entries := make([]contracts.FileHelperMeta, 0, len(names))
	for _, name := range names {
		if err := ValidateSegments([]string{name}); err != nil {
			return nil, pathError("FILE_NAME_UNSUPPORTED")
		}
		child := append(append([]string{}, parts...), name)
		if err := ValidateSegments(child); err != nil {
			return nil, err
		}
		var info unix.Stat_t
		if err := unix.Fstatat(fd, name, &info, unix.AT_SYMLINK_NOFOLLOW); err != nil {
			return nil, filesystemError(err)
		}
		entry, err := metadata(child, info)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
	}
	if err := work.verifyParent(fd, parts); err != nil {
		return nil, err
	}
	return entries, nil
}
func (work *Workspace) Read(parts []string, start int64, end *int64, consume func([]byte) error) (int64, error) {
	parent, err := work.openParent(parts, false)
	if err != nil {
		return 0, err
	}
	defer unix.Close(parent)
	if err := work.verifyParent(parent, parts[:len(parts)-1]); err != nil {
		return 0, err
	}
	fd, err := unix.Openat(parent, parts[len(parts)-1], fileFlags, 0)
	if err != nil {
		return 0, filesystemError(err)
	}
	file := os.NewFile(uintptr(fd), "workspace-file")
	defer file.Close()
	var before unix.Stat_t
	if err := unix.Fstat(fd, &before); err != nil {
		return 0, filesystemError(err)
	}
	if fileKind(before.Mode) != "file" {
		return 0, pathError("FILE_TYPE_UNSUPPORTED")
	}
	if before.Size > fileprotocol.MaxFile {
		return 0, pathError("FILE_LIMIT_EXCEEDED")
	}
	if err := work.verifyParent(parent, parts[:len(parts)-1]); err != nil {
		return 0, err
	}
	last := before.Size - 1
	if end != nil {
		last = *end
	}
	if start < 0 || last < start || start >= before.Size {
		if before.Size == 0 && start == 0 && last == -1 {
			return 0, nil
		}
		return 0, pathError("FILE_RANGE_UNSATISFIABLE")
	}
	if last >= before.Size {
		return 0, pathError("FILE_RANGE_UNSATISFIABLE")
	}
	if _, err := file.Seek(start, io.SeekStart); err != nil {
		return 0, filesystemError(err)
	}
	remaining := last - start + 1
	var count int64
	buffer := make([]byte, 64<<10)
	for remaining > 0 {
		piece := buffer
		if int64(len(piece)) > remaining {
			piece = piece[:remaining]
		}
		n, err := file.Read(piece)
		if n <= 0 {
			return count, pathError("FILE_CONFLICT")
		}
		if err != nil && err != io.EOF {
			return count, filesystemError(err)
		}
		if err := consume(piece[:n]); err != nil {
			return count, err
		}
		count += int64(n)
		remaining -= int64(n)
	}
	var after unix.Stat_t
	if err := unix.Fstat(fd, &after); err != nil {
		return count, filesystemError(err)
	}
	if before.Size != after.Size || before.Mtim != after.Mtim || before.Ctim != after.Ctim {
		return count, pathError("FILE_CONFLICT")
	}
	return count, nil
}
