package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"path"
	"strings"
	"time"

	"github.com/google/uuid"
	"piwork/internal/coreassets"
	"piwork/internal/safefs"
	"piwork/internal/skillartifact"
)

var errBundledSkill = errors.New("built-in Skill artifact is unavailable")

func (a *Application) ensureBundledSkill(ctx context.Context) error {
	var seeded bool
	var current *string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var raw string
		err := tx.QueryRowContext(ctx, `SELECT value_json FROM control_metadata WHERE key='deployment_skill_seeded'`).Scan(&raw)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil || raw != `{"seeded":true}` {
			return errBundledSkill
		}
		seeded = true
		var identity string
		err = tx.QueryRowContext(ctx, `SELECT resolved_digest FROM catalog_entries WHERE id=? AND kind='skill'`, coreassets.DeploymentSkillName).Scan(&identity)
		if errors.Is(err, sql.ErrNoRows) {
			return nil // An operator removed it. Never resurrect its catalog entry.
		}
		if err != nil {
			return err
		}
		current = &identity
		return nil
	}); err != nil {
		return err
	}
	if seeded {
		if current != nil {
			if _, err := skillartifact.Load(a.Store, coreassets.DeploymentSkillName, *current); err != nil {
				return errBundledSkill
			}
		}
		return nil
	}
	files, identity, err := coreassets.DeploymentSkill()
	if err != nil || !strings.HasPrefix(identity, "sha256:") {
		return errBundledSkill
	}
	root, err := a.Store.OpenSkillsRoot()
	if err != nil {
		return errBundledSkill
	}
	defer root.Close()
	skill, err := root.OpenDirectory(coreassets.DeploymentSkillName)
	if err != nil {
		return errBundledSkill
	}
	defer skill.Close()
	artifacts, err := skill.OpenDirectory("artifacts")
	if err != nil {
		return errBundledSkill
	}
	defer artifacts.Close()
	digest := strings.TrimPrefix(identity, "sha256:")
	entries, err := artifacts.Entries()
	if err != nil {
		return errBundledSkill
	}
	exists := false
	for _, entry := range entries {
		if entry == digest {
			exists = true
			break
		}
	}
	if !exists {
		id, err := uuid.NewRandom()
		if err != nil {
			return errBundledSkill
		}
		stageName := "stage-" + id.String()
		stage, err := artifacts.OpenDirectory(stageName)
		if err != nil {
			return errBundledSkill
		}
		var examples *safefs.Root
		for _, file := range files {
			parent := stage
			if path.Dir(file.Path) == "examples" {
				if examples == nil {
					examples, err = stage.OpenDirectory("examples")
					if err != nil {
						break
					}
				}
				parent = examples
			} else if path.Dir(file.Path) != "." {
				err = errBundledSkill
				break
			}
			name := path.Base(file.Path)
			err = parent.AtomicWrite(name, "publish-"+id.String()+".tmp", file.Data)
			if err != nil {
				break
			}
		}
		if examples != nil {
			examples.Close()
		}
		stage.Close()
		if err != nil || artifacts.RenameNoReplace(stageName, digest) != nil {
			return errBundledSkill
		}
	}
	artifact, err := artifacts.OpenDirectory(digest)
	if err != nil {
		return errBundledSkill
	}
	defer artifact.Close()
	if err := verifyBundledSkill(artifact, files); err != nil {
		return err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	var total int64
	for _, file := range files {
		total += int64(len(file.Data))
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		var kind, resolved string
		err := tx.QueryRowContext(ctx, `SELECT kind,resolved_digest FROM catalog_entries WHERE id=?`, coreassets.DeploymentSkillName).Scan(&kind, &resolved)
		if errors.Is(err, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, `INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'skill',?,NULL,?,'{}',1,?,?)`, coreassets.DeploymentSkillName, coreassets.DeploymentSkillName, identity, now, now); err != nil {
				return err
			}
		} else if err != nil || kind != "skill" || resolved != identity {
			return errBundledSkill
		}
		if _, err = tx.ExecContext(ctx, `INSERT OR IGNORE INTO managed_skill_artifacts(skill_name,content_identity,file_count,total_bytes,created_at) VALUES(?,?,?,?,?)`, coreassets.DeploymentSkillName, identity, len(files), total, now); err != nil {
			return err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO control_metadata(key,value_json,updated_at) VALUES('deployment_skill_seeded','{"seeded":true}',?)`, now)
		return err
	})
}

func verifyBundledSkill(artifact *safefs.Root, files []coreassets.SkillFile) error {
	expected := map[string][]byte{}
	for _, file := range files {
		expected[file.Path] = file.Data
	}
	entries, err := artifact.Entries()
	if err != nil || len(entries) != 3 {
		return errBundledSkill
	}
	for _, entry := range entries {
		if entry != "SKILL.md" && entry != "reference.md" && entry != "examples" {
			return errBundledSkill
		}
	}
	for _, name := range []string{"SKILL.md", "reference.md"} {
		content, err := artifact.ReadFile(name, 8<<20)
		if err != nil || !bytes.Equal(content, expected[name]) {
			return errBundledSkill
		}
	}
	examples, err := artifact.OpenDirectory("examples")
	if err != nil {
		return errBundledSkill
	}
	defer examples.Close()
	entries, err = examples.Entries()
	if err != nil || len(entries) != 1 || entries[0] != "python-http.md" {
		return errBundledSkill
	}
	content, err := examples.ReadFile("python-http.md", 8<<20)
	if err != nil || !bytes.Equal(content, expected["examples/python-http.md"]) {
		return errBundledSkill
	}
	return nil
}
