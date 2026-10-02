package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workaccess"
	"piwork/internal/workcontext"
)

type setWorkAgentsInput struct {
	AgentsMd contracts.Field[string] `json:"agentsMd"`
}
type setWorkSkillsInput struct {
	Skills contracts.Field[contracts.SkillSelection] `json:"skills"`
}
type setWorkPackagesInput struct {
	Packages contracts.Field[contracts.PiPackageSelection] `json:"packages"`
}

func (a *Application) workConfigurationSave(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	const prefix = "/api/v1/works/"
	if r.Method != http.MethodPut || !strings.HasPrefix(r.URL.EscapedPath(), prefix) {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), prefix), "/")
	full := len(parts) == 2 && parts[1] == "configuration"
	field := len(parts) == 3 && parts[1] == "configuration" && (parts[2] == "agents" || parts[2] == "skills" || parts[2] == "packages")
	if !full && !field {
		return false, nil
	}
	id, err := url.PathUnescape(parts[0])
	if err != nil || id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\%\x00") {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	work, err := workaccess.Work(r.Context(), a.Store, actor, id, workaccess.Control)
	if err != nil {
		return true, err
	}
	var update func(contracts.WorkConfig) (contracts.WorkConfig, error)
	if full {
		body, err := readJSON[struct {
			Configuration contracts.Field[json.RawMessage] `json:"configuration"`
		}](r)
		if err != nil {
			return true, err
		}
		if !body.Configuration.Present || body.Configuration.Null {
			return true, contracts.NewError("INVALID_REQUEST", "configuration")
		}
		config, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(body.Configuration.Value), "WorkConfigSchema", 2<<20)
		if err != nil {
			return true, contracts.NewError("INVALID_CONFIGURATION", "configuration")
		}
		update = func(contracts.WorkConfig) (contracts.WorkConfig, error) { return config, nil }
	} else {
		switch parts[2] {
		case "agents":
			body, err := readJSON[setWorkAgentsInput](r)
			if err != nil {
				return true, err
			}
			if !body.AgentsMd.Present || body.AgentsMd.Null || len(body.AgentsMd.Value) > 256<<10 {
				return true, contracts.NewError("INVALID_REQUEST", "agentsMd")
			}
			update = func(config contracts.WorkConfig) (contracts.WorkConfig, error) {
				config.AgentsMd = body.AgentsMd.Value
				return config, nil
			}
		case "skills":
			body, err := readJSON[setWorkSkillsInput](r)
			if err != nil {
				return true, err
			}
			if !body.Skills.Present || body.Skills.Null || len(body.Skills.Value) > 128 {
				return true, contracts.NewError("INVALID_REQUEST", "skills")
			}
			update = func(config contracts.WorkConfig) (contracts.WorkConfig, error) {
				config.Skills = append(contracts.SkillSelection{}, body.Skills.Value...)
				return config, nil
			}
		case "packages":
			body, err := readJSON[setWorkPackagesInput](r)
			if err != nil {
				return true, err
			}
			if !body.Packages.Present || body.Packages.Null || len(body.Packages.Value) > 64 {
				return true, contracts.NewError("INVALID_REQUEST", "packages")
			}
			update = func(config contracts.WorkConfig) (contracts.WorkConfig, error) {
				config.Packages = append(contracts.PiPackageSelection{}, body.Packages.Value...)
				return config, nil
			}
		}
	}
	view, err := a.saveBasicWorkConfiguration(r.Context(), actor, id, work.OwnerUserID, field && parts[2] == "skills", full, update)
	if err != nil {
		return true, err
	}
	send(w, http.StatusOK, view)
	return true, nil
}

func (a *Application) saveBasicWorkConfiguration(ctx context.Context, actor identity.Principal, workID, ownerID string, reselectSkills, full bool, update func(contracts.WorkConfig) (contracts.WorkConfig, error), gates ...func(*sql.Tx) error) (contracts.WorkConfigurationView, error) {
	if a.ctx.Err() != nil {
		return contracts.WorkConfigurationView{}, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	for attempt := 0; attempt < 8; attempt++ {
		state, err := a.Store.Configuration(ctx, workID)
		if errors.Is(err, corestore.ErrNotFound) {
			return contracts.WorkConfigurationView{}, contracts.NewError("NOT_FOUND", "")
		}
		if err != nil {
			return contracts.WorkConfigurationView{}, err
		}
		current, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
		if err != nil {
			return contracts.WorkConfigurationView{}, corestore.ErrStorage
		}
		config, err := update(current)
		if err != nil {
			return contracts.WorkConfigurationView{}, err
		}
		if full {
			if err := a.validateWorkConfig(ctx, ownerID, workID, config); err != nil {
				return contracts.WorkConfigurationView{}, err
			}
			reselectSkills = !slices.Equal(current.Skills, config.Skills)
		}
		encoded, err := json.Marshal(config)
		if err != nil {
			return contracts.WorkConfigurationView{}, contracts.NewError("INVALID_REQUEST", "")
		}
		if _, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(encoded), "WorkConfigSchema", 2<<20); err != nil {
			return contracts.WorkConfigurationView{}, err
		}
		if state.DesiredContextID == nil || state.DesiredRevision >= contracts.MaxSafeInteger {
			return contracts.WorkConfigurationView{}, contracts.NewError("CONFLICT", "")
		}
		var imageID, profileJSON string
		var sourceRevision sql.NullInt64
		err = a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT r.resolved_image_digest,r.runtime_profile_json,r.source_runtime_revision FROM work_config_revisions r
				JOIN work_context_snapshots c ON c.work_id=r.work_id AND c.internal_revision=r.revision AND c.snapshot_id=?
				WHERE r.work_id=? AND r.revision=?`, *state.DesiredContextID, workID, state.DesiredRevision).Scan(&imageID, &profileJSON, &sourceRevision)
		})
		if err != nil || imageID == "" || profileJSON == "" {
			return contracts.WorkConfigurationView{}, contracts.NewError("CONFLICT", "")
		}
		imageChanged := full && config.AgentImage.CatalogId != current.AgentImage.CatalogId
		modelChanged := full && config.ModelRef != current.ModelRef
		if imageChanged || modelChanged {
			var revision int64
			imageID, profileJSON, revision, err = a.resolveWorkBinding(ctx, config, imageID, profileJSON, imageChanged, modelChanged)
			if err != nil {
				return contracts.WorkConfigurationView{}, err
			}
			sourceRevision = sql.NullInt64{Int64: revision, Valid: true}
		}
		now := time.Now().UTC().Format(time.RFC3339Nano)
		a.skillMu.Lock()
		published, err := a.buildWorkContext(ctx, workID, *state.DesiredContextID, reselectSkills, config, imageID, now, nil)
		if err != nil {
			a.skillMu.Unlock()
			return contracts.WorkConfigurationView{}, packagePublicError(err)
		}
		err = a.Store.Write(ctx, func(tx *sql.Tx) error {
			for _, gate := range gates {
				if err := gate(tx); err != nil {
					return err
				}
			}
			if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
				return err
			}
			work, err := corestore.ReadWork(tx, workID, false)
			if errors.Is(err, corestore.ErrNotFound) {
				return contracts.NewError("NOT_FOUND", "")
			}
			if err != nil {
				return err
			}
			if work.OwnerUserID != actor.UserID && actor.Role != "admin" {
				return contracts.NewError("NOT_FOUND", "")
			}
			if work.DesiredState == "deleted" {
				return contracts.NewError("CONFLICT", "")
			}
			if err := corestore.AssertWorkMutable(tx, workID); err != nil {
				return err
			}
			if work.DesiredRevision != state.DesiredRevision || work.DesiredContextID == nil || *work.DesiredContextID != *state.DesiredContextID {
				return corestore.ErrRevisionConflict
			}
			if reselectSkills {
				if err := validateSelectedSkillsTx(tx, config.Skills); err != nil {
					return err
				}
			}
			if full {
				if err := validateRequiredServicesTx(tx, workID, config); err != nil {
					return err
				}
				if err := validateWorkCapacityTx(tx, workID, config); err != nil {
					return err
				}
				for _, changed := range []struct {
					check bool
					id    contracts.ResourceId
					kind  string
				}{{imageChanged, config.AgentImage.CatalogId, "agent_image"}, {modelChanged, config.ModelRef, "model"}} {
					if !changed.check {
						continue
					}
					var kind string
					var enabled bool
					if err := tx.QueryRowContext(ctx, `SELECT kind,enabled FROM catalog_entries WHERE id=?`, changed.id).Scan(&kind, &enabled); err != nil || kind != changed.kind || !enabled {
						return contracts.NewError("INVALID_CONFIGURATION", "configuration")
					}
				}
			}
			revision := state.DesiredRevision + 1
			var source *int64
			if sourceRevision.Valid {
				source = &sourceRevision.Int64
			}
			if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: workID, Revision: revision, ConfigJSON: published.ConfigurationJSON, ResolvedImageDigest: &imageID, RuntimeProfileJSON: &profileJSON, SourceRuntimeRevision: source, CreatedByUserID: actor.UserID, CreatedAt: now}); err != nil {
				return err
			}
			if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: published.ID, WorkID: workID, InternalRevision: &revision, ConfigurationJSON: published.ConfigurationJSON, ImageIdentity: imageID, CreatedByUserID: actor.UserID, CreatedAt: now}); err != nil {
				return err
			}
			result, err := tx.ExecContext(ctx, `UPDATE works SET desired_revision=?,desired_context_id=?,updated_at=? WHERE id=? AND desired_revision=? AND desired_context_id=? AND deleted_at IS NULL`, revision, published.ID, now, workID, state.DesiredRevision, *state.DesiredContextID)
			if err != nil {
				return err
			}
			if count, err := result.RowsAffected(); err != nil || count != 1 {
				return corestore.ErrRevisionConflict
			}
			return nil
		})
		a.skillMu.Unlock()
		if err != nil {
			if cleanupErr := workcontext.RemoveCandidate(a.Store, workID, published.ID); cleanupErr != nil {
				return contracts.WorkConfigurationView{}, corestore.ErrStorage
			}
			if errors.Is(err, corestore.ErrRevisionConflict) {
				continue
			}
			if errors.Is(err, corestore.ErrSnapshotBusy) {
				return contracts.WorkConfigurationView{}, contracts.NewError("WORK_SNAPSHOT_BUSY", "")
			}
			return contracts.WorkConfigurationView{}, err
		}
		return a.configurationView(ctx, actor, workID)
	}
	return contracts.WorkConfigurationView{}, contracts.NewError("REVISION_CONFLICT", "")
}
