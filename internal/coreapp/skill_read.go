package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
)

func (a *Application) skillRead(w http.ResponseWriter, r *http.Request) (bool, error) {
	const prefix = "/api/v1/skills"
	path := r.URL.EscapedPath()
	if path != prefix && !strings.HasPrefix(path, prefix+"/") {
		return false, nil
	}
	if r.Method != http.MethodGet {
		return false, nil
	}
	if path == prefix {
		skills, err := a.publicSkills(r.Context())
		if err != nil {
			return true, err
		}
		send(w, http.StatusOK, map[string]any{"skills": skills})
		return true, nil
	}
	name, ok := skillPathName(strings.TrimPrefix(path, prefix+"/"))
	if !ok {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	skill, err := a.publicSkill(r.Context(), name)
	if err != nil {
		return true, err
	}
	send(w, http.StatusOK, skill)
	return true, nil
}

func skillPathName(raw string) (string, bool) {
	if raw == "" || strings.Contains(raw, "/") {
		return "", false
	}
	name, err := url.PathUnescape(raw)
	return name, err == nil && name != "" && name != "." && name != ".." && !strings.ContainsAny(name, "/\\%\x00")
}

func (a *Application) publicSkills(ctx context.Context) ([]contracts.PublicSkill, error) {
	result := make([]contracts.PublicSkill, 0)
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT name FROM catalog_entries WHERE kind='skill' AND enabled=1 ORDER BY name`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				return err
			}
			result = append(result, contracts.PublicSkill{Name: contracts.SkillName(name)})
		}
		return rows.Err()
	})
	return result, err
}

func (a *Application) publicSkill(ctx context.Context, name string) (contracts.PublicSkill, error) {
	var enabled bool
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT enabled FROM catalog_entries WHERE kind='skill' AND name=?`, name).Scan(&enabled)
	})
	if errors.Is(err, sql.ErrNoRows) || err == nil && !enabled {
		return contracts.PublicSkill{}, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return contracts.PublicSkill{}, err
	}
	return contracts.PublicSkill{Name: contracts.SkillName(name)}, nil
}

func (a *Application) operatorSkills(ctx context.Context) ([]contracts.OperatorSkill, error) {
	result := make([]contracts.OperatorSkill, 0)
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT c.name,c.enabled,m.file_count,m.total_bytes,c.created_at,c.updated_at
			FROM catalog_entries c JOIN managed_skill_artifacts m ON m.skill_name=c.id AND m.content_identity=c.resolved_digest
			WHERE c.kind='skill' ORDER BY c.name`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var skill contracts.OperatorSkill
			if err := rows.Scan(&skill.Name, &skill.Enabled, &skill.FileCount, &skill.TotalBytes, &skill.CreatedAt, &skill.UpdatedAt); err != nil {
				return err
			}
			result = append(result, skill)
		}
		return rows.Err()
	})
	return result, err
}

func (a *Application) operatorSkill(ctx context.Context, name string) (contracts.OperatorSkill, error) {
	var skill contracts.OperatorSkill
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT c.name,c.enabled,m.file_count,m.total_bytes,c.created_at,c.updated_at
			FROM catalog_entries c JOIN managed_skill_artifacts m ON m.skill_name=c.id AND m.content_identity=c.resolved_digest
			WHERE c.kind='skill' AND c.name=?`, name).Scan(&skill.Name, &skill.Enabled, &skill.FileCount, &skill.TotalBytes, &skill.CreatedAt, &skill.UpdatedAt)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return contracts.OperatorSkill{}, contracts.NewError("NOT_FOUND", "")
	}
	return skill, err
}
