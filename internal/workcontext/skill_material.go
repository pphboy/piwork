package workcontext

import (
	"context"
	"database/sql"
	"encoding/json"
	"path"
	"path/filepath"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/safefs"
	"piwork/internal/skillartifact"
)

func loadPriorSkills(store *corestore.Store, dataDirectory, workID, priorContextID string, names contracts.SkillSelection) ([]skillartifact.Snapshot, error) {
	if store == nil || !safefs.ValidFileName(workID) || !safefs.ValidFileName(priorContextID) {
		return nil, ErrContext
	}
	works, err := store.OpenWorksRoot()
	if err != nil {
		return nil, ErrContext
	}
	defer works.Close()
	work, err := works.OpenDirectory(workID)
	if err != nil {
		return nil, ErrContext
	}
	defer work.Close()
	contexts, err := work.OpenDirectory("contexts")
	if err != nil {
		return nil, ErrContext
	}
	defer contexts.Close()
	prior, err := contexts.OpenPublishedDirectory(priorContextID)
	if err != nil {
		return nil, ErrContext
	}
	defer prior.Close()
	raw, err := prior.ReadPublishedFile("metadata.json", 2<<20)
	if err != nil {
		return nil, ErrContext
	}
	var metadata contracts.WorkContextMetadata
	if json.Unmarshal(raw, &metadata) != nil || metadata.WorkId != workID || metadata.SnapshotId != priorContextID || len(metadata.Skills) != len(names) {
		return nil, ErrContext
	}
	selected := make([]skillartifact.Snapshot, 0, len(names))
	for i, name := range names {
		if string(name) != metadata.Skills[i].Name || !safefs.ValidFileName(string(name)) {
			return nil, ErrContext
		}
		root := filepath.Join(dataDirectory, "works", workID, "contexts", priorContextID, "skills", string(name))
		snapshot, err := skillartifact.Scan(root, string(name))
		if err != nil || snapshot.Identity != metadata.Skills[i].Identity {
			return nil, ErrContext
		}
		selected = append(selected, snapshot)
	}
	return selected, nil
}

func loadSelectedSkills(store *corestore.Store, names contracts.SkillSelection) ([]skillartifact.Snapshot, error) {
	result := make([]skillartifact.Snapshot, 0, len(names))
	seen := make(map[string]struct{}, len(names))
	for _, selected := range names {
		name := string(selected)
		if _, duplicate := seen[name]; duplicate {
			return nil, ErrContext
		}
		seen[name] = struct{}{}
		var identity string
		if err := store.Read(context.Background(), func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT resolved_digest FROM catalog_entries WHERE id=? AND name=? AND kind='skill' AND enabled=1`, name, name).Scan(&identity)
		}); err != nil {
			return nil, ErrContext
		}
		artifact, err := skillartifact.Load(store, name, identity)
		if err != nil {
			return nil, ErrContext
		}
		result = append(result, artifact)
	}
	return result, nil
}

func writeSelectedSkills(root *safefs.Root, selected []skillartifact.Snapshot, id string) error {
	for _, snapshot := range selected {
		skill, err := root.OpenDirectory(snapshot.Name)
		if err != nil {
			return err
		}
		for _, relative := range snapshot.Directories {
			child, err := contextDirectory(skill, relative)
			if err != nil {
				skill.Close()
				return err
			}
			child.Close()
		}
		for _, file := range snapshot.Files {
			parent := skill
			if directory := path.Dir(file.Path); directory != "." {
				parent, err = contextDirectory(skill, directory)
				if err != nil {
					skill.Close()
					return err
				}
			}
			err = parent.AtomicMaterialWrite(path.Base(file.Path), "publish-"+id+".tmp", file.Data, 0644)
			if parent != skill {
				parent.Close()
			}
			if err != nil {
				skill.Close()
				return err
			}
		}
		if err := skill.Sync(); err != nil {
			skill.Close()
			return err
		}
		skill.Close()
	}
	return nil
}

func contextDirectory(root *safefs.Root, relative string) (*safefs.Root, error) {
	current := root
	for _, part := range strings.Split(relative, "/") {
		if !safefs.ValidFileName(part) {
			if current != root {
				current.Close()
			}
			return nil, ErrContext
		}
		next, err := current.OpenDirectory(part)
		if current != root {
			current.Close()
		}
		if err != nil {
			return nil, err
		}
		current = next
	}
	return current, nil
}
