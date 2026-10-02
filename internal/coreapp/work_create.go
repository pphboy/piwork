package coreapp

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/workcontext"
)

// createWork captures selected managed Skills into a Work-owned context before
// accepting the Work. The durable target precedes Docker effects.
func (a *Application) createWork(ctx context.Context, actor identity.Principal, input createWorkInput) (acceptedWorkAction, error) {
	var output acceptedWorkAction
	name, key := input.Name.Value, input.IdempotencyKey.Value
	if actor.IsOperator() || actor.UserID == "" || name == "" || len(name) > 128 || strings.TrimSpace(name) == "" || strings.ContainsRune(name, 0) || key == "" || len(key) > 256 {
		return output, contracts.NewError("INVALID_REQUEST", "")
	}
	if a.ctx.Err() != nil || a.Status().State == "SHUTTING_DOWN" {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	request := map[string]any{"name": name}
	if input.Configuration.Present {
		request["configuration"] = input.Configuration.Value
	}
	if input.BaseImage.Present {
		request["baseImage"] = input.BaseImage.Value
	}
	if input.Skills.Present {
		request["skills"] = input.Skills.Value
	}
	if input.Packages.Present {
		request["packages"] = input.Packages.Value
	}
	if input.AgentsMd.Present {
		request["agentsMd"] = input.AgentsMd.Value
	}
	publicRequest, _ := json.Marshal(request)
	if prior, found, err := a.Store.FindAcceptedMutation(ctx, actor.UserID, "new-work", "create-work", key, string(publicRequest)); err != nil {
		if errors.Is(err, corestore.ErrIdempotencyConflict) {
			return output, contracts.NewError("IDEMPOTENCY_CONFLICT", "")
		}
		return output, err
	} else if found {
		a.enqueueWork(prior.ResourceID)
		return acceptedWorkAction{WorkID: prior.ResourceID, OperationID: prior.OperationID, Reused: true}, nil
	}
	if a.Status().State != "READY" || a.engine == nil || a.inspector == nil {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	_, configured, err := a.Settings.LoadRuntime()
	if err != nil || !configured {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil || defaults.Configuration == nil {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	configuration := *defaults.Configuration
	if input.Configuration.Present {
		configuration, err = contracts.Decode[contracts.WorkConfig](bytes.NewReader(input.Configuration.Value), "WorkConfigSchema", 2<<20)
		if err != nil {
			return output, err
		}
	}
	if input.BaseImage.Present {
		configuration.AgentImage.CatalogId = contracts.ResourceId(input.BaseImage.Value)
	}
	if input.Skills.Present {
		configuration.Skills = append(contracts.SkillSelection{}, input.Skills.Value...)
	}
	if input.Packages.Present {
		configuration.Packages = append(contracts.PiPackageSelection{}, input.Packages.Value...)
	}
	if input.AgentsMd.Present {
		configuration.AgentsMd = input.AgentsMd.Value
	}
	configurationJSON, err := json.Marshal(configuration)
	if err != nil {
		return output, contracts.NewError("INVALID_REQUEST", "")
	}
	if _, err := contracts.Decode[contracts.WorkConfig](bytes.NewReader(configurationJSON), "WorkConfigSchema", 2<<20); err != nil {
		return output, err
	}
	if err := a.validateInitialWorkConfig(ctx, actor.UserID, configuration); err != nil {
		return output, err
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return validateSelectedSkillsTx(tx, configuration.Skills) }); err != nil {
		return output, err
	}
	imageID, profileJSON, sourceRevision, err := a.resolveWorkBinding(ctx, configuration, "", "", true, true)
	if err != nil {
		return output, err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return output, corestore.ErrStorage
	}
	workID, now := "work-"+id.String(), time.Now().UTC().Format(time.RFC3339Nano)
	a.skillMu.Lock()
	defer a.skillMu.Unlock()
	published, err := a.buildWorkContext(ctx, workID, "", true, configuration, imageID, now, nil)
	if err != nil {
		_ = workcontext.RemoveUnaccepted(a.Store, workID)
		return output, packagePublicError(err)
	}
	committed := false
	defer func() {
		if !committed {
			_ = workcontext.RemoveUnaccepted(a.Store, workID)
		}
	}()
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{
		PrincipalID: actor.UserID, WorkScope: "new-work", Kind: "create-work", IdempotencyKey: key,
		RequestJSON: string(publicRequest), TargetVersion: 1, FenceScope: "work", Now: now,
	}, func(tx *sql.Tx, operationID string) (corestore.MutationEffect, error) {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := validateSelectedSkillsTx(tx, configuration.Skills); err != nil {
			return corestore.MutationEffect{}, err
		}
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM (SELECT 1 FROM works WHERE owner_user_id=? AND name=? UNION ALL SELECT 1 FROM work_import_names WHERE owner_user_id=? AND name=?)`, actor.UserID, name, actor.UserID, name).Scan(&count); err != nil {
			return corestore.MutationEffect{}, err
		}
		if count != 0 {
			return corestore.MutationEffect{}, contracts.NewError("CONFLICT", "")
		}
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: workID, OwnerUserID: actor.UserID, Name: name, DesiredState: "running", ObservedState: "provisioning", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := corestore.AssignWorkNetworkName(tx, workID, now); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: workID, Revision: 1, ConfigJSON: string(configurationJSON), ResolvedImageDigest: &imageID, RuntimeProfileJSON: &profileJSON, SourceRuntimeRevision: &sourceRevision, CreatedByUserID: actor.UserID, CreatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		revision := int64(1)
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: published.ID, WorkID: workID, InternalRevision: &revision, ConfigurationJSON: published.ConfigurationJSON, ImageIdentity: imageID, CreatedByUserID: actor.UserID, CreatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE works SET desired_context_id=? WHERE id=?`, published.ID, workID); err != nil {
			return corestore.MutationEffect{}, err
		}
		workLimit := corestore.QuotaLimits{CPUMillis: configuration.Resources.CpuMillis, MemoryBytes: configuration.Resources.MemoryBytes, MaxServices: &configuration.Resources.MaxServices, MaxRetainedVolumes: &configuration.Resources.MaxRetainedVolumes}
		hostLimit := corestore.QuotaLimits{CPUMillis: 128_000, MemoryBytes: 256 * 1024 * 1024 * 1024}
		if err := corestore.ReserveQuota(tx, corestore.QuotaReservation{WorkID: workID, SubjectKind: "agent", SubjectID: "agentd", DesiredCPUMillis: configuration.Resources.AgentCpuMillis, DesiredMemoryBytes: configuration.Resources.AgentMemoryBytes, OccupiedCPUMillis: configuration.Resources.AgentCpuMillis, OccupiedMemoryBytes: configuration.Resources.AgentMemoryBytes, VolumeSlots: 2, UpdatedAt: now}, workLimit, hostLimit); err != nil {
			return corestore.MutationEffect{}, err
		}
		for _, volume := range []struct{ role, logical string }{{"agent-private", "work-private"}, {"workspace", "work-workspace"}} {
			sum := sha256.Sum256([]byte(a.Store.InstallationID() + "\x00" + workID + "\x00" + volume.logical))
			volumeID := "volume-" + hex.EncodeToString(sum[:12])
			if err := corestore.RegisterVolume(tx, corestore.VolumeRecord{ID: volumeID, InstallationID: a.Store.InstallationID(), WorkID: workID, Role: volume.role, RuntimeName: dockerengine.ManagedVolumeName(a.Store.InstallationID(), workID, volume.logical), CreatedAt: now}, &configuration.Resources.MaxRetainedVolumes, nil); err != nil {
				return corestore.MutationEffect{}, err
			}
			if err := corestore.AttachVolumeReference(tx, volumeID, "work", workID); err != nil {
				return corestore.MutationEffect{}, err
			}
		}
		if err := putCapturedStart(tx, startCaptureKey(operationID), published.ID); err != nil {
			return corestore.MutationEffect{}, err
		}
		var diagnosticJSON *string
		if trace := traceFrom(ctx); trace != nil {
			raw, err := json.Marshal(diagnosticEnvelope{CorrelationID: trace.correlation, Result: nil, Diagnostics: trace.preacceptDiagnostics})
			if err != nil {
				return corestore.MutationEffect{}, err
			}
			value := string(raw)
			diagnosticJSON = &value
		}
		return corestore.MutationEffect{ResourceID: workID, WorkID: &workID, ResultJSON: diagnosticJSON}, nil
	})
	if err != nil {
		if errors.Is(err, corestore.ErrQuotaExceeded) {
			return output, contracts.NewError("QUOTA_EXCEEDED", "")
		}
		if errors.Is(err, corestore.ErrIdempotencyConflict) {
			return output, contracts.NewError("IDEMPOTENCY_CONFLICT", "")
		}
		return output, err
	}
	committed = !accepted.Reused
	a.enqueueWork(accepted.ResourceID)
	return acceptedWorkAction{WorkID: accepted.ResourceID, OperationID: accepted.OperationID, Reused: accepted.Reused}, nil
}

func (a *Application) ensureInitialWorkContext(ctx context.Context, workID string) error {
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.DesiredContextID != nil {
		return err
	}
	var configurationJSON, imageID string
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT config_json,resolved_image_digest FROM work_config_revisions WHERE work_id=? AND revision=1`, workID).Scan(&configurationJSON, &imageID)
	})
	if err != nil {
		return err
	}
	configuration, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(configurationJSON), "WorkConfigSchema", 2<<20)
	if err != nil {
		return err
	}
	published, err := workcontext.BuildDefault(a.Store, a.options.DataDirectory, workID, configuration, imageID, work.CreatedAt)
	if err != nil {
		return err
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		revision := int64(1)
		if err := corestore.InsertContext(tx, corestore.ContextSnapshot{SnapshotID: published.ID, WorkID: workID, InternalRevision: &revision, ConfigurationJSON: published.ConfigurationJSON, ImageIdentity: imageID, CreatedByUserID: work.OwnerUserID, CreatedAt: work.CreatedAt}); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE works SET desired_context_id=? WHERE id=? AND desired_context_id IS NULL AND deleted_at IS NULL`, published.ID, workID)
		if err != nil {
			return err
		}
		if n, err := result.RowsAffected(); err != nil || n != 1 {
			return errWorkSuperseded
		}
		return nil
	})
}
