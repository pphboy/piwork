package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/workruntime"
)

type traceKey struct{}
type operationTrace struct {
	app                          *Application
	work, operation, correlation string
	preacceptFailed              bool
	preacceptDiagnostics         contracts.OperationDiagnostics
}

func (a *Application) traceOperation(ctx context.Context, operation corestore.OperationRecord) context.Context {
	work := ""
	if operation.WorkID != nil {
		work = *operation.WorkID
	}
	correlation := decodeDiagnosticEnvelope(operation.ResultJSON, operation.ID).CorrelationID
	return context.WithValue(ctx, traceKey{}, &operationTrace{app: a, work: work, operation: operation.ID, correlation: correlation})
}
func traceFrom(ctx context.Context) *operationTrace {
	value, _ := ctx.Value(traceKey{}).(*operationTrace)
	return value
}

type diagnosticEnvelope struct {
	CorrelationID string                         `json:"correlationId"`
	Result        any                            `json:"result"`
	Diagnostics   contracts.OperationDiagnostics `json:"diagnostics"`
}

func decodeDiagnosticEnvelope(raw *string, correlation string) diagnosticEnvelope {
	v := diagnosticEnvelope{CorrelationID: correlation, Diagnostics: diagnostics.Empty()}
	if raw == nil {
		return v
	}
	var stored diagnosticEnvelope
	if json.Unmarshal([]byte(*raw), &stored) == nil {
		if contracts.Validate("ResourceIdSchema", stored.CorrelationID) == nil {
			v.CorrelationID = stored.CorrelationID
		}
		v.Result = stored.Result
		if contracts.Validate("OperationDiagnosticsSchema", stored.Diagnostics) == nil {
			v.Diagnostics = stored.Diagnostics
		}
	}
	return v
}
func (t *operationTrace) observe(ctx context.Context, event diagnostics.Event) error {
	event, ok := diagnostics.SafeEvent(event)
	if !ok {
		return corestore.ErrStorage
	}
	diagnostics.Write(os.Stderr, event, t.work, t.operation, t.correlation)
	if t.operation == "" {
		if event.Outcome == "failed" {
			t.preacceptFailed = true
		}
		t.preacceptDiagnostics = diagnostics.Append(t.preacceptDiagnostics, event)
		return nil
	}
	err := t.app.Store.Write(ctx, func(tx *sql.Tx) error {
		key := "diagnostic_attempt_" + t.operation + "_" + event.Component + "_" + event.Stage + "_" + event.SkillName + "_" + event.ServiceID
		if event.Outcome == "started" {
			raw, _ := json.Marshal(struct {
				OperationID string
				Event       diagnostics.Event
			}{t.operation, event})
			_, err := tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, key, string(raw), packageNow())
			return err
		}
		var raw *string
		if err := tx.QueryRow(`SELECT result_json FROM operations WHERE id=?`, t.operation).Scan(&raw); err != nil {
			return err
		}
		v := decodeDiagnosticEnvelope(raw, t.correlation)
		v.Diagnostics = diagnostics.Append(v.Diagnostics, event)
		encoded, err := json.Marshal(v)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE operations SET result_json=?,updated_at=? WHERE id=? AND state IN ('pending','running')`, string(encoded), packageNow(), t.operation); err != nil {
			return err
		}
		_, err = tx.Exec(`DELETE FROM control_metadata WHERE key=?`, key)
		return err
	})
	if err != nil {
		diagnostics.Write(os.Stderr, diagnostics.Event{Component: "core", Stage: event.Stage, Outcome: "failed", Code: "DIAGNOSTIC_PERSIST_FAILED"}, t.work, t.operation, t.correlation)
	}
	return err
}

func (a *Application) recoverDiagnosticAttempts(ctx context.Context) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT key,value_json FROM control_metadata WHERE key GLOB 'diagnostic_attempt_*' ORDER BY updated_at,key`)
		if err != nil {
			return err
		}
		type pending struct{ Key, Raw string }
		values := []pending{}
		for rows.Next() {
			var p pending
			if err := rows.Scan(&p.Key, &p.Raw); err != nil {
				rows.Close()
				return err
			}
			values = append(values, p)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, p := range values {
			var attempt struct {
				OperationID string
				Event       diagnostics.Event
			}
			if strictMetadata([]byte(p.Raw), &attempt) != nil || !strings.HasPrefix(p.Key, "diagnostic_attempt_"+attempt.OperationID+"_") || contracts.Validate("ResourceIdSchema", attempt.OperationID) != nil {
				return corestore.ErrStorage
			}
			var raw *string
			var state string
			var work *string
			if err := tx.QueryRow(`SELECT result_json,state,work_id FROM operations WHERE id=?`, attempt.OperationID).Scan(&raw, &state, &work); err != nil {
				return err
			}
			if state == "pending" || state == "running" {
				attempt.Event.Outcome = "interrupted"
				if _, ok := diagnostics.SafeEvent(attempt.Event); !ok {
					return corestore.ErrStorage
				}
				v := decodeDiagnosticEnvelope(raw, attempt.OperationID)
				v.Diagnostics = diagnostics.Append(v.Diagnostics, attempt.Event)
				encoded, _ := json.Marshal(v)
				if _, err := tx.Exec(`UPDATE operations SET result_json=? WHERE id=?`, string(encoded), attempt.OperationID); err != nil {
					return err
				}
				workID := ""
				if work != nil {
					workID = *work
				}
				diagnostics.Write(os.Stderr, attempt.Event, workID, attempt.OperationID, v.CorrelationID)
			}
			if _, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, p.Key); err != nil {
				return err
			}
		}
		return nil
	})
}

func (a *Application) completeDiagnosticOperation(ctx context.Context, id, state string, result, errorJSON *string, publish func(*sql.Tx) error) (corestore.OperationRecord, error) {
	operation, err := a.Store.CompleteOperation(ctx, id, state, result, errorJSON, func(tx *sql.Tx) error {
		if publish != nil {
			if err := publish(tx); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`DELETE FROM control_metadata WHERE key GLOB ?`, "diagnostic_attempt_"+id+"_*")
		return err
	})
	if err != nil && !errors.Is(err, corestore.ErrOperationFinal) {
		work, corr := "", id
		if trace := traceFrom(ctx); trace != nil {
			work, corr = trace.work, trace.correlation
		}
		diagnostics.Write(os.Stderr, diagnostics.Event{Component: "core", Stage: "activation", Outcome: "failed", Code: "DIAGNOSTIC_PERSIST_FAILED"}, work, id, corr)
	}
	if err == nil && (operation.State == "succeeded" || operation.State == "failed") && result != nil {
		v := decodeDiagnosticEnvelope(result, id)
		if len(v.Diagnostics.Stages) > 0 {
			last := v.Diagnostics.Stages[len(v.Diagnostics.Stages)-1]
			if last.Stage == "activation" || last.Stage == "rollback" {
				work := ""
				if operation.WorkID != nil {
					work = *operation.WorkID
				}
				diagnostics.Write(os.Stderr, diagnostics.Event{Component: last.Component, Stage: string(last.Stage), Outcome: last.Outcome, Code: string(last.Code)}, work, id, v.CorrelationID)
			}
		}
	}
	return operation, err
}
func (a *Application) retainFailureCollection(ctx context.Context, operation string, failure *diagnostics.Failure) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		var raw *string
		if err := tx.QueryRow(`SELECT result_json FROM operations WHERE id=?`, operation).Scan(&raw); err != nil {
			return err
		}
		v := decodeDiagnosticEnvelope(raw, operation)
		// Preserve the candidate collection when rollback is attempted later.
		if v.Diagnostics.DiagnosticCollection.State == "not-attempted" {
			v.Diagnostics.DiagnosticCollection = failure.Collection
		}
		encoded, err := json.Marshal(v)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`UPDATE operations SET result_json=? WHERE id=? AND state IN ('pending','running')`, string(encoded), operation)
		return err
	})
}
func (a *Application) diagnosticResult(ctx context.Context, id string, result any, rollback string) (string, error) {
	operation, err := a.Store.Operation(ctx, id)
	if err != nil {
		return "", err
	}
	v := decodeDiagnosticEnvelope(operation.ResultJSON, id)
	v.Result = result
	if rollback != "" {
		v.Diagnostics.Rollback.State = rollback
		if rollback == "failed" {
			d := safeFailure("ROLLBACK_FAILED", "rollback", nil)
			v.Diagnostics.Rollback.Error = contracts.Supplied(d)
		}
		if rollback == "succeeded" || rollback == "failed" {
			v.Diagnostics = diagnostics.Append(v.Diagnostics, diagnostics.Event{Component: "core", Stage: "rollback", Outcome: rollback, Code: "ROLLBACK_FAILED"})
		}
	}
	raw, err := json.Marshal(v)
	return string(raw), err
}
func safeFailure(code, stage string, failure *diagnostics.Failure) contracts.SafeDiagnostic {
	message, remediation, retryable, ok := diagnostics.Text(code)
	if !ok {
		code = "WORK_OPERATION_FAILED"
		message, remediation, retryable, _ = diagnostics.Text(code)
	}
	d := contracts.SafeDiagnostic{Code: contracts.DiagnosticCode(code), Stage: contracts.DiagnosticStage(stage), Message: message, Remediation: remediation, Retryable: retryable}
	if failure != nil {
		if errors.Is(failure, workruntime.ErrAgents) {
			d.Message = "The captured AGENTS.md instructions are unavailable or invalid."
			d.Remediation = "Correct the Work AGENTS instructions and apply with a new key."
		}
		if failure.SkillName != "" && contracts.Validate("SkillNameSchema", failure.SkillName) == nil {
			d.SkillName = contracts.Supplied(contracts.SkillName(failure.SkillName))
		}
		if failure.ExitCode != nil {
			d.ExitCode = contracts.Supplied(*failure.ExitCode)
		}
	}
	return d
}
func diagnosticCause(err error, defaultCode, defaultStage string) contracts.SafeDiagnostic {
	var f *diagnostics.Failure
	if errors.As(err, &f) {
		return safeFailure(f.Code, f.Stage, f)
	}
	return safeFailure(defaultCode, defaultStage, nil)
}
