package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"path/filepath"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
)

func (a *Application) importSkill(ctx context.Context, actor identity.Principal, sourcePath, expectedName string, update bool) (contracts.OperatorSkill, error) {
	var zero contracts.OperatorSkill
	if err := a.Identity.AuthorizeAdministrator(ctx, actor); err != nil {
		return zero, err
	}
	if sourcePath == "" {
		return zero, contracts.NewError("INVALID_REQUEST", "path")
	}
	snapshot, err := skillartifact.Scan(sourcePath, expectedName)
	if err != nil {
		if update && filepath.IsAbs(sourcePath) && filepath.Base(filepath.Clean(sourcePath)) != expectedName {
			return zero, contracts.NewError("SKILL_NAME_MISMATCH", "")
		}
		return zero, contracts.NewError("INVALID_REQUEST", "path")
	}
	skill, err := a.publishSkillSnapshot(ctx, actor, snapshot, update)
	if err != nil {
		_, view := contracts.ProjectError(err)
		if !update && view.Code == "CONFLICT" {
			return zero, contracts.NewError("SKILL_ALREADY_EXISTS", "")
		}
	}
	return skill, err
}

func (a *Application) publishSkillSnapshot(ctx context.Context, actor identity.Principal, snapshot skillartifact.Snapshot, update bool) (contracts.OperatorSkill, error) {
	var zero contracts.OperatorSkill
	if err := a.Identity.AuthorizeAdministrator(ctx, actor); err != nil {
		return zero, err
	}
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	defer func() {
		if skillartifact.CleanupOrphans(a.Store) != nil {
			log.Print("piwork: Skill artifact cleanup is pending")
		}
	}()
	if err := skillartifact.Publish(a.Store, snapshot); err != nil {
		return zero, contracts.NewError("INVALID_REQUEST", "path")
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		var kind string
		lookup := tx.QueryRowContext(ctx, `SELECT kind FROM catalog_entries WHERE id=?`, snapshot.Name).Scan(&kind)
		if update {
			if errors.Is(lookup, sql.ErrNoRows) {
				return contracts.NewError("NOT_FOUND", "")
			}
			if lookup != nil || kind != "skill" {
				return contracts.NewError("CONFLICT", "")
			}
		} else if lookup == nil {
			return contracts.NewError("CONFLICT", "")
		} else if !errors.Is(lookup, sql.ErrNoRows) {
			return lookup
		}
		if !update {
			if _, err := tx.ExecContext(ctx, `INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'skill',?,NULL,?,'{}',1,?,?)`, snapshot.Name, snapshot.Name, snapshot.Identity, now, now); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO managed_skill_artifacts(skill_name,content_identity,file_count,total_bytes,created_at) VALUES(?,?,?,?,?) ON CONFLICT(skill_name,content_identity) DO UPDATE SET file_count=excluded.file_count,total_bytes=excluded.total_bytes`, snapshot.Name, snapshot.Identity, len(snapshot.Files), snapshot.TotalBytes, now); err != nil {
			return err
		}
		if update {
			_, err := tx.ExecContext(ctx, `UPDATE catalog_entries SET resolved_digest=?,mutable_reference=NULL,updated_at=? WHERE id=? AND kind='skill'`, snapshot.Identity, now, snapshot.Name)
			if err != nil {
				return err
			}
			_, err = tx.ExecContext(ctx, `DELETE FROM managed_skill_artifacts WHERE skill_name=? AND content_identity<>?`, snapshot.Name, snapshot.Identity)
			return err
		}
		return nil
	})
	if err != nil {
		return zero, err
	}
	return a.operatorSkill(ctx, snapshot.Name)
}

func defaultSkillSelectedTx(tx *sql.Tx, name string) (bool, error) {
	var selected bool
	err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM control_metadata m, json_each(m.value_json,'$.configuration.skills') AS skill WHERE m.key='default_work_configuration' AND skill.value=?)`, name).Scan(&selected)
	return selected, err
}

func (a *Application) setSkillEnabled(ctx context.Context, actor identity.Principal, name string, enabled bool) (contracts.OperatorSkill, error) {
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		if !enabled {
			selected, err := defaultSkillSelectedTx(tx, name)
			if err != nil {
				return err
			}
			if selected {
				return contracts.NewError("CONFLICT", "skills")
			}
		}
		result, err := tx.ExecContext(ctx, `UPDATE catalog_entries SET enabled=?,updated_at=? WHERE id=? AND kind='skill'`, enabled, time.Now().UTC().Format(time.RFC3339Nano), name)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return contracts.NewError("NOT_FOUND", "")
		}
		return nil
	}); err != nil {
		return contracts.OperatorSkill{}, err
	}
	return a.operatorSkill(ctx, name)
}

func (a *Application) removeSkill(ctx context.Context, actor identity.Principal, name string) error {
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		selected, err := defaultSkillSelectedTx(tx, name)
		if err != nil {
			return err
		}
		if selected {
			return contracts.NewError("CONFLICT", "skills")
		}
		result, err := tx.ExecContext(ctx, `DELETE FROM catalog_entries WHERE id=? AND kind='skill'`, name)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return contracts.NewError("NOT_FOUND", "")
		}
		return nil
	})
	if err != nil {
		return err
	}
	if skillartifact.CleanupOrphans(a.Store) != nil {
		log.Print("piwork: Skill artifact cleanup is pending")
	}
	return nil
}
