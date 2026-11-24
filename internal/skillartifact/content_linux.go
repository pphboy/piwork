//go:build linux

package skillartifact

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"path"
	"sort"
	"strings"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/safefs"
)

var ErrFileNotFound = errors.New("Skill file was not found")
var ErrFileNotText = errors.New("Skill file is not editable text")

// FileVersion derives an opaque, per-file version from the file bytes. It is
// unrelated to the complete artifact identity and never exposes it.
func FileVersion(data []byte) string {
	sum := sha256.Sum256(data)
	return "file-sha256:" + hex.EncodeToString(sum[:])
}

// ReadFile returns one existing regular file from a verified snapshot.
func ReadFile(snapshot Snapshot, relative string) ([]byte, bool) {
	for _, file := range snapshot.Files {
		if file.Path == relative {
			return file.Data, true
		}
	}
	return nil, false
}

// ReplaceFile clones a verified snapshot and replaces exactly one existing
// text file. Every other file and directory is preserved byte for byte, and
// the resulting snapshot is revalidated before it can be published.
func ReplaceFile(snapshot Snapshot, relative string, data []byte) (Snapshot, error) {
	if !ValidRelativePath(relative) {
		return Snapshot{}, ErrUnsafeTree
	}
	if !utf8.Valid(data) || bytes.IndexByte(data, 0) >= 0 {
		return Snapshot{}, ErrFileNotText
	}
	if len(data) > maxFileBytes {
		return Snapshot{}, ErrUnsafeTree
	}
	index := -1
	for i, file := range snapshot.Files {
		if file.Path == relative {
			index = i
			break
		}
	}
	if index < 0 {
		return Snapshot{}, ErrFileNotFound
	}
	result := Snapshot{
		Name:        snapshot.Name,
		Identity:    snapshot.Identity,
		Files:       make([]File, len(snapshot.Files)),
		Directories: append([]string{}, snapshot.Directories...),
	}
	for i, file := range snapshot.Files {
		result.Files[i] = File{Path: file.Path, Data: file.Data}
	}
	result.Files[index] = File{Path: relative, Data: append([]byte(nil), data...)}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Path < result.Files[j].Path })
	var total int64
	entries := make([]contracts.DigestEntry, 0, len(result.Files))
	for _, file := range result.Files {
		total += int64(len(file.Data))
		fileData := file.Data
		entries = append(entries, contracts.DigestEntry{Path: file.Path, Type: "file", Size: int64(len(fileData)), Open: func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(fileData)), nil
		}})
	}
	if total > maxTotalBytes {
		return Snapshot{}, ErrUnsafeTree
	}
	identity, err := contracts.SkillDigest(entries)
	if err != nil {
		return Snapshot{}, ErrUnsafeTree
	}
	result.TotalBytes = total
	result.Identity = identity
	if err := validateSnapshot(result); err != nil {
		return Snapshot{}, err
	}
	return result, nil
}

// ValidRelativePath applies the upload path boundary to decoded content paths:
// one relative path, at most 4,096 bytes and 64 segments, no empty, dot or
// parent segments, control characters, backslashes, absolute paths or drive
// prefixes.
func ValidRelativePath(value string) bool {
	if value == "" || len(value) > 4096 || strings.HasPrefix(value, "/") || strings.ContainsRune(value, '\\') || path.Clean(value) != value {
		return false
	}
	parts := strings.Split(value, "/")
	if len(parts) > 64 {
		return false
	}
	if len(parts[0]) >= 2 && (parts[0][0] >= 'A' && parts[0][0] <= 'Z' || parts[0][0] >= 'a' && parts[0][0] <= 'z') && parts[0][1] == ':' {
		return false
	}
	for _, part := range parts {
		if part == "" || part == "." || part == ".." || !safefs.ValidFileName(part) {
			return false
		}
		for _, r := range part {
			if r < 0x20 || r == 0x7f {
				return false
			}
		}
	}
	return true
}
