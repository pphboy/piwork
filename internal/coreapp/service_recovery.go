package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

type serviceEffect struct {
	Control int64
	Cancel  context.CancelFunc
}

func (a *Application) serviceEffectContext(ctx context.Context, workID string, control int64) (context.Context, func()) {
	ctx, cancel := context.WithCancel(ctx)
	effect := &serviceEffect{Control: control, Cancel: cancel}
	a.serviceEffects.Store(workID, effect)
	return ctx, func() { a.serviceEffects.CompareAndDelete(workID, effect); cancel() }
}
func (a *Application) cancelServiceEffects(workID string) {
	if value, ok := a.serviceEffects.Load(workID); ok {
		value.(*serviceEffect).Cancel()
	}
}

func nextServiceRecovery(binding corestore.ServiceRuntimeBinding, now time.Time, running bool, policy string) (corestore.ServiceRuntimeBinding, bool) {
	stamp := now.UTC().Format(time.RFC3339Nano)
	binding.UpdatedAt = stamp
	if running {
		if binding.ReadySince != nil {
			since, err := time.Parse(time.RFC3339Nano, *binding.ReadySince)
			if err == nil && !now.Before(since.Add(10*time.Minute)) {
				binding.RecoveryCount = 0
				binding.RecoveryWindowStartedAt = nil
				binding.NextRetryAt = nil
			}
		}
		return binding, false
	}
	binding.ReadySince = nil
	if policy == "never" || binding.RecoveryCount >= 3 {
		binding.NextRetryAt = nil
		return binding, false
	}
	if binding.NextRetryAt == nil {
		delays := []time.Duration{time.Second, 5 * time.Second, 15 * time.Second}
		due := now.Add(delays[binding.RecoveryCount]).UTC().Format(time.RFC3339Nano)
		binding.NextRetryAt = &due
		if binding.RecoveryWindowStartedAt == nil {
			binding.RecoveryWindowStartedAt = &stamp
		}
		return binding, false
	}
	due, err := time.Parse(time.RFC3339Nano, *binding.NextRetryAt)
	if err != nil || now.Before(due) {
		return binding, false
	}
	binding.RecoveryCount++
	binding.NextRetryAt = nil
	return binding, true
}

func (a *Application) serviceFailure(ctx context.Context, target serviceTarget, err error, unknown bool) error {
	code, stage := "SERVICE_START_FAILED", "service-recovery"
	var failure *serviceRuntimeError
	if errors.As(err, &failure) {
		code, stage = failure.Code, failure.Stage
	}
	state := "failed"
	if unknown {
		code = "DOCKER_UNAVAILABLE"
		state = "unknown"
	}
	raw, _ := json.Marshal(map[string]any{"code": code, "stage": stage, "serviceId": target.ServiceID, "message": "Service runtime is unavailable.", "remediation": "Restore the runtime or correct the service configuration and retry.", "retryable": true})
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state=?,last_error_json=? WHERE work_id=? AND service_id=?`, state, string(raw), target.WorkID, target.ServiceID)
		return err
	})
}

// Called under the Work runtime lock on every Agent start/recovery. A healthy
// matching service is adopted; replacing only the Agent does not restart it.
func (a *Application) restoreWorkServicesLocked(ctx context.Context, workID string) (string, error) {
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		return "", err
	}
	parent := ctx
	ctx, release := a.serviceEffectContext(ctx, workID, work.ControlVersion)
	defer release()
	services, err := a.Store.Services(ctx, workID, false)
	if err != nil {
		return "", err
	}
	state := "ready"
	for _, service := range services {
		if !service.Enabled {
			continue
		}
		definition, err := contracts.Decode[contracts.ServiceDefinition](strings.NewReader(service.DefinitionJSON), "ServiceDefinitionSchema", serviceRequestLimit)
		if err != nil {
			return "", err
		}
		target := serviceTarget{WorkID: workID, ServiceID: service.ServiceID, Control: work.ControlVersion, Revision: service.DesiredRevision, Enabled: true}
		var mayStart = true
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			if err := a.serviceTargetTx(tx, target); err != nil {
				return err
			}
			binding, err := corestore.ReadServiceRuntimeBinding(tx, workID, service.ServiceID)
			if errors.Is(err, corestore.ErrNotFound) {
				return nil
			}
			if err != nil {
				return err
			}
			if service.LastErrorJSON != nil {
				binding, mayStart = nextServiceRecovery(binding, time.Now().UTC(), false, definition.RestartPolicy)
				return corestore.PutServiceRuntimeBinding(tx, binding)
			}
			return nil
		}); err != nil {
			return "", err
		}
		if !mayStart {
			// Waiting for a persisted retry is not a new runtime failure.
			// Preserve the original diagnostic across Core restarts.
			if definition.Required {
				return "", &serviceRuntimeError{Code: "WORK_OPERATION_FAILED", Stage: "service-recovery"}
			}
			state = "degraded"
			continue
		}
		err = a.runServiceRuntime(ctx, target, definition, false)
		if err != nil {
			if ctx.Err() != nil && parent.Err() == nil {
				return "", errWorkSuperseded
			}
			if ctx.Err() != nil || errors.Is(err, errWorkSuperseded) {
				return "", err
			}
			if publishErr := a.serviceFailure(ctx, target, err, false); publishErr != nil {
				return "", publishErr
			}
			if definition.Required {
				return "", err
			}
			state = "degraded"
		}
	}
	return state, nil
}

func (a *Application) stopWorkServicesLocked(ctx context.Context, workID string, remove bool) error {
	services, err := a.Store.Services(ctx, workID, true)
	if err != nil {
		return err
	}
	var failures []error
	for _, service := range services {
		if err := a.stopServiceRuntime(ctx, workID, service.ServiceID, remove || service.TombstonedAt != nil); err != nil {
			failures = append(failures, err)
			continue
		}
		err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			state := "stopped"
			if !service.Enabled {
				state = "disabled"
			}
			if service.TombstonedAt != nil {
				state = "deleted"
			}
			if remove || service.TombstonedAt != nil {
				if err := updateServiceWorkspaceReference(tx, workID, service.ServiceID, false); err != nil {
					return err
				}
			}
			_, err := tx.Exec(`UPDATE service_heads SET observed_state=? WHERE work_id=? AND service_id=?`, state, workID, service.ServiceID)
			return err
		})
		if err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

func (a *Application) reconcileServices(ctx context.Context) {
	if a.dockerRuntime == nil {
		return
	}
	var ids []string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT id FROM works WHERE desired_state='running' AND observed_state IN ('ready','degraded','failed') AND deleted_at IS NULL`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	}); err != nil {
		return
	}
	for _, workID := range ids {
		a.workQueueMu.Lock()
		if ctx.Err() != nil {
			a.workQueueMu.Unlock()
			return
		}
		if _, loaded := a.serviceRecovering.LoadOrStore(workID, true); loaded {
			a.workQueueMu.Unlock()
			continue
		}
		a.workWG.Add(1)
		a.workQueueMu.Unlock()
		go func(workID string) {
			defer a.workWG.Done()
			defer a.serviceRecovering.Delete(workID)
			value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
			lock := value.(*sync.Mutex)
			if !lock.TryLock() {
				return
			}
			defer lock.Unlock()
			a.reconcileWorkServicesLocked(ctx, workID)
		}(workID)
	}
}
func (a *Application) reconcileWorkServicesLocked(ctx context.Context, workID string) {
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.DesiredState != "running" {
		return
	}
	ctx, release := a.serviceEffectContext(ctx, workID, work.ControlVersion)
	defer release()
	services, err := a.Store.Services(ctx, workID, false)
	if err != nil {
		return
	}
	for _, service := range services {
		if !service.Enabled {
			continue
		}
		var pending bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM operations WHERE work_id=? AND service_id=? AND state IN ('pending','running'))`, workID, service.ServiceID).Scan(&pending)
		}); err != nil || pending {
			continue
		}
		definition, err := contracts.Decode[contracts.ServiceDefinition](strings.NewReader(service.DefinitionJSON), "ServiceDefinitionSchema", serviceRequestLimit)
		if err != nil {
			continue
		}
		target := serviceTarget{WorkID: workID, ServiceID: service.ServiceID, Control: work.ControlVersion, Revision: service.DesiredRevision, Enabled: true}
		probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		view, _, err := a.inspectServiceRuntime(probeCtx, workID, service.ServiceID)
		cancel()
		if err != nil {
			_ = a.serviceFailure(ctx, target, err, true)
			continue
		}
		running := view != nil && view.State != nil && view.State.Running
		healthy := running && service.ObservedState == "ready" && service.AppliedRevision != nil && *service.AppliedRevision == service.DesiredRevision
		verifyExisting := running && service.ObservedState == "unknown"
		var retry bool
		err = a.Store.Write(ctx, func(tx *sql.Tx) error {
			if err := a.serviceTargetTx(tx, target); err != nil {
				return err
			}
			binding, err := corestore.ReadServiceRuntimeBinding(tx, workID, service.ServiceID)
			if errors.Is(err, corestore.ErrNotFound) {
				binding = corestore.ServiceRuntimeBinding{WorkID: workID, ServiceID: service.ServiceID, Revision: service.DesiredRevision, ImageIdentity: service.ResolvedImageDigest}
			} else if err != nil {
				return err
			}
			binding, retry = nextServiceRecovery(binding, time.Now().UTC(), healthy || verifyExisting, definition.RestartPolicy)
			if err := corestore.PutServiceRuntimeBinding(tx, binding); err != nil {
				return err
			}
			if !healthy && !verifyExisting {
				state := "recovering"
				if definition.RestartPolicy == "never" || binding.RecoveryCount >= 3 && !retry {
					state = "failed"
				}
				_, err = tx.Exec(`UPDATE service_heads SET observed_state=? WHERE work_id=? AND service_id=?`, state, workID, service.ServiceID)
			}
			return err
		})
		if err != nil {
			continue
		}
		if retry || verifyExisting {
			if err := a.runServiceRuntime(ctx, target, definition, false); err != nil {
				_ = a.serviceFailure(ctx, target, err, errors.Is(err, dockerengine.ErrStateUnknown))
			}
		}
	}
	_ = a.updateServiceWorkObservation(ctx, workID)
}
