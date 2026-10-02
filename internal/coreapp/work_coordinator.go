package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/workaccess"
)

type acceptedWorkAction struct {
	WorkID      string `json:"workId"`
	OperationID string `json:"operationId"`
	Reused      bool   `json:"reused"`
}

// acceptWorkAction persists the target and its Operation before any Engine or
// Agent call. The idempotency record is consulted inside the same transaction.
func (a *Application) acceptWorkAction(ctx context.Context, actor identity.Principal, workID, action, key string) (acceptedWorkAction, error) {
	var output acceptedWorkAction
	if action != "start" && action != "stop" && action != "retry" && action != "delete" || key == "" {
		return output, contracts.NewError("INVALID_REQUEST", "")
	}
	if a.ctx.Err() != nil || a.Status().State == "SHUTTING_DOWN" {
		return output, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	var work corestore.WorkRecord
	var err error
	if action == "delete" {
		// A committed delete hides the Work from normal reads, while its
		// original idempotency key must still resolve to the accepted Operation.
		work, err = workaccess.WorkOperation(ctx, a.Store, actor, workID)
	} else {
		work, err = workaccess.Work(ctx, a.Store, actor, workID, workaccess.Control)
	}
	if err != nil {
		return output, err
	}
	desired := "running"
	if action == "stop" {
		desired = "stopped"
	} else if action == "delete" {
		desired = "deleted"
	}
	requestJSON, _ := json.Marshal(map[string]any{"desiredState": desired, "retry": action == "retry"})
	request := corestore.MutationRequest{
		PrincipalID: actor.UserID, WorkScope: workID, Kind: action + "-work", IdempotencyKey: key,
		RequestJSON: string(requestJSON), TargetVersion: work.ControlVersion + 1,
		WorkID: &workID, ExpectedWorkVersion: &work.ControlVersion, FenceScope: "work",
	}
	accepted, err := a.Store.AcceptMutation(ctx, request, func(tx *sql.Tx, operationID string) (corestore.MutationEffect, error) {
		if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
			return corestore.MutationEffect{}, err
		}
		if desired == "running" {
			if err := assertPackageScopeIdleTx(tx, workID); err != nil {
				return corestore.MutationEffect{}, err
			}
			if action != "retry" {
				var pending bool
				if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM work_file_jobs WHERE work_id=? AND state='cleanup-pending')`, workID).Scan(&pending); err != nil {
					return corestore.MutationEffect{}, err
				}
				if pending {
					return corestore.MutationEffect{}, contracts.NewError("WORK_BUSY", "")
				}
			}
		}
		if desired == "running" {
			current, err := corestore.ReadWork(tx, workID, false)
			if err != nil {
				return corestore.MutationEffect{}, err
			}
			captured := current.ActiveContextID
			if captured == nil {
				captured = current.DesiredContextID
			}
			if captured != nil {
				if err := putCapturedStart(tx, startCaptureKey(operationID), *captured); err != nil {
					return corestore.MutationEffect{}, err
				}
			}
		}
		if _, err := corestore.AdvanceWorkControl(tx, workID, work.ControlVersion, desired, ""); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE operations SET state='superseded',updated_at=? WHERE work_id=? AND state IN ('pending','running') AND target_version<?`, time.Now().UTC().Format(time.RFC3339Nano), workID, work.ControlVersion+1); err != nil {
			return corestore.MutationEffect{}, err
		}
		if desired != "running" {
			if _, err := corestore.CloseFileGate(tx, workID, packageNow()); err != nil {
				return corestore.MutationEffect{}, err
			}
			if err := corestore.ReleaseQueuedWorkPackageLeases(tx, workID); err != nil {
				return corestore.MutationEffect{}, err
			}
			if _, err := tx.Exec(`UPDATE pi_package_jobs SET phase='superseded',updated_at=? WHERE work_id=? AND phase='queued'`, packageNow(), workID); err != nil {
				return corestore.MutationEffect{}, err
			}
		}
		return corestore.MutationEffect{ResourceID: workID}, nil
	})
	if err != nil {
		switch {
		case errors.Is(err, corestore.ErrIdempotencyConflict):
			return output, contracts.NewError("IDEMPOTENCY_CONFLICT", "")
		case errors.Is(err, corestore.ErrRevisionConflict):
			return output, contracts.NewError("REVISION_CONFLICT", "")
		case errors.Is(err, corestore.ErrSnapshotBusy):
			return output, contracts.NewError("WORK_SNAPSHOT_BUSY", "")
		}
		return output, err
	}
	if !accepted.Reused {
		a.cancelWorkApply(workID, work.ControlVersion+1)
		a.cancelServiceEffects(workID)
	}
	if desired != "running" && !accepted.Reused {
		a.cancelWorkFiles(ctx, workID, false)
		_ = a.cancelWorkPackageJobs(ctx, workID)
	}
	a.enqueueWork(workID)
	return acceptedWorkAction{workID, accepted.OperationID, accepted.Reused}, nil
}

func (a *Application) enqueueWork(workID string) {
	a.workQueueMu.Lock()
	if a.ctx.Err() != nil {
		a.workQueueMu.Unlock()
		return
	}
	if a.workQueues == nil {
		a.workQueues = make(map[string]chan struct{})
	}
	ch, exists := a.workQueues[workID]
	if !exists {
		ch = make(chan struct{}, 1)
		a.workQueues[workID] = ch
		a.workWG.Add(1)
		go a.workLoop(workID, ch)
	}
	select {
	case ch <- struct{}{}:
	default:
	}
	a.workQueueMu.Unlock()
}

func (a *Application) workLoop(workID string, ch chan struct{}) {
	defer a.workWG.Done()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-ch:
		}
		for {
			processed, err := a.processOneWorkOperation(a.ctx, workID)
			if err != nil || !processed {
				break
			}
		}
		a.workQueueMu.Lock()
		if len(ch) == 0 {
			delete(a.workQueues, workID)
			a.workQueueMu.Unlock()
			return
		}
		a.workQueueMu.Unlock()
	}
}

func (a *Application) processOneWorkOperation(ctx context.Context, workID string) (bool, error) {
	operations, err := a.Store.PendingOperations(ctx)
	if err != nil {
		return false, err
	}
	var current *corestore.OperationRecord
	for i := range operations {
		item := &operations[i]
		if item.WorkID == nil || *item.WorkID != workID || item.Kind != "create-work" && item.Kind != "start-work" && item.Kind != "stop-work" && item.Kind != "retry-work" && item.Kind != "delete-work" && item.Kind != applyOperationKind {
			continue
		}
		if current == nil || item.TargetVersion > current.TargetVersion {
			current = item
		}
	}
	if current == nil {
		for _, operation := range operations {
			if operation.WorkID != nil && *operation.WorkID == workID && isServiceOperation(operation.Kind) {
				return true, a.processServiceOperation(ctx, operation)
			}
		}
		return false, nil
	}
	for _, item := range operations {
		if item.WorkID != nil && *item.WorkID == workID && item.ID != current.ID && item.TargetVersion < current.TargetVersion && (item.Kind == "create-work" || item.Kind == "start-work" || item.Kind == "stop-work" || item.Kind == "retry-work" || item.Kind == "delete-work" || item.Kind == applyOperationKind) {
			_, _ = a.completeDiagnosticOperation(ctx, item.ID, "superseded", nil, nil, nil)
		}
	}
	if current.State == "pending" {
		if err := a.Store.MarkOperationRunning(ctx, current.ID); err != nil {
			return true, err
		}
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		return true, err
	}
	if current.TargetVersion != work.ControlVersion {
		_, err := a.completeDiagnosticOperation(ctx, current.ID, "superseded", nil, nil, nil)
		return true, err
	}
	if current.Kind == applyOperationKind {
		ctx = a.traceOperation(ctx, *current)
		err := a.processWorkApply(ctx, *current)
		if errors.Is(err, errWorkSuperseded) {
			latest, lookupErr := a.Store.Operation(ctx, current.ID)
			if lookupErr != nil {
				return true, lookupErr
			}
			if latest.State == "pending" || latest.State == "running" {
				_, err = a.completeDiagnosticOperation(ctx, current.ID, "superseded", nil, nil, nil)
			} else {
				err = nil
			}
		}
		return true, err
	}
	var observed string
	ctx = a.traceOperation(ctx, *current)
	if work.DesiredState == "running" {
		if current.Kind == "retry-work" {
			err = a.settleWorkFiles(ctx, workID, true)
		}
		if err == nil {
			err = a.ensureInitialWorkContext(ctx, workID)
		}
		if err == nil {
			var generation int64
			var instanceID string
			captured, captureErr := a.readCapturedStart(ctx, startCaptureKey(current.ID))
			if captureErr != nil {
				err = captureErr
			} else {
				generation, instanceID, err = a.selectCapturedAgentGeneration(ctx, work, captured)
			}
			if err == nil {
				if existing, lookupErr := a.Store.RuntimeGeneration(ctx, workID, generation); lookupErr == nil {
					if current.Kind == "retry-work" {
						if existing.State != "ready" {
							_, err = a.Store.ResetRuntimeRetryBudget(ctx, workID, generation, time.Now().UTC())
						}
					} else if !runtimeRetryPermitted(existing, time.Now().UTC()) {
						err = errCapturedWork
					}
				} else if !errors.Is(lookupErr, corestore.ErrNotFound) {
					err = lookupErr
				}
			}
			if err == nil {
				// A repeated explicit Start against an already ready generation is a
				// successful no-op. Route identity still has to match the durable
				// captured context; a stale or missing route reconciles normally.
				ready := false
				if work.ObservedState == "ready" || work.ObservedState == "degraded" {
					if spec, _, captureErr := a.capturedStartSpec(ctx, workID, generation, instanceID); captureErr == nil {
						_, routeErr := a.agentRoutes.Agent(spec.Scope, spec.ContextID)
						ready = routeErr == nil
					}
				}
				if !ready {
					captured, captureErr := a.readCapturedStart(ctx, startCaptureKey(current.ID))
					if captureErr != nil {
						err = captureErr
					} else {
						_, err = a.startCapturedWork(ctx, workID, generation, instanceID, captured)
					}
				} else {
					value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
					lock := value.(*sync.Mutex)
					if err = lockWorkContext(ctx, lock); err == nil {
						_, err = a.restoreWorkServicesLocked(ctx, workID)
						lock.Unlock()
						if err == nil {
							err = a.updateServiceWorkObservation(ctx, workID)
							if err == nil {
								err = a.Store.Write(ctx, func(tx *sql.Tx) error {
									gate, failure := corestore.ReadFileGate(tx, workID)
									if failure == nil && !gate.Closed {
										return nil
									}
									_, failure = corestore.OpenFileGate(tx, workID, packageNow())
									return failure
								})
							}
						}
					}
				}
			}
		}
		observed = "ready"
		if err == nil {
			latest, lookupErr := a.Store.Work(ctx, workID, false)
			if lookupErr != nil {
				err = lookupErr
			} else {
				observed = latest.ObservedState
			}
		}
	} else if work.DesiredState == "stopped" {
		err = a.stopAcceptedWork(ctx, workID)
		observed = "stopped"
	} else if work.DesiredState == "deleted" {
		err = a.removeAcceptedWork(ctx, workID)
		observed = "deleted"
	} else {
		err = errCapturedWork
	}
	if ctx.Err() != nil {
		return true, ctx.Err()
	}
	if errors.Is(err, errWorkSuperseded) {
		_, finishErr := a.completeDiagnosticOperation(ctx, current.ID, "superseded", nil, nil, nil)
		return true, finishErr
	}
	if err != nil {
		diagnostic := diagnosticCause(err, "WORK_OPERATION_FAILED", "runtime-start")
		errorJSON, _ := json.Marshal(diagnostic)
		value := string(errorJSON)
		result, resultErr := a.diagnosticResult(ctx, current.ID, nil, "")
		if resultErr != nil {
			return true, resultErr
		}
		_, finishErr := a.completeDiagnosticOperation(ctx, current.ID, "failed", &result, &value, func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx, `UPDATE works SET observed_state='failed',updated_at=? WHERE id=?`, time.Now().UTC().Format(time.RFC3339Nano), workID)
			return err
		})
		return true, finishErr
	}
	value, resultErr := a.diagnosticResult(ctx, current.ID, map[string]any{"observedState": observed}, "")
	if resultErr != nil {
		return true, resultErr
	}
	var publish func(*sql.Tx) error
	if observed == "deleted" {
		publish = func(tx *sql.Tx) error {
			if err := corestore.ConfirmQuotaOccupation(tx, workID, "agent", "agentd", 0, 0, true); err != nil {
				return err
			}
			if err := corestore.ReleaseQuota(tx, workID, "agent", "agentd", true); err != nil {
				return err
			}
			services, err := corestore.ReadServices(tx, workID, true)
			if err != nil {
				return err
			}
			for _, service := range services {
				if err := corestore.ConfirmQuotaOccupation(tx, workID, "service", service.ServiceID, 0, 0, true); err != nil {
					return err
				}
				if err := corestore.ReleaseQuota(tx, workID, "service", service.ServiceID, true); err != nil {
					return err
				}
				if _, err := tx.Exec(`UPDATE quota_reservations SET service_slots=0 WHERE work_id=? AND subject_kind='service' AND subject_id=?`, workID, service.ServiceID); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`UPDATE service_heads SET enabled=0,tombstoned_at=COALESCE(tombstoned_at,?),observed_state='deleted' WHERE work_id=?`, packageNow(), workID); err != nil {
				return err
			}
			if err := corestore.RetainWorkVolumes(tx, workID); err != nil {
				return err
			}
			now := time.Now().UTC().Format(time.RFC3339Nano)
			result, err := tx.ExecContext(ctx, `UPDATE works SET observed_state='deleted',deleted_at=?,updated_at=? WHERE id=? AND desired_state='deleted' AND control_version=? AND deleted_at IS NULL`, now, now, workID, current.TargetVersion)
			if err != nil {
				return err
			}
			if affected, err := result.RowsAffected(); err != nil || affected != 1 {
				return errWorkSuperseded
			}
			return nil
		}
	}
	_, err = a.completeDiagnosticOperation(ctx, current.ID, "succeeded", &value, nil, publish)
	return true, err
}

func (a *Application) selectAgentGeneration(ctx context.Context, work corestore.WorkRecord) (int64, string, error) {
	var generation int64
	var instanceID, state string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT generation,COALESCE(instance_id,''),state FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, work.ID).Scan(&generation, &instanceID, &state)
	})
	if err == nil && instanceID != "" && (state == "stopped" || state == "starting" || state == "ready" || state == "recovering" || state == "failed" || state == "draining") {
		return generation, instanceID, nil
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, "", err
	}
	if generation >= work.ControlVersion {
		return 0, "", errWorkSuperseded
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return 0, "", err
	}
	return work.ControlVersion, "agent-" + id.String(), nil
}

func (a *Application) stopAcceptedWork(ctx context.Context, workID string) (returned error) {
	var fileErr error
	defer func() { returned = errors.Join(returned, fileErr) }()
	if a.dockerRuntime == nil {
		return errCapturedWork
	}
	if err := a.settleWorkPackageJobs(ctx, workID); err != nil {
		return err
	}
	var count int
	var missingAgentErr error
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT count(*) FROM runtime_generations WHERE work_id=?`, workID).Scan(&count)
	}); err != nil {
		return err
	}
	if count != 0 {
		view, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"})
		if err != nil {
			return err
		}
		if view != nil {
			return a.stopCapturedWork(ctx, workID, a.options.WorkDrainTimeout, a.options.WorkStopTimeout)
		}
		missingAgentErr = a.confirmMissingAgent(ctx, workID)
	}
	fileErr = a.settleWorkFiles(ctx, workID, false)
	value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return err
	}
	defer lock.Unlock()
	if err := a.stopWorkServicesLocked(ctx, workID, false); err != nil {
		return errors.Join(err, missingAgentErr)
	}
	if missingAgentErr != nil {
		return missingAgentErr
	}
	managed, err := a.dockerRuntime.ListContainers(ctx, "")
	if err != nil {
		return err
	}
	for _, item := range managed {
		if item.Config == nil || item.Config.Labels[dockerengine.WorkLabel] == workID && (item.Config.Labels[dockerengine.KindLabel] != "service" || item.State == nil || item.State.Running) {
			return errCapturedWork
		}
	}
	if client := a.agentRoutes.Revoke(workID); client != nil {
		client.Close()
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		now := time.Now().UTC().Format(time.RFC3339Nano)
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state='stopped',updated_at=? WHERE work_id=? AND state!='stopped'`, now, workID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE works SET observed_state='stopped',updated_at=? WHERE id=?`, now, workID)
		return err
	})
}
