//go:build linux

package skillartifact

import (
	"bytes"
	"io"
	"path"
	"sort"
	"strings"

	"piwork/internal/contracts"
)

// FromFiles accepts the content protocol's regular files without inventing
// empty directories or using an uploaded host path as a Skill identity.
func FromFiles(name string, files []File) (Snapshot, error) {
	var snapshot Snapshot
	if !skillName.MatchString(name) || len(files) == 0 || len(files) > maxFiles {
		return snapshot, ErrUnsafeTree
	}
	snapshot.Name = name
	directories := make(map[string]struct{})
	for _, file := range files {
		if !validRelative(file.Path) || len(file.Data) > maxFileBytes {
			return Snapshot{}, ErrUnsafeTree
		}
		data := append([]byte(nil), file.Data...)
		snapshot.Files = append(snapshot.Files, File{Path: file.Path, Data: data})
		snapshot.TotalBytes += int64(len(data))
		if snapshot.TotalBytes > maxTotalBytes {
			return Snapshot{}, ErrUnsafeTree
		}
		for parent := path.Dir(file.Path); parent != "."; parent = path.Dir(parent) {
			directories[parent] = struct{}{}
		}
	}
	for directory := range directories {
		snapshot.Directories = append(snapshot.Directories, directory)
	}
	sort.Slice(snapshot.Files, func(i, j int) bool { return snapshot.Files[i].Path < snapshot.Files[j].Path })
	sort.Strings(snapshot.Directories)
	entries := make([]contracts.DigestEntry, 0, len(snapshot.Files))
	for _, file := range snapshot.Files {
		data := file.Data
		entries = append(entries, contracts.DigestEntry{Path: file.Path, Type: "file", Size: int64(len(data)), Open: func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(data)), nil
		}})
	}
	identity, err := contracts.SkillDigest(entries)
	if err != nil || !strings.HasPrefix(identity, "sha256:") {
		return Snapshot{}, ErrUnsafeTree
	}
	snapshot.Identity = identity
	if err := validateSnapshot(snapshot); err != nil {
		return Snapshot{}, err
	}
	return snapshot, nil
}
