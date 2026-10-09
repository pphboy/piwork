package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/workaccess"
	"piwork/internal/workcontext"
	"piwork/internal/workruntime"
)

type workApplyWorker struct {
	control int64
	cancel  context.CancelFunc
}

func (a *Application) cancelWorkApply(workID string, newControl int64) {
	if value, exists := a.workApplyWorkers.Load(workID); exists {
		worker := value.(*workApplyWorker)
		if worker.control < newControl {
			worker.cancel()
		}
	}
}

const applyOperationKind = "apply-work-configuration"

// This private plan is committed with acceptance. Neither later Save nor
// installation defaults can replace its captured candidate or rollback target.
type workApplyPlan struct {
	WorkID            string                    `json:"workId"`
	ContextID         string                    `json:"contextId"`
	Revision          int64                     `json:"revision"`
	PriorContextID    *string                   `json:"priorContextId"`
	PriorRevision     *int64                    `json:"priorRevision"`
	DesiredState      string                    `json:"desiredState"`
	Control           int64                     `json:"control"`
	Stage             string                    `json:"stage"`
	Generation        int64                     `json:"generation"`
	InstanceID        string                    `json:"instanceId"`
	ErrorCode         string                    `json:"errorCode,omitempty"`
	ErrorStage        string                    `json:"errorStage,omitempty"`
	PrimaryDiagnostic *contracts.SafeDiagnostic `json:"primaryDiagnostic,omitempty"`
	HistoryBackup     *applyHistoryBackup       `json:"historyBackup,omitempty"`
	HistoryRecovered  bool                      `json:"historyRecovered,omitempty"`
}

func applyPlanKey(id string) string { return "work_apply_" + strings.ReplaceAll(id, "-", "_") }
func applyRemovalKey(workID string) string {
	return "work_agent_removal_" + strings.ReplaceAll(workID, "-", "_")
}
func putApplyPlan(tx *sql.Tx, id string, plan workApplyPlan) error {
	data, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, applyPlanKey(id), string(data), packageNow())
	return err
}
func (a *Application) readApplyPlan(ctx context.Context, operation corestore.OperationRecord) (workApplyPlan, error) {
	var plan workApplyPlan
	raw, err := a.Store.ControlMetadata(ctx, applyPlanKey(operation.ID))
	if err != nil {
		return plan, err
	}
	if strictMetadata(raw, &plan) != nil || operation.WorkID == nil || plan.WorkID != *operation.WorkID || plan.Control != operation.TargetVersion || plan.Revision < 1 || plan.ContextID == "" || plan.DesiredState != "running" && plan.DesiredState != "stopped" {
		return plan, corestore.ErrStorage
	}
	switch plan.Stage {
	case "captured", "prepared", "replacing", "starting", "validated", "rollback":
	default:
		return plan, corestore.ErrStorage
	}
	return plan, nil
}
func (a *Application) saveApplyPlan(ctx context.Context, id string, plan workApplyPlan) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		var control int64
		if err := tx.QueryRow(`SELECT control_version FROM works WHERE id=? AND deleted_at IS NULL`, plan.WorkID).Scan(&control); err != nil {
			return err
		}
		if control != plan.Control && (plan.HistoryBackup == nil || plan.HistoryBackup.RecoveryControl != control || control <= plan.Control) {
			return errWorkSuperseded
		}
		if plan.HistoryBackup != nil && (plan.HistoryBackup.State == "planned" || plan.HistoryBackup.State == "saved") {
			raw, _ := json.Marshal(map[string]any{"operationId": id, "control": plan.Control})
			if _, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", pendingHistoryKey(plan.WorkID), string(raw), packageNow()); err != nil {
				return err
			}
		} else {
			if _, err := tx.Exec("DELETE FROM control_metadata WHERE key=? AND json_extract(value_json,'$.operationId')=?", pendingHistoryKey(plan.WorkID), id); err != nil {
				return err
			}
		}
		return putApplyPlan(tx, id, plan)
	})
}

func (a *Application) workConfigurationApplyHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	const prefix = "/api/v1/works/"
	if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.EscapedPath(), prefix) {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), prefix), "/")
	if len(parts) != 3 || parts[1] != "configuration" || parts[2] != "apply" {
		return false, nil
	}
	id, err := url.PathUnescape(parts[0])
	if err != nil || !validResourceID(id) {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	input, err := readJSON[workActionInput](r)
	if err != nil {
		return true, err
	}
	if !input.IdempotencyKey.Present || input.IdempotencyKey.Null || input.IdempotencyKey.Value == "" || len(input.IdempotencyKey.Value) > 256 {
		return true, contracts.NewError("INVALID_REQUEST", "")
	}
	result, err := a.acceptWorkApply(r.Context(), actor, id, input.IdempotencyKey.Value)
	if err != nil {
		return true, err
	}
	send(w, http.StatusAccepted, result)
	return true, nil
}

func (a *Application) acceptWorkApply(ctx context.Context, actor identity.Principal, id, key string) (acceptedWorkAction, error) {
	if a.ctx.Err() != nil || a.Status().State == "SHUTTING_DOWN" {
		return acceptedWorkAction{}, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	work, err := workaccess.Work(ctx, a.Store, actor, id, workaccess.Control)
	if err != nil {
		return acceptedWorkAction{}, err
	}
	// The user request is empty. Captured identities are private acceptance
	// effects; replaying after a Save returns the original Operation.
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.UserID, WorkScope: id, Kind: applyOperationKind, IdempotencyKey: key, RequestJSON: `{}`, TargetVersion: work.ControlVersion + 1, WorkID: &id, ExpectedWorkVersion: &work.ControlVersion, FenceScope: "work"}, func(tx *sql.Tx, operationID string) (corestore.MutationEffect, error) {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return corestore.MutationEffect{}, err
		}
		current, err := corestore.ReadWork(tx, id, false)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if current.DesiredContextID == nil || current.DesiredState == "deleted" {
			return corestore.MutationEffect{}, contracts.NewError("CONFLICT", "")
		}
		if err := assertPackageScopeIdleTx(tx, id); err != nil {
			return corestore.MutationEffect{}, err
		}
		var busy bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM work_file_jobs WHERE work_id=? AND state='cleanup-pending')`, id).Scan(&busy); err != nil {
			return corestore.MutationEffect{}, err
		}
		if busy {
			return corestore.MutationEffect{}, contracts.NewError("WORK_BUSY", "")
		}
		next, err := corestore.AdvanceWorkControl(tx, id, current.ControlVersion, current.DesiredState, "")
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		plan := workApplyPlan{WorkID: id, ContextID: *current.DesiredContextID, Revision: current.DesiredRevision, PriorContextID: current.ActiveContextID, PriorRevision: current.ActiveRevision, DesiredState: current.DesiredState, Control: next, Stage: "captured"}
		if err := putApplyPlan(tx, operationID, plan); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.Exec(`UPDATE operations SET state='superseded',updated_at=? WHERE work_id=? AND state IN ('pending','running') AND target_version<?`, packageNow(), id, next); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: id}, nil
	})
	if err != nil {
		if errors.Is(err, corestore.ErrIdempotencyConflict) {
			err = contracts.NewError("IDEMPOTENCY_CONFLICT", "")
		}
		if errors.Is(err, corestore.ErrSnapshotBusy) {
			err = contracts.NewError("WORK_SNAPSHOT_BUSY", "")
		}
		if errors.Is(err, corestore.ErrRevisionConflict) {
			err = contracts.NewError("REVISION_CONFLICT", "")
		}
		return acceptedWorkAction{}, err
	}
	if !accepted.Reused {
		a.cancelWorkApply(id, work.ControlVersion+1)
	}
	a.enqueueWork(id)
	return acceptedWorkAction{id, accepted.OperationID, accepted.Reused}, nil
}

func (a *Application) applyCurrent(ctx context.Context, plan workApplyPlan) error {
	work, err := a.Store.Work(ctx, plan.WorkID, false)
	if err != nil || work.ControlVersion != plan.Control || work.DesiredState != plan.DesiredState {
		return errWorkSuperseded
	}
	return nil
}

func (a *Application) applyGeneration(ctx context.Context, id string, plan *workApplyPlan, contextID string, initializationOnly bool) (workruntime.StartSpec, error) {
	if plan.Generation == 0 {
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT COALESCE(MAX(generation),0)+1 FROM runtime_generations WHERE work_id=?`, plan.WorkID).Scan(&plan.Generation)
		})
		if err != nil {
			return workruntime.StartSpec{}, err
		}
		instance, err := uuid.NewRandom()
		if err != nil {
			return workruntime.StartSpec{}, err
		}
		plan.InstanceID = "agent-" + instance.String()
	}
	spec, _, err := a.capturedContextSpec(ctx, plan.WorkID, plan.Generation, plan.InstanceID, contextID, true)
	if err != nil {
		return spec, err
	}
	spec.InitializationOnly = initializationOnly
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		var control int64
		if err := tx.QueryRow(`SELECT control_version FROM works WHERE id=? AND deleted_at IS NULL`, plan.WorkID).Scan(&control); err != nil {
			return err
		}
		if control != plan.Control {
			return errWorkSuperseded
		}
		var existing string
		err := tx.QueryRow(`SELECT instance_id FROM runtime_generations WHERE work_id=? AND generation=?`, plan.WorkID, plan.Generation).Scan(&existing)
		if err == nil && existing != plan.InstanceID {
			return dockerengine.ErrIdentity
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,?,?,'starting',0,?,?) ON CONFLICT(work_id,generation) DO UPDATE SET state='starting',updated_at=excluded.updated_at`, plan.WorkID, plan.Generation, plan.InstanceID, packageNow(), packageNow()); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE works SET observed_state='starting',updated_at=? WHERE id=?`, packageNow(), plan.WorkID); err != nil {
			return err
		}
		return putApplyPlan(tx, id, *plan)
	}); err != nil {
		return spec, err
	}
	return spec, nil
}

// removeApplyAgent requires the exact generation/context registered in this
// installation. Volumes, Work network, and immutable contexts are preserved.
func (a *Application) removeApplyAgent(ctx context.Context, workID string) error {
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"}
	view, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil {
		return err
	}
	if view == nil {
		var binding corestore.ResourceBinding
		var missing bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			binding, err = corestore.ReadResourceBinding(tx, a.Store.InstallationID(), workID, "agent", "agentd")
			if errors.Is(err, corestore.ErrNotFound) {
				missing = true
				return nil
			}
			return err
		}); err != nil {
			return err
		}
		if missing {
			return nil
		}
		raw, err := a.Store.ControlMetadata(ctx, applyRemovalKey(workID))
		var removal corestore.ResourceBinding
		if err != nil || strictMetadata(raw, &removal) != nil || removal != binding {
			return dockerengine.ErrStateUnknown
		}
		return a.releaseApplyAgentIntent(ctx, workID)
	}

	if view.Config == nil || view.State == nil {
		return dockerengine.ErrStateUnknown
	}
	generation, err := strconv.ParseInt(view.Config.Labels["piwork.generation"], 10, 64)
	if err != nil {
		return dockerengine.ErrIdentity
	}
	instance := view.Config.Labels["piwork.instance_id"]
	contextID := view.Config.Labels["piwork.context_identity"]
	stored, err := a.Store.RuntimeGeneration(ctx, workID, generation)
	if err != nil || stored.InstanceID == nil || *stored.InstanceID != instance || contextID == "" {
		return dockerengine.ErrIdentity
	}
	identity.Labels = map[string]string{"piwork.generation": strconv.FormatInt(generation, 10), "piwork.instance_id": instance, "piwork.context_identity": contextID, "piwork.protocol_version": "v2"}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		binding, err := corestore.ReadResourceBinding(tx, a.Store.InstallationID(), workID, "agent", "agentd")
		if err != nil {
			return err
		}
		var labels map[string]string
		if json.Unmarshal([]byte(binding.LabelsJSON), &labels) != nil {
			return corestore.ErrStorage
		}
		for key, value := range labels {
			if view.Config.Labels[key] != value {
				return dockerengine.ErrIdentity
			}
		}
		data, err := json.Marshal(binding)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, applyRemovalKey(workID), string(data), packageNow())
		return err
	}); err != nil {
		return err
	}
	if client := a.agentRoutes.Revoke(workID); client != nil {
		client.Close()
	}
	if view.State.Running {
		if _, err := a.dockerRuntime.StopContainer(ctx, identity, 10); err != nil {
			return err
		}
	}
	if err := a.dockerRuntime.RemoveContainer(ctx, identity); err != nil {
		return err
	}
	check, err := a.dockerRuntime.InspectContainer(ctx, identity)
	if err != nil {
		return err
	}
	if check != nil {
		return dockerengine.ErrStateUnknown
	}
	if err := a.releaseApplyAgentIntent(ctx, workID); err != nil {
		return err
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_generations SET state='stopped',updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, packageNow(), workID, generation, instance)
		return err
	})
}

func (a *Application) releaseApplyAgentIntent(ctx context.Context, workID string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM resource_bindings WHERE installation_id=? AND resource_kind='agent' AND logical_id=?`, a.Store.InstallationID(), workID+"/agentd"); err != nil {
			return err
		}
		_, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, applyRemovalKey(workID))
		return err
	})
}

func applyQuota(tx *sql.Tx, workID string, config contracts.WorkConfig, restore bool) error {
	current, err := corestore.ReadQuotaReservation(tx, workID, "agent", "agentd")
	if err != nil {
		return err
	}
	current.DesiredCPUMillis = config.Resources.AgentCpuMillis
	current.DesiredMemoryBytes = config.Resources.AgentMemoryBytes
	if restore { // Restoration happens only after replacement absence is confirmed.
		current.OccupiedCPUMillis = 0
		current.OccupiedMemoryBytes = 0
		if err := corestore.ConfirmQuotaOccupation(tx, workID, "agent", "agentd", 0, 0, true); err != nil {
			return err
		}
	}
	return corestore.ReserveQuota(tx, current, corestore.QuotaLimits{CPUMillis: config.Resources.CpuMillis, MemoryBytes: config.Resources.MemoryBytes, MaxServices: &config.Resources.MaxServices, MaxRetainedVolumes: &config.Resources.MaxRetainedVolumes}, corestore.QuotaLimits{CPUMillis: 128000, MemoryBytes: 256 * 1024 * 1024 * 1024})
}

func (a *Application) processWorkApply(ctx context.Context, operation corestore.OperationRecord) (returned error) {
	plan, err := a.readApplyPlan(ctx, operation)
	if err != nil {
		return err
	}
	value, _ := a.workLocks.LoadOrStore(plan.WorkID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return err
	}
	defer lock.Unlock()
	ctx, cancel := context.WithCancel(ctx)
	worker := &workApplyWorker{plan.Control, cancel}
	a.workApplyWorkers.Store(plan.WorkID, worker)
	defer func() {
		cancel()
		a.workApplyWorkers.CompareAndDelete(plan.WorkID, worker)
		if errors.Is(returned, context.Canceled) && a.ctx.Err() == nil && errors.Is(a.applyCurrent(a.ctx, plan), errWorkSuperseded) {
			if plan.Stage == "replacing" || plan.Stage == "starting" || plan.Stage == "validated" || plan.Stage == "rollback" {
				cleanup, finish := context.WithTimeout(a.ctx, 15*time.Second)
				err := a.removeApplyAgent(cleanup, plan.WorkID)
				finish()
				returned = errors.Join(errWorkSuperseded, err)
			} else {
				returned = errWorkSuperseded
			}
		}
	}()
	if err := a.applyCurrent(ctx, plan); err != nil {
		return err
	}
	if err := a.reconcileHistoryUpgradeLocked(ctx, plan.WorkID, operation.ID); err != nil {
		return err
	}
	if plan.Stage == "captured" && !plan.HistoryRecovered {
		restored, err := a.restoredPriorHistory(ctx, plan)
		if err != nil {
			return err
		}
		if restored {
			plan.HistoryRecovered = true
			if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
				return err
			}
		}
	}
	if a.workRuntime == nil || a.dockerRuntime == nil {
		return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", false)
	}
	if plan.PriorContextID != nil && *plan.PriorContextID == plan.ContextID {
		return a.finishWorkApply(ctx, operation, plan, "", "", "not-required", false)
	}
	probeGeneration := plan.Generation
	if probeGeneration == 0 {
		probeGeneration = 1
	}
	probeInstance := plan.InstanceID
	if probeInstance == "" {
		probeInstance = "agent-" + uuid.NewString()
	}
	candidate, captured, err := a.capturedContextSpec(ctx, plan.WorkID, probeGeneration, probeInstance, plan.ContextID, true)
	if err != nil {
		return a.finishWorkApply(ctx, operation, plan, "CONTEXT_NOT_FOUND", "context-validate", "not-required", false)
	}
	candidateConfig, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(captured.configuration), "WorkConfigSchema", 2<<20)
	if err != nil {
		return corestore.ErrStorage
	}
	candidate.InitializationOnly = plan.DesiredState == "stopped"
	if plan.Stage == "captured" && plan.PriorContextID != nil {
		prior, _, err := a.capturedContextSpec(ctx, plan.WorkID, 1, "inspection", *plan.PriorContextID, true)
		if err != nil {
			return err
		}
		old, err := a.inspector.InspectNativeAgent(ctx, prior.ImageID)
		if err != nil {
			return err
		}
		next, err := a.inspector.InspectNativeAgent(ctx, candidate.ImageID)
		if err != nil {
			return err
		}
		if old.WorkHistorySchema == 5 && next.WorkHistorySchema == 4 {
			return a.finishWorkApply(ctx, operation, plan, "CONTEXT_FORMAT_UNSUPPORTED", "context-validate", "not-required", false)
		}
	}
	if plan.Stage == "captured" {
		if err := a.workRuntime.Prepare(ctx, candidate); err != nil {
			return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", false)
		}
		plan.Stage = "prepared"
		if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
			return err
		}
	}
	if plan.Stage == "prepared" {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			var control int64
			if err := tx.QueryRow(`SELECT control_version FROM works WHERE id=? AND deleted_at IS NULL`, plan.WorkID).Scan(&control); err != nil {
				return err
			}
			if control != plan.Control {
				return errWorkSuperseded
			}
			return applyQuota(tx, plan.WorkID, candidateConfig, false)
		}); err != nil {
			if errors.Is(err, errWorkSuperseded) {
				return err
			}
			return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", false)
		}

		priorAbsent := false
		if plan.HistoryRecovered {
			view, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: plan.WorkID, Kind: "agent", LogicalID: "agentd"})
			if err != nil {
				return err
			}
			priorAbsent = view == nil
		}
		if plan.DesiredState == "running" && plan.PriorContextID != nil && !priorAbsent {
			var generation int64
			var instance string
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				return tx.QueryRow(`SELECT generation,instance_id FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, plan.WorkID).Scan(&generation, &instance)
			}); err != nil {
				return err
			}
			scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: plan.WorkID, Generation: generation, InstanceID: instance}
			client, err := a.agentRoutes.Agent(scope, *plan.PriorContextID)
			if err != nil {
				observationCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
				client, err = a.workRuntime.OpenManagedAgent(observationCtx, scope, *plan.PriorContextID)
				cancel()
				if err != nil {
					return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", false)
				}
				defer client.Close()
			}
			gateCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			gate, err := client.PrepareConfigurationChange(gateCtx)
			cancel()
			if err != nil {
				return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", false)
			}
			if gate == nil || !gate.Prepared || gate.Busy || gate.ActiveRunCount != 0 {
				return a.finishWorkApply(ctx, operation, plan, "WORK_BUSY", "runtime-prepare", "not-required", false)
			}
		}
		if err := a.settleWorkFiles(ctx, plan.WorkID, false); err != nil {
			return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", false)
		}
		plan.Stage = "replacing"
		if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
			return err
		}
	}
	if plan.Stage == "replacing" {
		if err := a.applyCurrent(ctx, plan); err != nil {
			return err
		}
		if err := a.removeApplyAgent(ctx, plan.WorkID); err != nil {
			return a.finishWorkApply(ctx, operation, plan, "RUNTIME_PREPARE_FAILED", "runtime-prepare", "not-required", true)
		}
		if err := a.prepareHistoryUpgrade(ctx, operation.ID, &plan, candidate); err != nil {
			plan.Stage = "rollback"
			plan.ErrorCode = "RUNTIME_PREPARE_FAILED"
			plan.ErrorStage = "runtime-prepare"
			if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
				return err
			}
			return a.rollbackWorkApply(ctx, operation, plan)
		}
		plan.Stage = "starting"
		if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
			return err
		}

	}
	if plan.Stage == "starting" || plan.Stage == "validated" {
		var startErr error
		for {
			migrationOnly := plan.HistoryBackup != nil && plan.HistoryBackup.State == "saved" && !plan.HistoryBackup.InitializationValidated
			initializationOnly := candidate.InitializationOnly || migrationOnly
			spec, err := a.applyGeneration(ctx, operation.ID, &plan, plan.ContextID, initializationOnly)
			if err != nil {
				return err
			}
			if migrationOnly {
				spec.HistoryMigration = migrationGrant(operation.ID, plan)
				spec.CorrelationID = operation.ID
			}
			started, err := a.startWorkRuntime(ctx, spec)
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err == nil && a.applyCurrent(ctx, plan) != nil {
				started.Client.Close()
				_ = a.removeApplyAgent(ctx, plan.WorkID)
				return errWorkSuperseded
			}
			if err != nil {
				startErr = err
				break
			}
			if initializationOnly {
				started.Client.Close()
				if err := a.removeApplyAgent(ctx, plan.WorkID); err != nil {
					return a.finishWorkApply(ctx, operation, plan, "RUNTIME_START_FAILED", "runtime-start", "not-required", true)
				}
			}
			if migrationOnly {
				plan.HistoryBackup.InitializationValidated = true
				plan.Stage = "validated"
				if !candidate.InitializationOnly {
					plan.Generation = 0
					plan.InstanceID = ""
				}
				if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
					return err
				}
				if !candidate.InitializationOnly {
					continue
				}
			}
			if err := a.publishWorkApply(ctx, operation, plan, spec, started, candidate.InitializationOnly); err != nil {
				if started.Client != nil {
					started.Client.Close()
				}
				return err
			}
			return nil
		}
		err = startErr
		plan.Stage = "rollback"
		primary := diagnosticCause(err, "RUNTIME_START_FAILED", "runtime-start")
		plan.ErrorCode = string(primary.Code)
		plan.ErrorStage = string(primary.Stage)
		plan.PrimaryDiagnostic = &primary
		if err := a.saveApplyPlan(ctx, operation.ID, plan); err != nil {
			return err
		}
	}
	if plan.Stage == "rollback" {
		return a.rollbackWorkApply(ctx, operation, plan)
	}
	return corestore.ErrStorage
}

func readApplyConfig(ctx context.Context, store *corestore.Store, workID, contextID string) (contracts.WorkConfig, error) {
	var config contracts.WorkConfig
	err := store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		config, err = readApplyConfigTx(tx, workID, contextID)
		return err
	})
	return config, err
}

func (a *Application) rollbackWorkApply(ctx context.Context, operation corestore.OperationRecord, plan workApplyPlan) error {
	if plan.PriorContextID != nil {
		if trace := traceFrom(ctx); trace != nil {
			if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "rollback", Outcome: "started", Code: "ROLLBACK_FAILED"}); err != nil {
				return err
			}
		}
	}
	if err := a.applyCurrent(ctx, plan); err != nil {
		return err
	}
	if err := a.removeApplyAgent(ctx, plan.WorkID); err != nil {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "failed", true)
	}
	if err := a.restoreHistoryUpgrade(ctx, operation.ID, &plan); err != nil {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "failed", true)
	}
	if plan.PriorContextID == nil {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "not-required", true)
	}
	plan.Generation = 0
	plan.InstanceID = ""
	spec, err := a.applyGeneration(ctx, operation.ID, &plan, *plan.PriorContextID, plan.DesiredState == "stopped")
	if err != nil {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "failed", true)
	}
	prior, err := readApplyConfig(ctx, a.Store, plan.WorkID, spec.ContextID)
	if err != nil {
		return err
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { return applyQuota(tx, plan.WorkID, prior, true) }); err != nil {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "failed", true)
	}
	if plan.DesiredState == "stopped" {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "succeeded", false)
	}
	started, err := a.startWorkRuntime(ctx, spec)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if err != nil {
		return a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "failed", true)
	}
	if a.applyCurrent(ctx, plan) != nil {
		started.Client.Close()
		_ = a.removeApplyAgent(ctx, plan.WorkID)
		return errWorkSuperseded
	}
	err = a.finishWorkApply(ctx, operation, plan, plan.ErrorCode, plan.ErrorStage, "succeeded", false, func() error {
		return a.agentRoutes.Publish(spec.Scope, spec.ContextID, started)
	})
	if err != nil {
		started.Client.Close()
		if client := a.agentRoutes.Revoke(plan.WorkID); client != nil {
			client.Close()
		}
	}
	return err
}

func (a *Application) publishWorkApply(ctx context.Context, operation corestore.OperationRecord, plan workApplyPlan, spec workruntime.StartSpec, started workruntime.Started, stopped bool) error {
	if trace := traceFrom(ctx); trace != nil {
		if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "activation", Outcome: "started", Code: "WORK_OPERATION_FAILED"}); err != nil {
			return err
		}
	}
	observed := "ready"
	if stopped {
		observed = "stopped"
	}
	config, err := readApplyConfig(ctx, a.Store, plan.WorkID, plan.ContextID)
	if err != nil {
		return err
	}
	runtimeState := contracts.RuntimeSkillState{State: "unavailable", CheckedAt: json.RawMessage("null"), Skills: []contracts.RuntimeSkill{}}
	if !stopped {
		metadata, err := workcontext.Metadata(a.Store, plan.WorkID, plan.ContextID)
		if err != nil {
			return err
		}
		response := started.VerifiedReadiness()
		if response == nil {
			return corestore.ErrStorage
		}
		runtimeState.CheckedAt, _ = json.Marshal(packageNow())
		runtimeState = projectRuntimeResources(runtimeState, config, metadata, response)
		if runtimeState.State != "ready" {
			return corestore.ErrStorage
		}
	}
	output, err := a.diagnosticResult(ctx, operation.ID, map[string]any{"observedState": observed}, "")
	if err != nil {
		return err
	}
	v := decodeDiagnosticEnvelope(&output, operation.ID)
	v.Diagnostics = diagnostics.Append(v.Diagnostics, diagnostics.Event{Component: "core", Stage: "activation", Outcome: "succeeded", Code: "WORK_OPERATION_FAILED"})
	raw, _ := json.Marshal(v)
	output = string(raw)
	completed, err := a.completeDiagnosticOperation(ctx, operation.ID, "succeeded", &output, nil, func(tx *sql.Tx) error {
		now := packageNow()
		config, err := readApplyConfigTx(tx, plan.WorkID, plan.ContextID)
		if err != nil {
			return err
		}
		if err := corestore.ConfirmQuotaOccupation(tx, plan.WorkID, "agent", "agentd", 0, 0, true); err != nil {
			return err
		}
		if err := applyQuota(tx, plan.WorkID, config, false); err != nil {
			return err
		}
		if !stopped {
			if err := corestore.ConfirmQuotaOccupation(tx, plan.WorkID, "agent", "agentd", config.Resources.AgentCpuMillis, config.Resources.AgentMemoryBytes, false); err != nil {
				return err
			}
		}
		state := "ready"
		if stopped {
			state = "stopped"
		}
		if _, err := tx.Exec(`UPDATE runtime_generations SET state=?,ready_since=?,updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, state, now, now, plan.WorkID, plan.Generation, plan.InstanceID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE works SET active_context_id=?,active_revision=?,observed_state=?,updated_at=? WHERE id=? AND control_version=?`, plan.ContextID, plan.Revision, observed, now, plan.WorkID, plan.Control); err != nil {
			return err
		}
		if err := a.clearCommittedHistory(tx, operation.ID, plan); err != nil {
			return err
		}
		var desiredRaw, desiredContextID string
		if err := tx.QueryRow(`SELECT r.config_json,w.desired_context_id FROM works w JOIN work_config_revisions r ON r.work_id=w.id AND r.revision=w.desired_revision WHERE w.id=?`, plan.WorkID).Scan(&desiredRaw, &desiredContextID); err != nil {
			return err
		}
		desired, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(desiredRaw), "WorkConfigSchema", 2<<20)
		if err != nil {
			return corestore.ErrStorage
		}
		active, err := json.Marshal(config)
		if err != nil {
			return err
		}
		view := contracts.WorkConfigurationView{WorkId: contracts.ResourceId(plan.WorkID), Active: active, Desired: desired, PendingApply: desiredContextID != plan.ContextID, Runtime: runtimeState}
		envelope, err := json.Marshal(map[string]any{"correlationId": operation.ID, "result": map[string]any{"configuration": view}})
		if err != nil {
			return err
		}
		output = string(envelope)
		if !stopped {
			if _, err := corestore.OpenFileGate(tx, plan.WorkID, now); err != nil {
				return err
			}
			return a.agentRoutes.Publish(spec.Scope, spec.ContextID, started)
		}
		return nil
	})
	if err != nil || completed.State == "superseded" {
		if client := a.agentRoutes.Revoke(plan.WorkID); client != nil {
			client.Close()
		}
		if err == nil {
			err = errWorkSuperseded
		}
	}
	if err == nil && plan.HistoryBackup != nil {
		_ = a.retireHistoryBackup(ctx, operation.ID)
	}
	return err
}
func readApplyConfigTx(tx *sql.Tx, workID, contextID string) (contracts.WorkConfig, error) {
	var raw string
	if err := tx.QueryRow(`SELECT configuration_json FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, contextID).Scan(&raw); err != nil {
		return contracts.WorkConfig{}, err
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(raw), "WorkConfigSchema", 2<<20)
	if err != nil {
		return config, corestore.ErrStorage
	}
	return config, nil
}

func (a *Application) finishWorkApply(ctx context.Context, operation corestore.OperationRecord, plan workApplyPlan, code, stage, rollback string, failedRuntime bool, publish ...func() error) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	var diagnostic any
	state := "succeeded"
	if code != "" {
		state = "failed"
		message, remediation, retryable, ok := safeDiagnosticText(code)
		if !ok {
			code = "WORK_OPERATION_FAILED"
			message, remediation, retryable, _ = safeDiagnosticText(code)
		}
		diagnostic = map[string]any{"code": code, "stage": stage, "message": message, "remediation": remediation, "retryable": retryable}
	}
	rollbackView := map[string]any{"state": rollback}
	if rollback == "failed" {
		message, remediation, retryable, _ := safeDiagnosticText("ROLLBACK_FAILED")
		rollbackView["error"] = map[string]any{"code": "ROLLBACK_FAILED", "stage": "rollback", "message": message, "remediation": remediation, "retryable": retryable}
	}
	resultJSON, resultErr := a.diagnosticResult(ctx, operation.ID, nil, rollback)
	if resultErr != nil {
		return resultErr
	}
	var errorJSON *string
	if diagnostic != nil {
		if plan.PrimaryDiagnostic != nil && string(plan.PrimaryDiagnostic.Code) == code && string(plan.PrimaryDiagnostic.Stage) == stage {
			diagnostic = *plan.PrimaryDiagnostic
		}
		encoded, _ := json.Marshal(diagnostic)
		value := string(encoded)
		errorJSON = &value
	}
	completed, err := a.completeDiagnosticOperation(ctx, operation.ID, state, &resultJSON, errorJSON, func(tx *sql.Tx) error {
		if code != "" && plan.Stage == "prepared" && plan.PriorContextID != nil {
			prior, err := readApplyConfigTx(tx, plan.WorkID, *plan.PriorContextID)
			if err != nil {
				return err
			}
			if err := applyQuota(tx, plan.WorkID, prior, false); err != nil {
				return err
			}
		}
		observed := "ready"
		if code == "" {
			if err := tx.QueryRow(`SELECT observed_state FROM works WHERE id=?`, plan.WorkID).Scan(&observed); err != nil {
				return err
			}
		}
		if plan.DesiredState == "stopped" {
			observed = "stopped"
		}
		if failedRuntime || code != "" && plan.PriorContextID == nil {
			observed = "failed"
		}
		if _, err := tx.Exec(`UPDATE works SET observed_state=?,updated_at=? WHERE id=? AND control_version=?`, observed, packageNow(), plan.WorkID, plan.Control); err != nil {
			return err
		}
		if rollback == "succeeded" && plan.DesiredState == "running" && plan.PriorContextID != nil {
			prior, err := readApplyConfigTx(tx, plan.WorkID, *plan.PriorContextID)
			if err != nil {
				return err
			}
			if err := corestore.ConfirmQuotaOccupation(tx, plan.WorkID, "agent", "agentd", prior.Resources.AgentCpuMillis, prior.Resources.AgentMemoryBytes, false); err != nil {
				return err
			}
		}
		if plan.Generation > 0 {
			state := "ready"
			if observed == "stopped" {
				state = "stopped"
			}
			if observed == "failed" {
				state = "failed"
			}
			if _, err := tx.Exec(`UPDATE runtime_generations SET state=?,ready_since=?,updated_at=? WHERE work_id=? AND generation=?`, state, packageNow(), packageNow(), plan.WorkID, plan.Generation); err != nil {
				return err
			}
		}
		if len(publish) == 1 {
			if observed == "ready" {
				if _, err := corestore.OpenFileGate(tx, plan.WorkID, packageNow()); err != nil {
					return err
				}
			}
			return publish[0]()
		}
		return nil
	})
	if err == nil && completed.State == "superseded" {
		return errWorkSuperseded
	}
	return err
}
