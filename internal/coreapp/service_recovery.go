package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

type serviceEffect struct {
	Control   int64
	ServiceID string
	Cancel    context.CancelFunc
}

func (a *Application) serviceEffectContext(ctx context.Context, workID string, control int64, serviceID ...string) (context.Context, func()) {
	ctx, cancel := context.WithCancel(ctx)
	effect := &serviceEffect{Control: control, Cancel: cancel}
	if len(serviceID) == 1 {
		effect.ServiceID = serviceID[0]
	}
	a.serviceEffects.Store(workID, effect)
	return ctx, func() { a.serviceEffects.CompareAndDelete(workID, effect); cancel() }
}
func (a *Application) cancelSpecificServiceEffect(workID, serviceID string) {
	if value, ok := a.serviceEffects.Load(workID); ok {
		effect := value.(*serviceEffect)
		if effect.ServiceID == serviceID {
			effect.Cancel()
		}
	}
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
		if code != "SERVICE_STATE_UNCONFIRMED" {
			code = "DOCKER_UNAVAILABLE"
		}
		state = "unknown"
	}
	diagnostic := map[string]any{"code": code, "stage": stage, "serviceId": target.ServiceID}
	if !unknown && failure != nil && failure.ExitCode != nil {
		diagnostic["exitCode"] = *failure.ExitCode
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		current, err := corestore.ReadService(tx, target.WorkID, target.ServiceID, false)
		if err != nil {
			return err
		}
		// A failed automatic attempt does not erase the failure which caused
		// recovery. Explicit user Operations keep their own terminal result.
		if !unknown && current.LastErrorJSON != nil && (current.ObservedState == "recovering" || current.ObservedState == "starting") {
			var previous struct {
				Code  string          `json:"code"`
				Cause json.RawMessage `json:"cause"`
			}
			if json.Unmarshal([]byte(*current.LastErrorJSON), &previous) == nil && (previous.Code == "DOCKER_UNAVAILABLE" || previous.Code == "SERVICE_STATE_UNCONFIRMED") {
				if len(previous.Cause) > 0 {
					_, err := tx.Exec(`UPDATE service_heads SET observed_state=?,last_error_json=? WHERE work_id=? AND service_id=?`, state, string(previous.Cause), target.WorkID, target.ServiceID)
					return err
				}
			} else {
				_, err := tx.Exec(`UPDATE service_heads SET observed_state=? WHERE work_id=? AND service_id=?`, state, target.WorkID, target.ServiceID)
				return err
			}
		}
		if unknown && current.LastErrorJSON != nil {
			var previous struct {
				Code  string          `json:"code"`
				Cause json.RawMessage `json:"cause"`
			}
			if json.Unmarshal([]byte(*current.LastErrorJSON), &previous) == nil {
				if len(previous.Cause) > 0 {
					diagnostic["cause"] = previous.Cause
				} else if previous.Code == "DOCKER_UNAVAILABLE" || previous.Code == "SERVICE_STATE_UNCONFIRMED" {
					// Repeated unknown observations have no earlier root cause.
				} else {
					diagnostic["cause"] = json.RawMessage(*current.LastErrorJSON)
				}
			}
		}
		raw, err := json.Marshal(diagnostic)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE service_heads SET observed_state=?,last_error_json=? WHERE work_id=? AND service_id=?`, state, string(raw), target.WorkID, target.ServiceID)
		return err
	})
}

// A missing container and a confirmed process exit are different facts. In
// particular, Docker's zero default is not evidence of an exit for a container
// which never started or whose state cannot be confirmed.
func observedServiceFailure(view *container.InspectResponse) *serviceRuntimeError {
	if view == nil {
		return &serviceRuntimeError{Code: "SERVICE_INSTANCE_MISSING", Stage: "service-recovery"}
	}
	if view.State != nil && !view.State.Running && view.State.Status == "exited" {
		exitCode := view.State.ExitCode
		return &serviceRuntimeError{Code: "SERVICE_EXITED", Stage: "service-recovery", ExitCode: &exitCode}
	}
	return nil
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
		var temporary bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			_, found, err := corestore.ReadTemporaryServiceTx(tx, workID, service.ServiceID)
			temporary = found
			return err
		}); err != nil {
			return "", err
		}
		if temporary {
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
	work, err := a.Store.Work(ctx, workID, true)
	if err != nil {
		return err
	}
	trigger := "agent-replaced"
	if work.DesiredState == "stopped" {
		trigger = "work-stop"
	}
	if work.DesiredState == "deleted" {
		trigger = "work-delete"
	}
	if a.Status().State == "SHUTTING_DOWN" {
		trigger = "core-shutdown"
	}
	var failures []error
	for _, service := range services {
		var temporary corestore.TemporaryServiceRecord
		var isTemporary bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			temporary, isTemporary, err = corestore.ReadTemporaryServiceTx(tx, workID, service.ServiceID)
			return err
		}); err != nil {
			failures = append(failures, err)
			continue
		}
		if isTemporary {
			if err := a.closeTemporaryRunAndRequestCleanup(ctx, temporary.Owner, trigger); err != nil {
				failures = append(failures, err)
				continue
			}
			if err := a.cleanupTemporaryService(ctx, temporary); err != nil {
				failures = append(failures, err)
			}
			continue
		}
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
		rows, err := tx.Query(`SELECT id FROM works WHERE (desired_state='running' AND observed_state IN ('ready','degraded','failed') AND deleted_at IS NULL)
			OR EXISTS(SELECT 1 FROM control_metadata m WHERE substr(m.key,1,length('run-temporary-service:service:' || works.id || ':'))='run-temporary-service:service:' || works.id || ':')`)
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
			a.reconcileTemporaryServicesLocked(ctx, workID)
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
		var temporary bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			_, found, err := corestore.ReadTemporaryServiceTx(tx, workID, service.ServiceID)
			temporary = found
			return err
		}); err != nil || temporary {
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
			if errors.Is(err, dockerengine.ErrUnavailable) {
				_ = a.serviceFailure(ctx, target, err, true)
			} else {
				_ = a.serviceFailure(ctx, target, &serviceRuntimeError{Code: "SERVICE_STATE_UNCONFIRMED", Stage: "service-recovery"}, true)
			}
			continue
		}
		running := view != nil && view.State != nil && view.State.Running
		if view != nil && !running && (view.State == nil || view.State.Status != "exited") {
			_ = a.serviceFailure(ctx, target, &serviceRuntimeError{Code: "SERVICE_STATE_UNCONFIRMED", Stage: "service-recovery"}, true)
			continue
		}
		healthy := running && service.ObservedState == "ready" && service.AppliedRevision != nil && *service.AppliedRevision == service.DesiredRevision
		verifyExisting := running && service.ObservedState == "unknown"
		observedFailure := observedServiceFailure(view)
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
				if observedFailure != nil && (service.LastErrorJSON == nil || service.ObservedState == "ready" || service.ObservedState == "unknown") {
					diagnostic := map[string]any{"code": observedFailure.Code, "stage": observedFailure.Stage, "serviceId": service.ServiceID}
					if observedFailure.ExitCode != nil {
						diagnostic["exitCode"] = *observedFailure.ExitCode
					}
					if service.ObservedState == "unknown" && service.LastErrorJSON != nil {
						var previous struct {
							Cause json.RawMessage `json:"cause"`
						}
						if json.Unmarshal([]byte(*service.LastErrorJSON), &previous) == nil && len(previous.Cause) > 0 {
							diagnostic["cause"] = previous.Cause
						}
					}
					raw, marshalErr := json.Marshal(diagnostic)
					if marshalErr != nil {
						return marshalErr
					}
					_, err = tx.Exec(`UPDATE service_heads SET observed_state=?,last_error_json=? WHERE work_id=? AND service_id=?`, state, string(raw), workID, service.ServiceID)
				} else {
					_, err = tx.Exec(`UPDATE service_heads SET observed_state=? WHERE work_id=? AND service_id=?`, state, workID, service.ServiceID)
				}
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
