//go:build linux

// Package skillartifact captures a complete, bounded Skill tree before it is
// published into Core-owned storage or selected by a Work context.
package skillartifact

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
)

const (
	maxFiles      = 2048
	maxFileBytes  = 8 << 20
	maxTotalBytes = 32 << 20
)

var ErrUnsafeTree = errors.New("Skill tree is unsafe or exceeds its limits")
var skillName = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

type File struct {
	Path string
	Data []byte
}

type Snapshot struct {
	Name        string
	Identity    string
	Files       []File
	Directories []string
	TotalBytes  int64
}

// Scan pins the source root and every descendant with no-follow descriptors.
// It reads each file once into a bounded snapshot, so a later source edit or
// deletion cannot change the bytes ultimately published by Core.
func Scan(sourcePath, expectedName string) (Snapshot, error) {
	var result Snapshot
	if !filepath.IsAbs(sourcePath) || strings.ContainsRune(sourcePath, 0) {
		return result, ErrUnsafeTree
	}
	clean := filepath.Clean(sourcePath)
	name := filepath.Base(clean)
	if expectedName != "" && expectedName != name || !skillName.MatchString(name) {
		return result, ErrUnsafeTree
	}
	var before unix.Stat_t
	if unix.Lstat(clean, &before) != nil || before.Mode&unix.S_IFMT != unix.S_IFDIR {
		return result, ErrUnsafeTree
	}
	fd, err := unix.Open(clean, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return result, ErrUnsafeTree
	}
	defer unix.Close(fd)
	var after unix.Stat_t
	if unix.Fstat(fd, &after) != nil || before.Dev != after.Dev || before.Ino != after.Ino {
		return result, ErrUnsafeTree
	}
	result.Name = name
	if err := scanDirectory(fd, "", &result); err != nil {
		return Snapshot{}, err
	}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Path < result.Files[j].Path })
	sort.Strings(result.Directories)
	manifest := false
	entries := make([]contracts.DigestEntry, 0, len(result.Files))
	for _, file := range result.Files {
		if file.Path == "SKILL.md" {
			manifest = true
		}
		data := file.Data
		entries = append(entries, contracts.DigestEntry{Path: file.Path, Type: "file", Size: int64(len(data)), Open: func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(data)), nil
		}})
	}
	if !manifest {
		return Snapshot{}, ErrUnsafeTree
	}
	identity, err := contracts.SkillDigest(entries)
	if err != nil {
		return Snapshot{}, ErrUnsafeTree
	}
	result.Identity = identity
	return result, nil
}

func scanDirectory(fd int, prefix string, result *Snapshot) error {
	copyFD, err := unix.Dup(fd)
	if err != nil {
		return ErrUnsafeTree
	}
	file := os.NewFile(uintptr(copyFD), "Skill directory")
	entries, err := file.ReadDir(-1)
	file.Close()
	if err != nil {
		return ErrUnsafeTree
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		name := entry.Name()
		if name == "" || name == "." || name == ".." || strings.ContainsAny(name, "/\\\x00") || !utf8.ValidString(name) {
			return ErrUnsafeTree
		}
		path := name
		if prefix != "" {
			path = prefix + "/" + name
		}
		var before unix.Stat_t
		if unix.Fstatat(fd, name, &before, unix.AT_SYMLINK_NOFOLLOW) != nil {
			return ErrUnsafeTree
		}
		switch before.Mode & unix.S_IFMT {
		case unix.S_IFDIR:
			child, err := unix.Openat(fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
			if err != nil {
				return ErrUnsafeTree
			}
			var after unix.Stat_t
			if unix.Fstat(child, &after) != nil || before.Dev != after.Dev || before.Ino != after.Ino {
				unix.Close(child)
				return ErrUnsafeTree
			}
			result.Directories = append(result.Directories, path)
			err = scanDirectory(child, path, result)
			unix.Close(child)
			if err != nil {
				return err
			}
		case unix.S_IFREG:
			if len(result.Files) >= maxFiles || before.Size < 0 || before.Size > maxFileBytes || result.TotalBytes+before.Size > maxTotalBytes {
				return ErrUnsafeTree
			}
			child, err := unix.Openat(fd, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
			if err != nil {
				return ErrUnsafeTree
			}
			var after unix.Stat_t
			if unix.Fstat(child, &after) != nil || after.Mode&unix.S_IFMT != unix.S_IFREG || before.Dev != after.Dev || before.Ino != after.Ino || before.Size != after.Size {
				unix.Close(child)
				return ErrUnsafeTree
			}
			opened := os.NewFile(uintptr(child), "Skill file")
			data, err := io.ReadAll(io.LimitReader(opened, before.Size+1))
			opened.Close()
			if err != nil || int64(len(data)) != before.Size {
				return ErrUnsafeTree
			}
			result.Files = append(result.Files, File{Path: path, Data: data})
			result.TotalBytes += int64(len(data))
		default:
			return ErrUnsafeTree
		}
	}
	return nil
}
