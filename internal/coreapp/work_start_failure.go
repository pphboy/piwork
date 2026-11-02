package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

// Fixed boundary/classification only: the underlying error may contain secrets.
func startFailureProjection(workID, operationID, boundary string, cause error) map[string]string {
	if contracts.Validate("ResourceIdSchema", workID) != nil || contracts.Validate("ResourceIdSchema", operationID) != nil {
		return nil
	}
	switch boundary {
	case "initial-context", "captured-start-read", "generation-selection", "retry-admission", "captured-runtime-start":
	default:
		boundary = "other"
	}
	class := "other"
	switch {
	case errors.Is(cause, context.Canceled), errors.Is(cause, context.DeadlineExceeded):
		class = "cancelled"
	case errors.Is(cause, errCapturedWork):
		class = "captured-context"
	case errors.Is(cause, corestore.ErrStorage):
		class = "storage"
	case errors.Is(cause, dockerengine.ErrUnavailable):
		class = "dependency-unavailable"
	}
	return map[string]string{"event": "work.start-failure", "workId": workID, "operationId": operationID, "boundary": boundary, "errorClass": class}
}
func (a *Application) logStartFailureBoundary(workID, operationID, boundary string, cause error) {
	value := startFailureProjection(workID, operationID, boundary, cause)
	if value == nil {
		return
	}
	raw, err := json.Marshal(value)
	if err == nil {
		_, _ = fmt.Fprintln(a.consoleStderr(), string(raw))
	}
}
