package workcontext

import (
	"bytes"
	"io"
	"path/filepath"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/safefs"
	"piwork/internal/skillartifact"
)

// SkillEdit replaces the complete UTF-8 text of one existing file in a Work
// owned Skill. Files are never created, removed or renamed by an edit.
type SkillEdit struct {
	SkillName string
	Path      string
	Text      string
}

// SkillFile is one bounded file read from an immutable published context.
type SkillFile struct {
	Path string
	Data []byte
}

// BuildWithPackagesAndEdits republishes an existing context while preserving
// every Skill already owned by the Work. Only names that are absent from the
// prior context are captured from the enabled Core catalog, unless the caller
// supplies a validated import for that exact new name. Edits apply to existing
// files of either origin.
func BuildWithPackagesAndEdits(store *corestore.Store, dataDirectory, workID, priorContextID string, configuration contracts.WorkConfig, edits []SkillEdit, imports map[string]skillartifact.Snapshot, imageID, createdAt string, sources []PackageSource) (Published, error) {
	if priorContextID == "" || !safefs.ValidFileName(priorContextID) {
		return Published{}, ErrContext
	}
	skills, err := loadSkillsForEdit(store, dataDirectory, workID, priorContextID, configuration.Skills, edits, imports)
	if err != nil {
		return Published{}, err
	}
	return buildWithSkills(store, dataDirectory, workID, configuration, imageID, createdAt, skills, sources)
}

// ReadSkillFiles reads one Skill tree from a published context. The immutable
// context is verified with the same no-follow rules used when it was written.
func ReadSkillFiles(store *corestore.Store, dataDirectory, workID, contextID, name string) ([]SkillFile, error) {
	if store == nil || !safefs.ValidFileName(workID) || !safefs.ValidFileName(contextID) || !safefs.ValidFileName(name) {
		return nil, ErrContext
	}
	metadata, err := Metadata(store, workID, contextID)
	if err != nil {
		return nil, ErrContext
	}
	identity := ""
	for _, skill := range metadata.Skills {
		if skill.Name == name {
			identity = skill.Identity
			break
		}
	}
	if identity == "" {
		return nil, ErrContext
	}
	root := filepath.Join(dataDirectory, "works", workID, "contexts", contextID, "skills", name)
	snapshot, err := skillartifact.Scan(root, name)
	if err != nil || snapshot.Identity != identity {
		return nil, ErrContext
	}
	files := make([]SkillFile, 0, len(snapshot.Files))
	for _, file := range snapshot.Files {
		files = append(files, SkillFile{Path: file.Path, Data: file.Data})
	}
	return files, nil
}

func loadSkillsForEdit(store *corestore.Store, dataDirectory, workID, priorContextID string, names contracts.SkillSelection, edits []SkillEdit, imports map[string]skillartifact.Snapshot) ([]skillartifact.Snapshot, error) {
	metadata, err := Metadata(store, workID, priorContextID)
	if err != nil {
		return nil, ErrContext
	}
	prior := make(map[string]string, len(metadata.Skills))
	for _, skill := range metadata.Skills {
		if !safefs.ValidFileName(skill.Name) {
			return nil, ErrContext
		}
		if _, duplicate := prior[skill.Name]; duplicate {
			return nil, ErrContext
		}
		prior[skill.Name] = skill.Identity
	}
	result := make([]skillartifact.Snapshot, 0, len(names))
	index := make(map[string]int, len(names))
	for _, selected := range names {
		name := string(selected)
		if _, duplicate := index[name]; duplicate {
			return nil, ErrContext
		}
		index[name] = len(result)
		var snapshot skillartifact.Snapshot
		if identity, owned := prior[name]; owned {
			root := filepath.Join(dataDirectory, "works", workID, "contexts", priorContextID, "skills", name)
			snapshot, err = skillartifact.Scan(root, name)
			if err != nil || snapshot.Identity != identity {
				return nil, ErrContext
			}
		} else if imported, supplied := imports[name]; supplied {
			if imported.Name != name || len(imported.Files) == 0 {
				return nil, ErrContext
			}
			snapshot = imported
		} else {
			added, err := loadSelectedSkills(store, contracts.SkillSelection{selected})
			if err != nil || len(added) != 1 {
				return nil, ErrContext
			}
			snapshot = added[0]
		}
		result = append(result, snapshot)
	}
	if err := applySkillEdits(result, index, edits); err != nil {
		return nil, err
	}
	return result, nil
}

func applySkillEdits(skills []skillartifact.Snapshot, index map[string]int, edits []SkillEdit) error {
	seen := make(map[string]struct{}, len(edits))
	for _, edit := range edits {
		position, exists := index[edit.SkillName]
		if !exists {
			return ErrContext
		}
		target := edit.SkillName + "\x00" + edit.Path
		if _, duplicate := seen[target]; duplicate {
			return ErrContext
		}
		seen[target] = struct{}{}
		data := []byte(edit.Text)
		if !editableText(data) {
			return contracts.NewError("INVALID_REQUEST", "skillFiles")
		}
		files := skills[position].Files
		found := false
		total := int64(0)
		for i := range files {
			if files[i].Path == edit.Path {
				if !editableText(files[i].Data) {
					return contracts.NewError("INVALID_REQUEST", "skillFiles")
				}
				files[i].Data = data
				found = true
			}
			total += int64(len(files[i].Data))
		}
		if !found {
			return ErrContext
		}
		skills[position].TotalBytes = total
		identity, err := snapshotIdentity(files)
		if err != nil {
			return ErrContext
		}
		skills[position].Identity = identity
	}
	return nil
}

func editableText(data []byte) bool {
	return len(data) <= 1<<20 && utf8.Valid(data) && bytes.IndexByte(data, 0) < 0
}

func snapshotIdentity(files []skillartifact.File) (string, error) {
	entries := make([]contracts.DigestEntry, 0, len(files))
	for _, file := range files {
		data := file.Data
		entries = append(entries, contracts.DigestEntry{Path: file.Path, Type: "file", Size: int64(len(data)), Open: func() (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(data)), nil
		}})
	}
	return contracts.SkillDigest(entries)
}
