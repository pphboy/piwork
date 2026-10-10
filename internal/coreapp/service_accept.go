package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/workaccess"
)

type acceptedServiceOperation struct {
	WorkID        string `json:"workId"`
	ServiceID     string `json:"serviceId"`
	OperationID   string `json:"operationId"`
	CorrelationID string `json:"correlationId"`
	Reused        bool   `json:"reused"`
}

func servicePublicError(err error) error {
	var definition *serviceDefinitionValidationError
	if errors.As(err, &definition) {
		return contracts.NewError("INVALID_SERVICE_DEFINITION", definition.Field)
	}
	switch {
	case errors.Is(err, corestore.ErrIdempotencyConflict):
		return contracts.NewError("IDEMPOTENCY_CONFLICT", "")
	case errors.Is(err, corestore.ErrRevisionConflict):
		return contracts.NewError("REVISION_CONFLICT", "")
	case errors.Is(err, corestore.ErrQuotaExceeded):
		return contracts.NewError("QUOTA_EXCEEDED", "")
	case errors.Is(err, corestore.ErrSnapshotBusy):
		return contracts.NewError("WORK_SNAPSHOT_BUSY", "")
	case errors.Is(err, corestore.ErrNotFound):
		return contracts.NewError("NOT_FOUND", "")
	}
	return err
}
func serviceAcceptance(workID string, accepted corestore.AcceptedMutation) acceptedServiceOperation {
	return acceptedServiceOperation{WorkID: workID, ServiceID: accepted.ResourceID, OperationID: accepted.OperationID, CorrelationID: accepted.OperationID, Reused: accepted.Reused}
}
func (a *Application) serviceAdmission(ctx context.Context, actor serviceActor, workID string) (corestore.WorkRecord, error) {
	var work corestore.WorkRecord
	if a.ctx.Err() != nil || a.Status().State == "SHUTTING_DOWN" {
		return work, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		work, err = a.authorizeServiceTx(tx, actor, workID, workaccess.Control)
		return err
	})
	if err == nil && (work.DesiredState == "deleted" || work.ObservedState == "stopping" || work.ObservedState == "deleting") {
		err = contracts.NewError("FAILED_PRECONDITION", "")
	}
	return work, err
}

func reserveServiceQuota(tx *sql.Tx, workID, serviceID string, definition contracts.ServiceDefinition, tombstone bool) error {
	var raw string
	if err := tx.QueryRow(`SELECT r.config_json FROM works w JOIN work_config_revisions r ON r.work_id=w.id AND r.revision=w.desired_revision WHERE w.id=?`, workID).Scan(&raw); err != nil {
		return err
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(raw), "WorkConfigSchema", 2<<20)
	if err != nil {
		return corestore.ErrStorage
	}
	reservation := corestore.QuotaReservation{WorkID: workID, SubjectKind: "service", SubjectID: serviceID, ServiceSlots: 1, UpdatedAt: packageNow()}
	if tombstone {
		reservation.ServiceSlots = 0
	} else if definition.Enabled {
		reservation.DesiredCPUMillis = definition.CpuMillis
		reservation.DesiredMemoryBytes = 0
	}
	return corestore.ReserveQuota(tx, reservation, corestore.QuotaLimits{CPUMillis: config.Resources.CpuMillis, MemoryBytes: config.Resources.MemoryBytes, MaxServices: &config.Resources.MaxServices, MaxRetainedVolumes: &config.Resources.MaxRetainedVolumes}, corestore.QuotaLimits{CPUMillis: 128000, MemoryBytes: 256 << 30})
}

func updateServiceWorkspaceReference(tx *sql.Tx, workID, serviceID string, used bool) error {
	var volumeID string
	err := tx.QueryRow(`SELECT id FROM volume_records WHERE work_id=? AND volume_role='workspace' AND state IN ('active','retained')`, workID).Scan(&volumeID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	} // Registered when the Work volume is created.
	if err != nil {
		return err
	}
	if used {
		return corestore.AttachVolumeReference(tx, volumeID, "service", serviceID)
	}
	return corestore.DetachVolumeReference(tx, volumeID, "service", serviceID)
}

func (a *Application) acceptServiceDefinition(ctx context.Context, actor serviceActor, workID, serviceID string, expected int64, raw json.RawMessage, key string) (output acceptedServiceOperation, returned error) {
	work, err := a.serviceAdmission(ctx, actor, workID)
	if err != nil {
		return output, err
	}
	finish := a.beginServiceAdmissionDiagnostics(ctx, workID)
	defer func() { finish(output, returned) }()
	input, err := normalizeServiceDefinition(raw)
	if err != nil {
		return output, err
	}
	kind := "create-service"
	revision := int64(1)
	// Version the normalized request, not the immutable historical receipts.
	// This separates new zero-default requests from the old 128-MiB default.
	request := map[string]any{"definition": input, "normalizationVersion": 2}
	if serviceID != "" {
		if expected < 1 || expected >= contracts.MaxSafeInteger {
			return output, contracts.NewError("INVALID_REQUEST", "expectedRevision")
		}
		kind = "update-service"
		revision = expected + 1
		request["expectedRevision"] = expected
		request["serviceId"] = serviceID
	} else {
		serviceID = "service-" + uuid.NewString()
	}
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return output, err
	}
	prior, found, replayErr := a.Store.FindAcceptedMutation(ctx, actor.key(), workID, kind, key, string(requestJSON))
	if errors.Is(replayErr, corestore.ErrIdempotencyConflict) {
		var fields map[string]json.RawMessage
		if json.Unmarshal(raw, &fields) != nil {
			return output, contracts.NewError("INVALID_REQUEST", "definition")
		}
		legacy := input
		if _, specified := fields["memoryBytes"]; !specified {
			legacy.MemoryBytes = contracts.Supplied(int64(128 << 20))
		}
		legacyRequest := make(map[string]any, len(request))
		for name, value := range request {
			if name != "normalizationVersion" {
				legacyRequest[name] = value
			}
		}
		legacyRequest["definition"] = legacy
		legacyJSON, marshalErr := json.Marshal(legacyRequest)
		if marshalErr != nil {
			return output, marshalErr
		}
		prior, found, replayErr = a.Store.FindAcceptedMutation(ctx, actor.key(), workID, kind, key, string(legacyJSON))
	}
	if replayErr != nil {
		return output, servicePublicError(replayErr)
	}
	if found {
		return serviceAcceptance(workID, prior), nil
	}
	definition := assignServiceDefinition(input, serviceID, revision)
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.key(), WorkScope: workID, Kind: kind, IdempotencyKey: key, RequestJSON: string(requestJSON), TargetVersion: revision, WorkID: &workID, ServiceID: &serviceID, ExpectedWorkVersion: &work.ControlVersion, FenceScope: "service"}, func(tx *sql.Tx, operationID string) (corestore.MutationEffect, error) {
		currentWork, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Control)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if currentWork.DesiredState == "deleted" || currentWork.ObservedState == "stopping" || currentWork.ObservedState == "deleting" {
			return corestore.MutationEffect{}, contracts.NewError("FAILED_PRECONDITION", "")
		}
		var image *string
		if kind == "update-service" {
			current, err := corestore.ReadService(tx, workID, serviceID, false)
			if err != nil {
				return corestore.MutationEffect{}, err
			}
			if current.DesiredRevision != expected {
				return corestore.MutationEffect{}, corestore.ErrRevisionConflict
			}
			if current.Name != input.Name {
				return corestore.MutationEffect{}, contracts.NewError("FAILED_PRECONDITION", "name")
			}
			old, err := contracts.Decode[contracts.ServiceDefinition](strings.NewReader(current.DefinitionJSON), "ServiceDefinitionSchema", serviceRequestLimit)
			if err != nil {
				return corestore.MutationEffect{}, corestore.ErrStorage
			}
			if old.Image.Reference == definition.Image.Reference {
				image = current.ResolvedImageDigest
			}
		} else {
			var exists bool
			if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM service_heads WHERE work_id=? AND name=?)`, workID, definition.Name).Scan(&exists); err != nil {
				return corestore.MutationEffect{}, err
			}
			if exists {
				return corestore.MutationEffect{}, contracts.NewError("CONFLICT", "name")
			}
		}
		if err := reserveServiceQuota(tx, workID, serviceID, definition, false); err != nil {
			return corestore.MutationEffect{}, err
		}
		encoded, err := json.Marshal(definition)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		now := packageNow()
		if _, err := tx.Exec(`INSERT INTO service_revisions(work_id,service_id,revision,definition_json,resolved_image_digest,created_at) VALUES(?,?,?,?,?,?)`, workID, serviceID, revision, string(encoded), image, now); err != nil {
			return corestore.MutationEffect{}, err
		}
		if kind == "create-service" {
			if _, err := tx.Exec(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,applied_revision,enabled,observed_state,tombstoned_at,last_error_json) VALUES(?,?,?,1,NULL,?,'pending',NULL,NULL)`, workID, serviceID, definition.Name, definition.Enabled); err != nil {
				return corestore.MutationEffect{}, err
			}
			if _, err := corestore.AssignWorkNetworkName(tx, workID, now); err != nil {
				return corestore.MutationEffect{}, err
			}
			if _, err := corestore.AssignServiceDomainLabel(tx, workID, serviceID, definition.Name, now); err != nil {
				return corestore.MutationEffect{}, err
			}
		} else if _, err := tx.Exec(`UPDATE service_heads SET desired_revision=?,enabled=? WHERE work_id=? AND service_id=?`, revision, definition.Enabled, workID, serviceID); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := updateServiceWorkspaceReference(tx, workID, serviceID, len(definition.Mounts) > 0); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.Exec(`UPDATE operations SET state='superseded',updated_at=? WHERE work_id=? AND service_id=? AND id!=? AND state IN ('pending','running')`, now, workID, serviceID, operationID); err != nil {
			return corestore.MutationEffect{}, err
		}
		result := serviceAcceptanceDiagnostics(operationID, serviceID)
		return corestore.MutationEffect{ResourceID: serviceID, ResultJSON: &result}, nil
	})
	if err != nil {
		return output, servicePublicError(err)
	}
	return serviceAcceptance(workID, accepted), nil
}

func (a *Application) acceptServiceAction(ctx context.Context, actor serviceActor, workID, serviceID, action, key string) (output acceptedServiceOperation, returned error) {
	if action == "start" {
		action = "enable"
	}
	if action == "stop" {
		action = "disable"
	}
	if action != "enable" && action != "disable" && action != "restart" && action != "retry" && action != "remove" {
		return output, contracts.NewError("INVALID_REQUEST", "")
	}
	work, err := a.serviceAdmission(ctx, actor, workID)
	if err != nil {
		return output, err
	}
	finish := a.beginServiceAdmissionDiagnostics(ctx, workID)
	defer func() { finish(output, returned) }()
	current, err := a.Store.Service(ctx, workID, serviceID, action == "remove")
	if err != nil {
		return output, servicePublicError(err)
	}
	requestJSON, _ := json.Marshal(map[string]string{"serviceId": serviceID, "action": action})
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.key(), WorkScope: workID, Kind: action + "-service", IdempotencyKey: key, RequestJSON: string(requestJSON), TargetVersion: current.DesiredRevision, WorkID: &workID, ServiceID: &serviceID, ExpectedWorkVersion: &work.ControlVersion, FenceScope: "service"}, func(tx *sql.Tx, operationID string) (corestore.MutationEffect, error) {
		currentWork, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Control)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if currentWork.DesiredState == "deleted" || currentWork.ObservedState == "stopping" || currentWork.ObservedState == "deleting" {
			return corestore.MutationEffect{}, contracts.NewError("FAILED_PRECONDITION", "")
		}
		service, err := corestore.ReadService(tx, workID, serviceID, action == "remove")
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if service.DesiredRevision != current.DesiredRevision {
			return corestore.MutationEffect{}, corestore.ErrRevisionConflict
		}
		if action == "restart" && (!service.Enabled || currentWork.DesiredState != "running") || action == "retry" && !service.Enabled {
			return corestore.MutationEffect{}, contracts.NewError("FAILED_PRECONDITION", "")
		}
		definition, err := contracts.Decode[contracts.ServiceDefinition](strings.NewReader(service.DefinitionJSON), "ServiceDefinitionSchema", serviceRequestLimit)
		if err != nil {
			return corestore.MutationEffect{}, corestore.ErrStorage
		}
		definition.Enabled = service.Enabled
		if action == "enable" {
			definition.Enabled = true
		}
		if action == "disable" || action == "remove" {
			definition.Enabled = false
		}
		if err := reserveServiceQuota(tx, workID, serviceID, definition, action == "remove"); err != nil {
			return corestore.MutationEffect{}, err
		}
		var tombstone *string
		if action == "remove" {
			stamp := packageNow()
			tombstone = &stamp
		}
		if _, err := tx.Exec(`UPDATE service_heads SET enabled=?,tombstoned_at=COALESCE(?,tombstoned_at) WHERE work_id=? AND service_id=?`, definition.Enabled, tombstone, workID, serviceID); err != nil {
			return corestore.MutationEffect{}, err
		}
		if action == "retry" {
			binding, err := corestore.ReadServiceRuntimeBinding(tx, workID, serviceID)
			if errors.Is(err, corestore.ErrNotFound) {
				binding = corestore.ServiceRuntimeBinding{WorkID: workID, ServiceID: serviceID, Revision: service.DesiredRevision, ImageIdentity: service.ResolvedImageDigest}
			} else if err != nil {
				return corestore.MutationEffect{}, err
			}
			binding.RecoveryCount = 0
			binding.RecoveryWindowStartedAt = nil
			binding.NextRetryAt = nil
			binding.ReadySince = nil
			binding.UpdatedAt = packageNow()
			if err := corestore.PutServiceRuntimeBinding(tx, binding); err != nil {
				return corestore.MutationEffect{}, err
			}
		}
		if _, err := tx.Exec(`UPDATE operations SET state='superseded',updated_at=? WHERE work_id=? AND service_id=? AND id!=? AND state IN ('pending','running')`, packageNow(), workID, serviceID, operationID); err != nil {
			return corestore.MutationEffect{}, err
		}
		result := serviceAcceptanceDiagnostics(operationID, serviceID)
		return corestore.MutationEffect{ResourceID: serviceID, ResultJSON: &result}, nil
	})
	if err != nil {
		return output, servicePublicError(err)
	}
	return serviceAcceptance(workID, accepted), nil
}

func (a *Application) beginServiceAdmissionDiagnostics(ctx context.Context, workID string) func(acceptedServiceOperation, error) {
	trace := traceFrom(ctx)
	if trace == nil {
		trace = &operationTrace{app: a, work: workID, correlation: string(requestCorrelation()), preacceptDiagnostics: diagnostics.Empty()}
	}
	trace.work = workID
	event := diagnostics.Event{Component: "core", Stage: "service-accept", Outcome: "started", Code: "INVALID_SERVICE_DEFINITION"}
	_ = trace.observe(ctx, event)
	return func(output acceptedServiceOperation, err error) {
		event.Outcome = "succeeded"
		event.ServiceID = output.ServiceID
		if err != nil {
			event.Outcome = "failed"
			_, view := contracts.ProjectError(servicePublicError(err))
			if contracts.Validate("DiagnosticCodeSchema", view.Code) == nil {
				event.Code = view.Code
			} else {
				event.Code = "WORK_OPERATION_FAILED"
			}
		}
		if err == nil {
			diagnostics.Write(os.Stderr, event, workID, output.OperationID, trace.correlation)
		} else {
			_ = trace.observe(ctx, event)
		}
	}
}
func serviceAcceptanceDiagnostics(operationID, serviceID string) string {
	v := diagnosticEnvelope{CorrelationID: operationID, Diagnostics: diagnostics.Empty()}
	v.Diagnostics = diagnostics.Append(v.Diagnostics, diagnostics.Event{Component: "core", Stage: "service-accept", Outcome: "succeeded", Code: "INVALID_SERVICE_DEFINITION", ServiceID: serviceID})
	raw, _ := json.Marshal(v)
	return string(raw)
}
