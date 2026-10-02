package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

type defaultWorkPatch struct {
	BaseImage contracts.Field[string]                       `json:"baseImage"`
	Skills    contracts.Field[contracts.SkillSelection]     `json:"skills"`
	Packages  contracts.Field[contracts.PiPackageSelection] `json:"packages"`
	AgentsMd  contracts.Field[string]                       `json:"agentsMd"`
}

type defaultWorkOperatorInput struct {
	Patch contracts.Field[defaultWorkPatch] `json:"patch"`
}

func adminDefaultPatch(input contracts.AdminDefaultWorkPatch) defaultWorkPatch {
	result := defaultWorkPatch{BaseImage: input.BaseImage, Skills: input.Skills, AgentsMd: input.AgentsMd}
	if input.Packages.Present {
		result.Packages = contracts.Supplied(contracts.PiPackageSelection{})
		for _, name := range input.Packages.Value {
			result.Packages.Value = append(result.Packages.Value, contracts.PiPackageSelectionEntry{Name: name, Enabled: true})
		}
	}
	return result
}

func validDefaultPatch(patch defaultWorkPatch) error {
	if !patch.BaseImage.Present && !patch.Skills.Present && !patch.Packages.Present && !patch.AgentsMd.Present {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	if patch.BaseImage.Null || patch.Skills.Null || patch.Packages.Null || patch.AgentsMd.Null {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	if patch.BaseImage.Present && (strings.TrimSpace(patch.BaseImage.Value) == "" || len(patch.BaseImage.Value) > 4096) {
		return contracts.NewError("INVALID_REQUEST", "baseImage")
	}
	if patch.AgentsMd.Present && len(patch.AgentsMd.Value) > 256<<10 {
		return contracts.NewError("INVALID_REQUEST", "agentsMd")
	}
	if patch.Skills.Present && len(patch.Skills.Value) > 128 {
		return contracts.NewError("INVALID_REQUEST", "skills")
	}
	if patch.Packages.Present && len(patch.Packages.Value) > 64 {
		return contracts.NewError("INVALID_REQUEST", "packages")
	}
	return nil
}

func (a *Application) patchDefaultWork(ctx context.Context, actor identity.Principal, patch defaultWorkPatch) (contracts.AdminDefaultWorkView, error) {
	if err := validDefaultPatch(patch); err != nil {
		return contracts.AdminDefaultWorkView{}, err
	}
	_, err := a.Store.UpdateDefaultWork(ctx, func(tx *sql.Tx, current corestore.DefaultWorkConfiguration) (contracts.WorkConfig, error) {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return contracts.WorkConfig{}, err
		}
		config := *current.Configuration
		if patch.BaseImage.Present {
			reference := patch.BaseImage.Value
			sum := sha256.Sum256([]byte(reference))
			id := "image-" + hex.EncodeToString(sum[:12])
			var kind, prior string
			queryErr := tx.QueryRowContext(ctx, `SELECT kind,mutable_reference FROM catalog_entries WHERE id=?`, id).Scan(&kind, &prior)
			if errors.Is(queryErr, sql.ErrNoRows) {
				now := time.Now().UTC().Format(time.RFC3339Nano)
				_, queryErr = tx.ExecContext(ctx, `INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'agent_image',?,?,NULL,?,1,?,?)`, id, reference, reference, `{"version":1,"source":"default-work"}`, now, now)
			} else if queryErr == nil && (kind != "agent_image" || prior != reference) {
				return contracts.WorkConfig{}, contracts.NewError("CONFLICT", "")
			}
			if queryErr != nil {
				return contracts.WorkConfig{}, queryErr
			}
			config.AgentImage.CatalogId = contracts.ResourceId(id)
		}
		if patch.Skills.Present {
			config.Skills = append(contracts.SkillSelection{}, patch.Skills.Value...)
		}
		if patch.Packages.Present {
			config.Packages = append(contracts.PiPackageSelection{}, patch.Packages.Value...)
		}
		if patch.AgentsMd.Present {
			config.AgentsMd = patch.AgentsMd.Value
		}
		if err := validateSelectedPackagesTx(tx, config.Packages); err != nil {
			return contracts.WorkConfig{}, err
		}
		if err := validateSelectedSkillsTx(tx, config.Skills); err != nil {
			return contracts.WorkConfig{}, err
		}
		return config, nil
	})
	if err != nil {
		return contracts.AdminDefaultWorkView{}, err
	}
	return a.defaultWorkView(ctx)
}
