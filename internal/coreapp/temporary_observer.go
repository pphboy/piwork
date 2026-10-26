package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/rpc/agentv1"
)

// Observe an already dispatched one-time command; this path never creates or
// starts a container. A missing/unknown original remains unconfirmed.
func (a *Application) observeTemporaryCommand(ctx context.Context, record corestore.TemporaryServiceRecord) error {
	if record.Mode != "once" || record.State != "launching" && record.State != "created" {
		return nil
	}
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	view, _, err := a.inspectServiceRuntime(probe, record.Owner.WorkID, record.ServiceID)
	cancel()
	if err != nil || view == nil || view.State == nil {
		return errTemporaryObservationPending
	}
	if record.State == "launching" {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.ConfirmTemporaryContainerTx(tx, record.Owner.WorkID, record.ServiceID, view.ID, packageNow())
		}); err != nil {
			return err
		}
		record.State, record.ContainerID = "created", view.ID
	}
	if view.ID != record.ContainerID {
		return errTemporaryObservationPending
	}
	if view.State.Running || view.State.Status != "exited" {
		return errTemporaryObservationPending
	}
	exitCode := view.State.ExitCode
	operation, err := a.Store.Operation(ctx, record.CreateOperationID)
	if err != nil {
		return err
	}
	if operation.State != "pending" && operation.State != "running" {
		return a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.CompleteTemporaryCommandTx(tx, record.Owner.WorkID, record.ServiceID, exitCode, packageNow())
		})
	}
	result, err := a.diagnosticResult(ctx, operation.ID, map[string]any{"observedState": "completed", "exitCode": exitCode}, "")
	if err != nil {
		return err
	}
	terminal, serviceState := "succeeded", "completed"
	var diagnostic *string
	if exitCode != 0 {
		terminal, serviceState = "failed", "failed"
		raw, _ := json.Marshal(map[string]any{"code": "SERVICE_EXITED", "stage": "service-recovery", "serviceId": record.ServiceID, "exitCode": exitCode})
		value := string(raw)
		diagnostic = &value
	}
	_, err = a.completeDiagnosticOperation(ctx, operation.ID, terminal, &result, diagnostic, func(tx *sql.Tx) error {
		if err := corestore.CompleteTemporaryCommandTx(tx, record.Owner.WorkID, record.ServiceID, exitCode, packageNow()); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state=?,last_error_json=? WHERE work_id=? AND service_id=?`, serviceState, diagnostic, record.Owner.WorkID, record.ServiceID)
		return err
	})
	if errors.Is(err, corestore.ErrOperationFinal) {
		return nil
	}
	return err
}

func terminalTemporaryTrigger(state agentv1.RunState) string {
	switch state {
	case agentv1.RunState_RUN_STATE_SUCCEEDED:
		return "run-succeeded"
	case agentv1.RunState_RUN_STATE_FAILED:
		return "run-failed"
	case agentv1.RunState_RUN_STATE_CANCELLED:
		return "run-cancelled"
	case agentv1.RunState_RUN_STATE_INTERRUPTED:
		return "run-interrupted"
	default:
		return ""
	}
}
