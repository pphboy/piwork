//go:build linux

package skillartifact

import (
	"bytes"
	"errors"
	"io"
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/google/uuid"
	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/safefs"
)

var digestIdentity = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)

// Publish creates an immutable Core-owned copy. A duplicate content identity
// is reused only after the existing tree is checked byte for byte.
func Publish(store *corestore.Store, snapshot Snapshot) error {
	if store == nil || !skillName.MatchString(snapshot.Name) || !digestIdentity.MatchString(snapshot.Identity) || len(snapshot.Files) < 1 || len(snapshot.Files) > maxFiles || snapshot.TotalBytes > maxTotalBytes {
		return ErrUnsafeTree
	}
	snapshot.Files = append([]File{}, snapshot.Files...)
	snapshot.Directories = append([]string{}, snapshot.Directories...)
	sort.Slice(snapshot.Files, func(i, j int) bool { return snapshot.Files[i].Path < snapshot.Files[j].Path })
	sort.Strings(snapshot.Directories)
	if err := validateSnapshot(snapshot); err != nil {
		return err
	}
	root, err := store.OpenSkillsRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	skill, err := root.OpenDirectory(snapshot.Name)
	if err != nil {
		return err
	}
	defer skill.Close()
	artifacts, err := skill.OpenDirectory("artifacts")
	if err != nil {
		return err
	}
	defer artifacts.Close()
	id, err := uuid.NewRandom()
	if err != nil {
		return err
	}
	stageName := "stage-" + id.String()
	stage, err := artifacts.OpenDirectory(stageName)
	if err != nil {
		return err
	}
	stageOpen := true
	defer func() {
		if stageOpen {
			stage.Close()
		}
		_ = artifacts.RemoveTree(stageName)
	}()
	for _, directory := range snapshot.Directories {
		parent, closeParent, err := nestedRoot(stage, directory)
		if err != nil {
			return err
		}
		if closeParent {
			parent.Close()
		}
	}
	for _, file := range snapshot.Files {
		if path.IsAbs(file.Path) || path.Clean(file.Path) != file.Path || file.Path == "SKILL.md/" || len(file.Data) > maxFileBytes {
			return ErrUnsafeTree
		}
		parentPath := path.Dir(file.Path)
		parent := stage
		closeParent := false
		if parentPath != "." {
			parent, closeParent, err = nestedRoot(stage, parentPath)
			if err != nil {
				return err
			}
		}
		err = parent.AtomicWrite(path.Base(file.Path), "publish-"+id.String()+".tmp", file.Data)
		if closeParent {
			parent.Close()
		}
		if err != nil {
			return err
		}
	}
	if err := stage.Sync(); err != nil {
		return err
	}
	stage.Close()
	stageOpen = false
	digest := strings.TrimPrefix(snapshot.Identity, "sha256:")
	if err := artifacts.RenameNoReplace(stageName, digest); err != nil {
		// Only an existing, exactly matching artifact is idempotent. Any
		// other collision or filesystem failure remains an error.
		if !errors.Is(err, unix.EEXIST) {
			return err
		}
	}
	artifact, err := artifacts.OpenDirectory(digest)
	if err != nil {
		return ErrUnsafeTree
	}
	defer artifact.Close()
	return verifyPublished(artifact, snapshot)
}

// Load verifies a captured artifact by its pinned identity. A changed catalog
// pointer or tampered directory cannot substitute different bytes at Apply or
// Work creation time.
func Load(store *corestore.Store, name, identity string) (Snapshot, error) {
	var result Snapshot
	if store == nil || !skillName.MatchString(name) || !digestIdentity.MatchString(identity) {
		return result, ErrUnsafeTree
	}
	root, err := store.OpenSkillsRoot()
	if err != nil {
		return result, err
	}
	defer root.Close()
	skill, err := root.OpenDirectory(name)
	if err != nil {
		return result, ErrUnsafeTree
	}
	defer skill.Close()
	artifacts, err := skill.OpenDirectory("artifacts")
	if err != nil {
		return result, ErrUnsafeTree
	}
	defer artifacts.Close()
	digest := strings.TrimPrefix(identity, "sha256:")
	entries, err := artifacts.Entries()
	if err != nil {
		return result, ErrUnsafeTree
	}
	found := false
	for _, entry := range entries {
		if entry == digest {
			found = true
			break
		}
	}
	if !found {
		return result, ErrUnsafeTree
	}
	artifact, err := artifacts.OpenDirectory(digest)
	if err != nil {
		return result, ErrUnsafeTree
	}
	defer artifact.Close()
	result.Name, result.Identity = name, identity
	if err := inspectPublished(artifact, "", &result); err != nil {
		return Snapshot{}, err
	}
	sort.Slice(result.Files, func(i, j int) bool { return result.Files[i].Path < result.Files[j].Path })
	sort.Strings(result.Directories)
	if err := validateSnapshot(result); err != nil {
		return Snapshot{}, err
	}
	return result, nil
}

func validateSnapshot(snapshot Snapshot) error {
	seen := make(map[string]struct{}, len(snapshot.Files)+len(snapshot.Directories))
	var total int64
	manifest := false
	entries := make([]contracts.DigestEntry, 0, len(snapshot.Files))
	for _, directory := range snapshot.Directories {
		if !validRelative(directory) {
			return ErrUnsafeTree
		}
		if parent := path.Dir(directory); parent != "." {
			if _, exists := seen[parent]; !exists {
				return ErrUnsafeTree
			}
		}
		if _, exists := seen[directory]; exists {
			return ErrUnsafeTree
		}
		seen[directory] = struct{}{}
	}
	for _, file := range snapshot.Files {
		if !validRelative(file.Path) || len(file.Data) > maxFileBytes {
			return ErrUnsafeTree
		}
		if parent := path.Dir(file.Path); parent != "." {
			if _, exists := seen[parent]; !exists {
				return ErrUnsafeTree
			}
		}
		if _, exists := seen[file.Path]; exists {
			return ErrUnsafeTree
		}
		seen[file.Path] = struct{}{}
		if file.Path == "SKILL.md" {
			manifest = true
		}
		total += int64(len(file.Data))
		if total > maxTotalBytes {
			return ErrUnsafeTree
		}
		data := file.Data
		entries = append(entries, contracts.DigestEntry{Path: file.Path, Type: "file", Size: int64(len(data)), Open: func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(data)), nil
		}})
	}
	if !manifest || total != snapshot.TotalBytes {
		return ErrUnsafeTree
	}
	identity, err := contracts.SkillDigest(entries)
	if err != nil || identity != snapshot.Identity {
		return ErrUnsafeTree
	}
	return nil
}

func validRelative(value string) bool {
	if value == "" || path.IsAbs(value) || path.Clean(value) != value {
		return false
	}
	for _, part := range strings.Split(value, "/") {
		if !safefs.ValidFileName(part) {
			return false
		}
	}
	return true
}

func nestedRoot(root *safefs.Root, relative string) (*safefs.Root, bool, error) {
	if relative == "" || relative == "." || path.IsAbs(relative) || path.Clean(relative) != relative {
		return nil, false, ErrUnsafeTree
	}
	current := root
	for _, part := range strings.Split(relative, "/") {
		if !safefs.ValidFileName(part) {
			if current != root {
				current.Close()
			}
			return nil, false, ErrUnsafeTree
		}
		next, err := current.OpenDirectory(part)
		if current != root {
			current.Close()
		}
		if err != nil {
			return nil, false, err
		}
		current = next
	}
	return current, true, nil
}

func verifyPublished(root *safefs.Root, expected Snapshot) error {
	var actual Snapshot
	if err := inspectPublished(root, "", &actual); err != nil {
		return err
	}
	sort.Slice(actual.Files, func(i, j int) bool { return actual.Files[i].Path < actual.Files[j].Path })
	sort.Strings(actual.Directories)
	if len(actual.Files) != len(expected.Files) || len(actual.Directories) != len(expected.Directories) || actual.TotalBytes != expected.TotalBytes {
		return ErrUnsafeTree
	}
	for i := range actual.Files {
		if actual.Files[i].Path != expected.Files[i].Path || !bytes.Equal(actual.Files[i].Data, expected.Files[i].Data) {
			return ErrUnsafeTree
		}
	}
	for i := range actual.Directories {
		if actual.Directories[i] != expected.Directories[i] {
			return ErrUnsafeTree
		}
	}
	return nil
}

func inspectPublished(root *safefs.Root, prefix string, result *Snapshot) error {
	entries, err := root.Entries()
	if err != nil {
		return ErrUnsafeTree
	}
	for _, name := range entries {
		if !safefs.ValidFileName(name) {
			return ErrUnsafeTree
		}
		relative := name
		if prefix != "" {
			relative = prefix + "/" + name
		}
		if root.CheckEntry(name, true) == nil {
			child, err := root.OpenDirectory(name)
			if err != nil {
				return ErrUnsafeTree
			}
			result.Directories = append(result.Directories, relative)
			err = inspectPublished(child, relative, result)
			child.Close()
			if err != nil {
				return err
			}
			continue
		}
		if len(result.Files) >= maxFiles {
			return ErrUnsafeTree
		}
		data, err := root.ReadFile(name, maxFileBytes)
		if err != nil || result.TotalBytes+int64(len(data)) > maxTotalBytes {
			return ErrUnsafeTree
		}
		result.Files = append(result.Files, File{Path: relative, Data: data})
		result.TotalBytes += int64(len(data))
	}
	return nil
}
