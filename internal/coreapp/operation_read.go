package coreapp

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/identity"
	"piwork/internal/workaccess"
)

type safeOperationResult struct {
	ObservedState string                           `json:"observedState,omitempty"`
	Configuration *contracts.WorkConfigurationView `json:"configuration,omitempty"`
}

func operationEnvelopeView(operation corestore.OperationRecord) any {
	correlationID := operation.ID
	var result any
	var diagnostics any = map[string]any{
		"stages": []any{}, "truncated": false,
		"rollback":             map[string]any{"state": "not-required"},
		"diagnosticCollection": map[string]any{"state": "not-attempted"},
	}
	if operation.ResultJSON != nil {
		var envelope struct {
			CorrelationID string          `json:"correlationId"`
			Result        json.RawMessage `json:"result"`
			Diagnostics   json.RawMessage `json:"diagnostics"`
		}
		if json.Unmarshal([]byte(*operation.ResultJSON), &envelope) == nil {
			if validResourceID(envelope.CorrelationID) {
				correlationID = envelope.CorrelationID
			}
			if len(envelope.Result) > 0 && !bytes.Equal(envelope.Result, []byte("null")) {
				var item safeOperationResult
				if value, err := contracts.ParseJSON(bytes.NewReader(envelope.Result), 2<<20); err == nil {
					if object, ok := value.(map[string]any); ok && len(object) == 1 {
						if state, ok := object["observedState"].(string); ok && validObservedState(state) {
							item.ObservedState = state
							result = item
						} else if raw, exists := object["configuration"]; exists {
							encoded, err := json.Marshal(raw)
							if err == nil {
								view, err := contracts.Decode[contracts.WorkConfigurationView](bytes.NewReader(encoded), "WorkConfigurationViewSchema", 2<<20)
								if err == nil && operation.WorkID != nil && string(view.WorkId) == *operation.WorkID {
									item.Configuration = &view
									result = item
								}
							}
						}
					}
				}
			}
			if len(envelope.Diagnostics) > 0 {
				if parsed, err := contracts.Decode[contracts.OperationDiagnostics](bytes.NewReader(envelope.Diagnostics), "OperationDiagnosticsSchema", 64<<10); err == nil {
					stages := make([]any, 0, len(parsed.Stages))
					for _, stage := range parsed.Stages {
						code := string(stage.Code)
						message, _, _, ok := safeDiagnosticText(code)
						if !ok {
							code = "WORK_OPERATION_FAILED"
							message, _, _, _ = safeDiagnosticText(code)
						}
						if stage.Outcome != "failed" {
							message = "Work operation stage changed."
						}
						item := map[string]any{
							"timestamp": stage.Timestamp, "component": stage.Component, "stage": stage.Stage,
							"outcome": stage.Outcome, "code": code, "message": message,
						}
						if stage.SkillName.Present {
							item["skillName"] = stage.SkillName.Value
						}
						if stage.ServiceId.Present {
							item["serviceId"] = stage.ServiceId.Value
						}
						stages = append(stages, item)
					}
					rollback := map[string]any{"state": parsed.Rollback.State}
					if parsed.Rollback.State == "failed" {
						message, remediation, retryable, _ := safeDiagnosticText("ROLLBACK_FAILED")
						rollback["error"] = map[string]any{"code": "ROLLBACK_FAILED", "stage": "rollback", "message": message, "remediation": remediation, "retryable": retryable}
					}
					collection := map[string]any{"state": parsed.DiagnosticCollection.State}
					if parsed.DiagnosticCollection.State == "unavailable" {
						collection["code"] = "DIAGNOSTIC_COLLECTION_FAILED"
					}
					diagnostics = map[string]any{
						"stages": stages, "truncated": parsed.Truncated,
						"rollback":             rollback,
						"diagnosticCollection": collection,
					}
				}
			}
		}
	}
	var diagnostic any
	if operation.ErrorJSON != nil {
		var stored struct {
			Code      string `json:"code"`
			Stage     string `json:"stage"`
			SkillName string `json:"skillName"`
			ExitCode  *int64 `json:"exitCode"`
			ServiceID string `json:"serviceId"`
		}
		if json.Unmarshal([]byte(*operation.ErrorJSON), &stored) == nil && validDiagnosticStage(stored.Stage) {
			if contracts.Validate("DiagnosticCodeSchema", stored.Code) != nil {
				_, known := contracts.ProjectError(contracts.NewError(stored.Code, ""))
				if known.Code == stored.Code && (strings.HasPrefix(stored.Code, "SNAPSHOT_") || strings.HasPrefix(stored.Code, "PACKAGE_") || stored.Code == "EXTERNAL_MCP_SECRET_UNAVAILABLE" || stored.Code == "WORK_NAME_CONFLICT") {
					stored.Code = "WORK_OPERATION_FAILED"
				}
			}
			if message, remediation, retryable, ok := safeDiagnosticText(stored.Code); ok {
				item := map[string]any{"code": stored.Code, "stage": stored.Stage, "message": message, "remediation": remediation, "retryable": retryable}
				if stored.SkillName != "" && contracts.Validate("SkillNameSchema", stored.SkillName) == nil {
					item["skillName"] = stored.SkillName
				}
				if stored.ExitCode != nil && *stored.ExitCode >= -9007199254740991 && *stored.ExitCode <= 9007199254740991 {
					item["exitCode"] = *stored.ExitCode
				}
				if stored.ServiceID != "" && contracts.Validate("ResourceIdSchema", stored.ServiceID) == nil {
					item["serviceId"] = stored.ServiceID
				}
				item["correlationId"] = correlationID
				diagnostic = item
			}
		}
	}
	return map[string]any{
		"operationId": operation.ID, "workId": *operation.WorkID, "kind": operation.Kind,
		"state": operation.State, "createdAt": operation.CreatedAt, "updatedAt": operation.UpdatedAt,
		"correlationId": correlationID, "result": result, "error": diagnostic, "diagnostics": diagnostics,
	}
}

func validObservedState(value string) bool {
	switch value {
	case "provisioning", "starting", "ready", "degraded", "stopping", "stopped", "failed", "deleted":
		return true
	}
	return false
}
func validResourceID(value string) bool {
	if len(value) < 1 || len(value) > 128 {
		return false
	}
	for _, c := range value {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_' || c == '.' || c == ':' {
			continue
		}
		return false
	}
	return true
}
func validDiagnosticStage(value string) bool {
	switch value {
	case "context-copy", "context-validate", "runtime-prepare", "runtime-start", "skill-validate", "skill-load", "package-load", "mcp-initialize", "readiness", "activation", "rollback", "service-accept", "service-image", "service-storage", "service-start", "service-readiness", "service-recovery", "service-stop", "service-remove":
		return true
	}
	return false
}
func safeDiagnosticText(code string) (string, string, bool, bool) {
	if message, remediation, retryable, ok := diagnostics.Text(code); ok {
		return message, remediation, retryable, true
	}
	switch code {
	case "PACKAGE_INCOMPATIBLE", "TARGET_MODEL_UNAVAILABLE", "QUOTA_EXCEEDED":
		_, view := contracts.ProjectError(contracts.NewError(code, ""))
		return view.Message, "Correct the snapshot or recipient condition and retry with a new key.", view.Retryable, true
	case "IMAGE_UNAVAILABLE":
		return "The service image is unavailable.", "Choose an available image and retry the service.", true, true
	case "SERVICE_START_FAILED":
		return "The service could not start.", "Correct the executable or runtime configuration and retry the service.", true, true
	case "SERVICE_EXITED":
		return "The service process exited.", "Inspect service logs and correct the application before retrying.", true, true
	case "SERVICE_READINESS_TIMEOUT":
		return "The service did not become ready in time.", "Check the declared readiness endpoint and retry the service.", true, true
	case "DOCKER_UNAVAILABLE":
		return "The container runtime is unavailable.", "Restore Docker connectivity before retrying.", true, true
	case "WORK_BUSY":
		return "The Work has an active Run.", "Wait for the Run to finish and retry Apply with a new key.", true, true
	case "ROLLBACK_FAILED":
		return "The previous Work runtime could not be restored.", "Correct the runtime dependency and retry the Work.", true, true
	case "WORK_OPERATION_FAILED":
		return "The Work operation failed.", "Inspect the identified stage and correct the configuration before retrying.", false, true
	case "RUNTIME_PREPARE_FAILED":
		return "The Work runtime could not be prepared.", "Restore the runtime dependency and retry with a new key.", true, true
	case "RUNTIME_START_FAILED":
		return "The Work runtime could not be started.", "Restore the runtime dependency and retry with a new key.", true, true
	case "AGENT_EXITED":
		return "The agent runtime exited before becoming ready.", "Inspect this Operation and correct the runtime cause before retrying.", true, true
	case "AGENT_READINESS_TIMEOUT":
		return "The agent runtime did not become ready in time.", "Inspect this Operation and correct the runtime cause before retrying.", true, true
	case "CONTEXT_NOT_FOUND":
		return "The required Work context is unavailable.", "Select a current Work context and retry.", false, true
	}
	return "", "", false, false
}

func (a *Application) operationRead(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	const prefix = "/api/v1/operations/"
	if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.EscapedPath(), prefix) {
		return false, nil
	}
	rawID := strings.TrimPrefix(r.URL.EscapedPath(), prefix)
	if rawID == "" || strings.Contains(rawID, "/") {
		return false, nil
	}
	id, err := url.PathUnescape(rawID)
	if err != nil || !validResourceID(id) {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	operation, err := a.Store.Operation(r.Context(), id)
	if errors.Is(err, corestore.ErrNotFound) {
		view, err := a.archivedSnapshotOperation(r.Context(), actor, id)
		if err != nil {
			return true, err
		}
		send(w, 200, view)
		return true, nil
	}
	if err != nil {
		return true, err
	}
	// Import targets are deliberately unpublished until the transaction succeeds.
	// The accepted job remains queryable by its owner even when no Work exists.
	var job corestore.SnapshotJob
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
		var readErr error
		job, readErr = corestore.ReadSnapshotJob(tx, id)
		return readErr
	})
	if err == nil {
		if err := snapshotOwner(actor, job.OwnerUserID); err != nil {
			return true, err
		}
		operation.WorkID = job.TargetWorkID
		if operation.WorkID == nil {
			operation.WorkID = job.SourceWorkID
		}
		if operation.WorkID == nil {
			return true, corestore.ErrStorage
		}
		send(w, 200, operationEnvelopeView(operation))
		return true, nil
	}
	if !errors.Is(err, corestore.ErrNotFound) {
		return true, err
	}
	if operation.WorkID == nil {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	if _, err := workaccess.WorkOperation(r.Context(), a.Store, actor, *operation.WorkID); err != nil {
		return true, err
	}
	if operation.Kind == "pi-package-install" || operation.Kind == "pi-package-update" || operation.Kind == brainCandidateKind {
		var job corestore.PackageJob
		if err := a.Store.Read(r.Context(), func(tx *sql.Tx) error { var err error; job, err = corestore.ReadPackageJob(tx, id); return err }); err != nil {
			return true, err
		}
		view, err := packageOperationProjection(operation, job)
		if err != nil {
			return true, err
		}
		send(w, 200, view)
		return true, nil
	}
	send(w, 200, operationEnvelopeView(operation))
	return true, nil
}
