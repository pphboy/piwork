package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func (a *Application) ensureTemporaryCleanupOperation(ctx context.Context, record corestore.TemporaryServiceRecord, trigger string) (acceptedServiceOperation, error) {
	request, err := json.Marshal(map[string]string{"serviceId": record.ServiceID, "runId": record.Owner.RunID})
	if err != nil {
		return acceptedServiceOperation{}, err
	}
	workID, serviceID := record.Owner.WorkID, record.ServiceID
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: "temporary-service-cleanup", WorkScope: workID, Kind: "cleanup-temporary-service", IdempotencyKey: serviceID,
		RequestJSON: string(request), TargetVersion: 1, WorkID: &workID, ServiceID: &serviceID, FenceScope: "none"}, func(tx *sql.Tx, operationID string) (corestore.MutationEffect, error) {
		current, found, err := corestore.ReadTemporaryServiceTx(tx, workID, serviceID)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if !found || current.Owner != record.Owner || current.CreateOperationID != record.CreateOperationID {
			return corestore.MutationEffect{}, corestore.ErrTemporaryIdentity
		}
		now := packageNow()
		if err := corestore.BeginTemporaryCleanupTx(tx, current, trigger, now); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.BindTemporaryCleanupOperationTx(tx, workID, serviceID, operationID, now); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: serviceID}, nil
	})
	if err != nil {
		return acceptedServiceOperation{}, err
	}
	if err := a.Store.MarkOperationRunning(ctx, accepted.OperationID); err != nil && !errors.Is(err, corestore.ErrOperationFinal) {
		return acceptedServiceOperation{}, err
	}
	return serviceAcceptance(workID, accepted), nil
}

func (a *Application) temporaryCleanupEvent(ctx context.Context, record corestore.TemporaryServiceRecord, state, stage, outcome, code string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.AppendTemporaryCleanupEventTx(tx, record.Owner.WorkID, record.ServiceID, state,
			corestore.TemporaryCleanupEvent{At: packageNow(), Stage: stage, Outcome: outcome, Code: code})
	})
}

func (a *Application) temporaryCleanupPending(ctx context.Context, record corestore.TemporaryServiceRecord, stage string, cause error) error {
	code := "WORK_OPERATION_FAILED"
	if errors.Is(cause, dockerengine.ErrUnavailable) || a.dockerRuntime == nil {
		code = "DOCKER_UNAVAILABLE"
	}
	if errors.Is(cause, dockerengine.ErrStateUnknown) || errors.Is(cause, errTemporaryObservationPending) {
		code = "TEMPORARY_CREATE_UNCONFIRMED"
	}
	if err := a.temporaryCleanupEvent(ctx, record, "pending", stage, "unconfirmed", code); err != nil {
		return err
	}
	return cause
}

// Called with the Work lock. Unknown Engine effects keep their charge and a
// durable pending record; an absent binding is different from an unanswered
// create with a binding and cannot be used to infer the latter completed.
func (a *Application) cleanupTemporaryService(ctx context.Context, record corestore.TemporaryServiceRecord) error {
	var cleanup corestore.TemporaryCleanupRecord
	var found bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
		return err
	}); err != nil {
		return err
	}
	if !found {
		return errTemporaryObservationPending
	}
	if cleanup.State == "completed" {
		return nil
	}
	if cleanup.OperationID == "" {
		return errTemporaryObservationPending
	}
	operation, err := a.Store.Operation(ctx, cleanup.OperationID)
	if err != nil {
		return err
	}
	ctx = a.traceOperation(ctx, operation)
	retrying := cleanup.State == "pending"
	if retrying {
		if err := a.temporaryCleanupEvent(ctx, record, "running", "retry", "started", ""); err != nil {
			return err
		}
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "inspect", "started", ""); err != nil {
		return err
	}
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	view, _, err := a.inspectServiceRuntime(probe, record.Owner.WorkID, record.ServiceID)
	cancel()
	if err != nil {
		return a.temporaryCleanupPending(ctx, record, "inspect", err)
	}
	if view != nil && record.ContainerID != "" && view.ID != record.ContainerID {
		return a.temporaryCleanupPending(ctx, record, "inspect", dockerengine.ErrStateUnknown)
	}
	if view != nil && record.State == "launching" {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			return corestore.ConfirmTemporaryContainerTx(tx, record.Owner.WorkID, record.ServiceID, view.ID, packageNow())
		}); err != nil {
			return err
		}
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "inspect", "succeeded", ""); err != nil {
		return err
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "stop", "started", ""); err != nil {
		return err
	}
	if view != nil && view.State != nil && view.State.Running {
		stopCtx, stop := context.WithTimeout(ctx, a.options.WorkStopTimeout+5*time.Second)
		stopped, err := a.dockerRuntime.StopContainer(stopCtx, serviceContainerIdentity(record.Owner.WorkID, record.ServiceID, 0), int(a.options.WorkStopTimeout/time.Second))
		stop()
		if err != nil {
			return a.temporaryCleanupPending(ctx, record, "stop", err)
		}
		if stopped == nil || stopped.ID != view.ID || stopped.State == nil || stopped.State.Running {
			return a.temporaryCleanupPending(ctx, record, "stop", dockerengine.ErrStateUnknown)
		}
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "stop", "succeeded", ""); err != nil {
		return err
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "remove", "started", ""); err != nil {
		return err
	}
	if err := a.stopServiceRuntime(ctx, record.Owner.WorkID, record.ServiceID, true); err != nil {
		return a.temporaryCleanupPending(ctx, record, "remove", err)
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "remove", "succeeded", ""); err != nil {
		return err
	}
	containerID := record.ContainerID
	if view != nil {
		containerID = view.ID
	}
	// Removal can succeed before the archive result event is committed. On a
	// later retry the container is gone, but its persisted original ID still
	// identifies the archive attempt; never substitute a different instance.
	if containerID != "" && cleanup.LogState == "" {
		source, found, logErr := a.Store.LogSourceByContainer(ctx, containerID)
		logCode, outcome := "", "succeeded"
		if logErr != nil || !found || source.State != "archived" {
			logCode, outcome = "LOGS_UNAVAILABLE", "failed"
			if found && source.State == "partial" {
				logCode = "LOGS_PARTIAL"
			}
		}
		if err := a.temporaryCleanupEvent(ctx, record, "running", "logs", outcome, logCode); err != nil {
			return err
		}
	}
	if err := a.temporaryCleanupEvent(ctx, record, "running", "release", "started", ""); err != nil {
		return err
	}
	result, err := a.diagnosticResult(ctx, cleanup.OperationID, map[string]any{"observedState": "deleted"}, "")
	if err != nil {
		return err
	}
	_, err = a.completeDiagnosticOperation(ctx, cleanup.OperationID, "succeeded", &result, nil, func(tx *sql.Tx) error {
		current, found, err := corestore.ReadTemporaryServiceTx(tx, record.Owner.WorkID, record.ServiceID)
		if err != nil {
			return err
		}
		if !found || current.Owner != record.Owner || current.CreateOperationID != record.CreateOperationID {
			return corestore.ErrTemporaryIdentity
		}
		if err := updateServiceWorkspaceReference(tx, record.Owner.WorkID, record.ServiceID, false); err != nil {
			return err
		}
		if err := corestore.ReleaseQuota(tx, record.Owner.WorkID, "service", record.ServiceID, true); err != nil {
			return err
		}
		now := packageNow()
		if _, err := tx.Exec(`UPDATE service_heads SET enabled=0,observed_state='deleted',tombstoned_at=COALESCE(tombstoned_at,?),last_error_json=NULL WHERE work_id=? AND service_id=?`, now, record.Owner.WorkID, record.ServiceID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE operations SET state='superseded',updated_at=? WHERE id=? AND state IN ('pending','running')`, now, record.CreateOperationID); err != nil {
			return err
		}
		if err := updateServiceWorkObservationTx(tx, record.Owner.WorkID); err != nil {
			return err
		}
		if retrying {
			if err := corestore.AppendTemporaryCleanupEventTx(tx, record.Owner.WorkID, record.ServiceID, "running", corestore.TemporaryCleanupEvent{At: now, Stage: "retry", Outcome: "succeeded"}); err != nil {
				return err
			}
		}
		return corestore.AppendTemporaryCleanupEventTx(tx, record.Owner.WorkID, record.ServiceID, "completed", corestore.TemporaryCleanupEvent{At: now, Stage: "release", Outcome: "succeeded"})
	})
	return err
}
