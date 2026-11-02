package coreapp

import (
	"context"
	"encoding/json"
	"errors"

	"piwork/internal/corestore"
	"piwork/internal/workruntime"
)

// A preflight failure owns no runtime effect or Work-state transition.
func (a *Application) finishApplyPriorContextFailure(ctx context.Context, operation corestore.OperationRecord, cause error) error {
	if !errors.Is(cause, errCapturedWork) {
		return cause
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	result, err := a.diagnosticResult(ctx, operation.ID, nil, "not-required")
	if err != nil {
		return err
	}
	message, remediation, retryable, _ := safeDiagnosticText("CONTEXT_NOT_FOUND")
	encoded, err := json.Marshal(map[string]any{"code": "CONTEXT_NOT_FOUND", "stage": "context-validate", "message": message, "remediation": remediation, "retryable": retryable})
	if err != nil {
		return err
	}
	diagnostic := string(encoded)
	completed, err := a.completeDiagnosticOperation(ctx, operation.ID, "failed", &result, &diagnostic, nil)
	if err != nil {
		return err
	}
	if completed.State == "superseded" {
		return errWorkSuperseded
	}
	return nil
}

func (a *Application) capturedPriorApplyContext(ctx context.Context, workID, contextID string) (workruntime.StartSpec, capturedWork, error) {
	return a.readCapturedContextSpec(ctx, workID, 1, "inspection", contextID, true, nil, false, true)
}
