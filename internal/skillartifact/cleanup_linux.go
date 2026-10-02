//go:build linux

package skillartifact

import (
	"context"
	"database/sql"
	"strings"

	"github.com/google/uuid"
	"piwork/internal/corestore"
)

// CleanupOrphans removes only Core Skill artifact directories that have no
// catalog artifact row. Callers serialize this with Skill publication so a
// staged, not yet committed import is never mistaken for an orphan.
func CleanupOrphans(store *corestore.Store) error {
	if store == nil {
		return ErrUnsafeTree
	}
	referenced := make(map[string]struct{})
	err := store.Read(context.Background(), func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT skill_name,content_identity FROM managed_skill_artifacts`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var name, identity string
			if err := rows.Scan(&name, &identity); err != nil {
				return err
			}
			referenced[name+"\x00"+identity] = struct{}{}
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	root, err := store.OpenSkillsRoot()
	if err != nil {
		return err
	}
	defer root.Close()
	names, err := root.Entries()
	if err != nil {
		return err
	}
	for _, name := range names {
		if !skillName.MatchString(name) {
			continue
		}
		skill, err := root.OpenDirectory(name)
		if err != nil {
			return err
		}
		children, err := skill.Entries()
		if err != nil {
			skill.Close()
			return err
		}
		hasArtifacts := false
		for _, child := range children {
			if child == "artifacts" {
				hasArtifacts = true
			}
		}
		if !hasArtifacts {
			skill.Close()
			continue
		}
		artifacts, err := skill.OpenDirectory("artifacts")
		if err != nil {
			skill.Close()
			return err
		}
		entries, err := artifacts.Entries()
		if err != nil {
			artifacts.Close()
			skill.Close()
			return err
		}
		for _, entry := range entries {
			if strings.HasPrefix(entry, "stage-") {
				if _, err := uuid.Parse(strings.TrimPrefix(entry, "stage-")); err == nil {
					if err := artifacts.RemoveTree(entry); err != nil {
						artifacts.Close()
						skill.Close()
						return err
					}
				}
				continue
			}
			identity := "sha256:" + entry
			if !digestIdentity.MatchString(identity) {
				continue
			}
			if _, retained := referenced[name+"\x00"+identity]; retained {
				continue
			}
			if err := artifacts.RemoveTree(entry); err != nil {
				artifacts.Close()
				skill.Close()
				return err
			}
		}
		artifacts.Close()
		skill.Close()
		// The name directory is retained for stable ownership; only
		// unreferenced content identities are removed.
	}
	return nil
}
