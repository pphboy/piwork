package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
)

func isServiceOperation(kind string) bool {
	switch kind {
	case "create-service", "update-service", "enable-service", "disable-service", "restart-service", "retry-service", "remove-service":
		return true
	}
	return false
}

func serviceOperationTarget(operation corestore.OperationRecord) (serviceTarget, error) {
	var envelope struct {
		Fence corestore.OperationFence `json:"fence"`
	}
	if operation.WorkID == nil || operation.ServiceID == nil || !isServiceOperation(operation.Kind) || json.Unmarshal([]byte(operation.RequestJSON), &envelope) != nil || envelope.Fence.Scope != "service" || envelope.Fence.ServiceRevision != operation.TargetVersion {
		return serviceTarget{}, corestore.ErrStorage
	}
	return serviceTarget{WorkID: *operation.WorkID, ServiceID: *operation.ServiceID, OperationID: operation.ID, Control: envelope.Fence.WorkControlVersion, Revision: envelope.Fence.ServiceRevision, Enabled: envelope.Fence.ServiceEnabled, Removed: envelope.Fence.ServiceTombstoned}, nil
}

func (a *Application) processServiceOperation(ctx context.Context, operation corestore.OperationRecord) error {
	target, err := serviceOperationTarget(operation)
	if err != nil {
		return err
	}
	value, _ := a.workLocks.LoadOrStore(target.WorkID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return err
	}
	defer lock.Unlock()
	parent := ctx
	ctx, release := a.serviceEffectContext(ctx, target.WorkID, target.Control)
	defer release()
	if err := a.serviceTargetCurrent(ctx, target); err != nil {
		if errors.Is(err, errWorkSuperseded) {
			_, err = a.completeDiagnosticOperation(ctx, operation.ID, "superseded", nil, nil, nil)
			if errors.Is(err, corestore.ErrOperationFinal) {
				return nil
			}
		}
		return err
	}
	if operation.State == "pending" {
		if err := a.Store.MarkOperationRunning(ctx, operation.ID); err != nil {
			return err
		}
	}
	ctx = a.traceOperation(ctx, operation)
	var definitionJSON string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT definition_json FROM service_revisions WHERE work_id=? AND service_id=? AND revision=?`, target.WorkID, target.ServiceID, target.Revision).Scan(&definitionJSON)
	}); err != nil {
		return err
	}
	definition, err := contracts.Decode[contracts.ServiceDefinition](strings.NewReader(definitionJSON), "ServiceDefinitionSchema", serviceRequestLimit)
	if err != nil {
		return corestore.ErrStorage
	}
	work, err := a.Store.Work(ctx, target.WorkID, false)
	if err != nil {
		return err
	}
	state := "ready"
	if target.Removed || !target.Enabled || work.DesiredState != "running" {
		err = a.stopServiceRuntime(ctx, target.WorkID, target.ServiceID, target.Removed)
		state = "stopped"
		if !target.Enabled {
			state = "disabled"
		}
		if target.Removed {
			state = "deleted"
		}
	} else {
		err = a.runServiceRuntime(ctx, target, definition, operation.Kind == "restart-service")
	}
	if parent.Err() != nil {
		return parent.Err()
	}
	if ctx.Err() != nil {
		// A newer accepted target cancelled this Engine/RPC operation. The
		// lifecycle worker owns any unanswered creation; never publish ready.
		ctx = parent
		err = errWorkSuperseded
	}
	if errors.Is(err, errWorkSuperseded) {
		_, err = a.completeDiagnosticOperation(ctx, operation.ID, "superseded", nil, nil, nil)
		if errors.Is(err, corestore.ErrOperationFinal) {
			return nil
		}
		return err
	}
	var diagnostic *string
	terminal := "succeeded"
	if err != nil {
		terminal = "failed"
		state = "failed"
		code, stage := "SERVICE_START_FAILED", "service-start"
		if target.Removed {
			code, stage = "WORK_OPERATION_FAILED", "service-remove"
		} else if !target.Enabled || work.DesiredState != "running" {
			code, stage = "WORK_OPERATION_FAILED", "service-stop"
		}
		var runtimeErr *serviceRuntimeError
		if errors.As(err, &runtimeErr) {
			code, stage = runtimeErr.Code, runtimeErr.Stage
		}
		item := map[string]any{"code": code, "stage": stage, "serviceId": target.ServiceID, "correlationId": operation.ID, "message": "Service operation failed.", "remediation": "Correct the service configuration or runtime and retry with a new key.", "retryable": true}
		if runtimeErr != nil && runtimeErr.ExitCode != nil {
			item["exitCode"] = *runtimeErr.ExitCode
		}
		if runtimeErr != nil && runtimeErr.Collection != nil {
			if err := a.retainFailureCollection(ctx, operation.ID, &diagnostics.Failure{Collection: *runtimeErr.Collection}); err != nil {
				return err
			}
		}
		raw, _ := json.Marshal(item)
		text := string(raw)
		diagnostic = &text
	}
	resultJSON, resultErr := a.diagnosticResult(ctx, operation.ID, map[string]any{"observedState": state}, "")
	if resultErr != nil {
		return resultErr
	}
	completed, err := a.completeDiagnosticOperation(ctx, operation.ID, terminal, &resultJSON, diagnostic, func(tx *sql.Tx) error {
		if terminal == "failed" {
			if _, err := tx.Exec(`UPDATE service_heads SET observed_state='failed',last_error_json=? WHERE work_id=? AND service_id=?`, diagnostic, target.WorkID, target.ServiceID); err != nil {
				return err
			}
		} else {
			if target.Removed {
				if err := updateServiceWorkspaceReference(tx, target.WorkID, target.ServiceID, false); err != nil {
					return err
				}
				if err := corestore.ReleaseQuota(tx, target.WorkID, "service", target.ServiceID, true); err != nil {
					return err
				}
			}
			if _, err := tx.Exec(`UPDATE service_heads SET observed_state=?,last_error_json=NULL WHERE work_id=? AND service_id=?`, state, target.WorkID, target.ServiceID); err != nil {
				return err
			}
		}
		// Publish the Work's aggregate state in the same transaction as the
		// terminal Operation, so observers cannot see a stale ready Work.
		return updateServiceWorkObservationTx(tx, target.WorkID)
	})
	if errors.Is(err, corestore.ErrOperationFinal) {
		return nil
	}
	if err == nil && completed.State != "superseded" {
		return nil
	}
	return err
}

// Preserve the Agent repair surface when an optional service fails. A required
// service cannot be presented as a ready Work. No stopped target is reopened.
func (a *Application) updateServiceWorkObservation(ctx context.Context, workID string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		return updateServiceWorkObservationTx(tx, workID)
	})
}

func updateServiceWorkObservationTx(tx *sql.Tx, workID string) error {
	var agentReady bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM runtime_generations g WHERE work_id=? AND state='ready' AND generation=(SELECT MAX(generation) FROM runtime_generations WHERE work_id=?))`, workID, workID).Scan(&agentReady); err != nil {
		return err
	}
	if !agentReady {
		return nil
	}
	services, err := corestore.ReadServices(tx, workID, false)
	if err != nil {
		return err
	}
	state := "ready"
	for _, service := range services {
		if !service.Enabled || service.ObservedState == "ready" {
			continue
		}
		var definition contracts.ServiceDefinition
		if json.Unmarshal([]byte(service.DefinitionJSON), &definition) != nil {
			return corestore.ErrStorage
		}
		if definition.Required {
			state = "failed"
			break
		}
		state = "degraded"
	}
	_, err = tx.Exec(`UPDATE works SET observed_state=?,updated_at=? WHERE id=? AND desired_state='running' AND observed_state IN ('ready','degraded','failed')`, state, packageNow(), workID)
	return err
}
