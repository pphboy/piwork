package corestore

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"piwork/internal/contracts"
)

var ErrIdempotencyConflict = errors.New("idempotency key was already used with different content")
var ErrRevisionConflict = errors.New("resource control version changed")
var ErrSnapshotBusy = errors.New("Work is locked by a snapshot operation")
var ErrOperationFinal = errors.New("operation already has a terminal result")

type MutationRequest struct {
	PrincipalID         string
	WorkScope           string
	Kind                string
	IdempotencyKey      string
	RequestJSON         string
	TargetVersion       int64
	WorkID              *string
	ServiceID           *string
	ExpectedWorkVersion *int64
	// none: Core-scope or a job with its own durable publication fence.
	// work/configuration/service: capture and check the corresponding state.
	FenceScope string
	Now        string
	fault      func(string) error
}
type MutationEffect struct {
	ResourceID string
	ResultJSON *string
	WorkID     *string
	ServiceID  *string
}
type AcceptedMutation struct {
	OperationID string
	ResourceID  string
	Reused      bool
}
type OperationFence struct {
	Scope                 string `json:"scope"`
	WorkControlVersion    int64  `json:"workControlVersion"`
	ConfigurationRevision int64  `json:"configurationRevision"`
	ServiceRevision       int64  `json:"serviceRevision"`
	ServiceEnabled        bool   `json:"serviceEnabled"`
	ServiceTombstoned     bool   `json:"serviceTombstoned"`
}
type operationRequest struct {
	Request json.RawMessage `json:"request"`
	Fence   OperationFence  `json:"fence"`
}
type OperationRecord struct {
	ID            string
	WorkID        *string
	ServiceID     *string
	Kind          string
	State         string
	TargetVersion int64
	RequestJSON   string `json:"-"`
	ResultJSON    *string
	ErrorJSON     *string
	CreatedAt     string
	UpdatedAt     string
}

func operationID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return "operation-" + hex.EncodeToString(bytes[:]), nil
}
func nowTimestamp(value string) string {
	if value == "" {
		return time.Now().UTC().Format(time.RFC3339Nano)
	}
	return value
}

// FindAcceptedMutation lets callers replay a committed request before doing
// costly or currently unavailable dependency checks. AcceptMutation still
// performs the definitive lookup inside its write transaction.
func (s *Store) FindAcceptedMutation(ctx context.Context, principalID, workScope, kind, key, requestJSON string) (AcceptedMutation, bool, error) {
	var accepted AcceptedMutation
	if principalID == "" || workScope == "" || kind == "" || key == "" || len(key) > 256 {
		return accepted, false, contracts.NewError("INVALID_REQUEST", "")
	}
	value, err := contracts.ParseJSON(strings.NewReader(requestJSON), 2<<20)
	if err != nil {
		return accepted, false, err
	}
	digest, err := contracts.PrivateDigest("mutation/"+kind, value)
	if err != nil {
		return accepted, false, err
	}
	var priorDigest string
	err = s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT request_digest,resource_id,operation_id FROM idempotency_records WHERE principal_id=? AND work_scope=? AND operation_kind=? AND idempotency_key=?`, principalID, workScope, kind, key).Scan(&priorDigest, &accepted.ResourceID, &accepted.OperationID)
	})
	if errors.Is(err, sql.ErrNoRows) {
		return AcceptedMutation{}, false, nil
	}
	if err != nil {
		return AcceptedMutation{}, false, err
	}
	// A row with a different digest cannot be returned as a successful replay.
	if priorDigest != digest {
		return AcceptedMutation{}, false, ErrIdempotencyConflict
	}
	accepted.Reused = true
	return accepted, true, nil
}
func (s *Store) AcceptMutation(ctx context.Context, request MutationRequest, effect func(*sql.Tx, string) (MutationEffect, error)) (AcceptedMutation, error) {
	var accepted AcceptedMutation
	if request.PrincipalID == "" || request.WorkScope == "" || request.Kind == "" || request.IdempotencyKey == "" || len(request.IdempotencyKey) > 256 || request.TargetVersion < 1 || request.TargetVersion > contracts.MaxSafeInteger {
		return accepted, contracts.NewError("INVALID_REQUEST", "")
	}
	if request.FenceScope == "" {
		request.FenceScope = "none"
	}
	if request.FenceScope != "none" && request.FenceScope != "work" && request.FenceScope != "configuration" && request.FenceScope != "service" {
		return accepted, contracts.NewError("INVALID_REQUEST", "")
	}
	value, err := contracts.ParseJSON(strings.NewReader(request.RequestJSON), 2<<20)
	if err != nil {
		return accepted, err
	}
	canonical, err := contracts.EncodeCanonicalJSON(value)
	if err != nil {
		return accepted, err
	}
	digest, err := contracts.PrivateDigest("mutation/"+request.Kind, value)
	if err != nil {
		return accepted, err
	}
	err = s.Write(ctx, func(tx *sql.Tx) error {
		var priorDigest string
		err := tx.QueryRow(`SELECT request_digest,resource_id,operation_id FROM idempotency_records WHERE principal_id=? AND work_scope=? AND operation_kind=? AND idempotency_key=?`, request.PrincipalID, request.WorkScope, request.Kind, request.IdempotencyKey).Scan(&priorDigest, &accepted.ResourceID, &accepted.OperationID)
		if err == nil {
			if priorDigest != digest {
				return ErrIdempotencyConflict
			}
			accepted.Reused = true
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if request.WorkID != nil {
			var locked int
			if err := tx.QueryRow("SELECT count(*) FROM work_snapshot_locks WHERE work_id=?", *request.WorkID).Scan(&locked); err != nil {
				return err
			}
			if locked != 0 && request.Kind != "export-work" {
				return ErrSnapshotBusy
			}
		}
		if request.ExpectedWorkVersion != nil {
			if request.WorkID == nil {
				return contracts.NewError("INVALID_REQUEST", "")
			}
			var actual int64
			if err := tx.QueryRow("SELECT control_version FROM works WHERE id=?", *request.WorkID).Scan(&actual); err != nil || actual != *request.ExpectedWorkVersion {
				return ErrRevisionConflict
			}
		}
		id, err := operationID()
		if err != nil {
			return ErrStorage
		}
		now := nowTimestamp(request.Now)
		if _, err := tx.Exec(`INSERT INTO operations(id,work_id,service_id,kind,state,target_version,request_json,created_at,updated_at) VALUES(?,?,?,?,'pending',?,?,?,?)`, id, request.WorkID, request.ServiceID, request.Kind, request.TargetVersion, string(canonical), now, now); err != nil {
			return err
		}
		result, err := effect(tx, id)
		if err != nil {
			return err
		}
		if result.ResourceID == "" {
			return contracts.NewError("INVALID_REQUEST", "")
		}
		workID, serviceID := request.WorkID, request.ServiceID
		if result.WorkID != nil {
			workID = result.WorkID
		}
		if result.ServiceID != nil {
			serviceID = result.ServiceID
		}
		fence, err := captureFence(tx, request.FenceScope, workID, serviceID, request.TargetVersion)
		if err != nil {
			return err
		}
		envelope, err := json.Marshal(operationRequest{Request: canonical, Fence: fence})
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE operations SET work_id=?,service_id=?,request_json=?,result_json=? WHERE id=?`, workID, serviceID, string(envelope), result.ResultJSON, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO idempotency_records(principal_id,work_scope,operation_kind,idempotency_key,request_digest,resource_id,operation_id,created_at) VALUES(?,?,?,?,?,?,?,?)`, request.PrincipalID, request.WorkScope, request.Kind, request.IdempotencyKey, digest, result.ResourceID, id, now); err != nil {
			return err
		}
		accepted = AcceptedMutation{OperationID: id, ResourceID: result.ResourceID}
		if request.fault != nil {
			return request.fault("before-accept-commit")
		}
		return nil
	})
	if err != nil {
		return AcceptedMutation{}, err
	}
	if !accepted.Reused && request.fault != nil {
		if err := request.fault("after-accept-commit"); err != nil {
			return accepted, err
		}
	}
	return accepted, nil
}
func captureFence(tx *sql.Tx, scope string, workID, serviceID *string, target int64) (OperationFence, error) {
	fence := OperationFence{Scope: scope}
	if scope == "none" {
		return fence, nil
	}
	if workID == nil {
		return fence, ErrRevisionConflict
	}
	if err := tx.QueryRow("SELECT control_version,desired_revision FROM works WHERE id=?", *workID).Scan(&fence.WorkControlVersion, &fence.ConfigurationRevision); err != nil {
		return fence, ErrRevisionConflict
	}
	if scope == "work" && fence.WorkControlVersion != target {
		return fence, ErrRevisionConflict
	}
	if scope == "configuration" && fence.ConfigurationRevision != target {
		return fence, ErrRevisionConflict
	}
	if scope == "service" {
		if serviceID == nil {
			return fence, ErrRevisionConflict
		}
		if err := tx.QueryRow(`SELECT desired_revision,enabled,tombstoned_at IS NOT NULL FROM service_heads WHERE work_id=? AND service_id=?`, *workID, *serviceID).Scan(&fence.ServiceRevision, &fence.ServiceEnabled, &fence.ServiceTombstoned); err != nil || fence.ServiceRevision != target {
			return fence, ErrRevisionConflict
		}
	}
	return fence, nil
}
func readOperation(tx *sql.Tx, id string) (OperationRecord, error) {
	var operation OperationRecord
	err := tx.QueryRow(`SELECT id,work_id,service_id,kind,state,target_version,request_json,result_json,error_json,created_at,updated_at FROM operations WHERE id=?`, id).Scan(&operation.ID, &operation.WorkID, &operation.ServiceID, &operation.Kind, &operation.State, &operation.TargetVersion, &operation.RequestJSON, &operation.ResultJSON, &operation.ErrorJSON, &operation.CreatedAt, &operation.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return operation, err
}
func (s *Store) Operation(ctx context.Context, id string) (OperationRecord, error) {
	var operation OperationRecord
	err := s.Read(ctx, func(tx *sql.Tx) error { var err error; operation, err = readOperation(tx, id); return err })
	return operation, err
}
func (s *Store) PendingOperations(ctx context.Context) ([]OperationRecord, error) {
	result := make([]OperationRecord, 0)
	err := s.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query("SELECT id FROM operations WHERE state IN ('pending','running') ORDER BY rowid")
		if err != nil {
			return err
		}
		ids := make([]string, 0)
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			ids = append(ids, id)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, id := range ids {
			operation, err := readOperation(tx, id)
			if err != nil {
				return err
			}
			result = append(result, operation)
		}
		return nil
	})
	return result, err
}
func AdvanceWorkControl(tx *sql.Tx, id string, expected int64, desiredState, now string) (int64, error) {
	if expected < 1 || expected >= contracts.MaxSafeInteger {
		return 0, ErrRevisionConflict
	}
	result, err := tx.Exec(`UPDATE works SET desired_state=?,control_version=control_version+1,updated_at=? WHERE id=? AND control_version=? AND deleted_at IS NULL`, desiredState, nowTimestamp(now), id, expected)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	if err != nil || count != 1 {
		return 0, ErrRevisionConflict
	}
	return expected + 1, nil
}
func fenceCurrent(tx *sql.Tx, operation OperationRecord) (bool, error) {
	var envelope operationRequest
	if json.Unmarshal([]byte(operation.RequestJSON), &envelope) != nil {
		return false, ErrUnsupported
	}
	fence := envelope.Fence
	if fence.Scope == "none" {
		return true, nil
	}
	current, err := captureFence(tx, fence.Scope, operation.WorkID, operation.ServiceID, operation.TargetVersion)
	if errors.Is(err, ErrRevisionConflict) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if current.WorkControlVersion != fence.WorkControlVersion {
		return false, nil
	}
	if fence.Scope == "configuration" && current.ConfigurationRevision != fence.ConfigurationRevision {
		return false, nil
	}
	if fence.Scope == "service" {
		if current.ServiceRevision != fence.ServiceRevision || current.ServiceEnabled != fence.ServiceEnabled || current.ServiceTombstoned != fence.ServiceTombstoned {
			return false, nil
		}
		// Same-revision actions still have a durable acceptance order.
		var latest string
		err := tx.QueryRow(`SELECT id FROM operations WHERE work_id=? AND service_id=? AND
CASE WHEN json_valid(request_json) THEN json_extract(request_json,'$.fence.scope') ELSE NULL END='service' ORDER BY rowid DESC LIMIT 1`, operation.WorkID, operation.ServiceID).Scan(&latest)
		if err != nil {
			return false, err
		}
		if latest != operation.ID {
			return false, nil
		}
	}
	return true, nil
}

// CompleteOperation applies a side-effect result and terminal operation state in
// one transaction. A superseded result never calls the publication callback.
func (s *Store) CompleteOperation(ctx context.Context, id, state string, resultJSON, errorJSON *string, publish func(*sql.Tx) error) (OperationRecord, error) {
	var output OperationRecord
	if state != "succeeded" && state != "failed" && state != "superseded" {
		return output, contracts.NewError("INVALID_REQUEST", "")
	}
	err := s.Write(ctx, func(tx *sql.Tx) error {
		operation, err := readOperation(tx, id)
		if err != nil {
			return err
		}
		if operation.State != "pending" && operation.State != "running" {
			return ErrOperationFinal
		}
		current, err := fenceCurrent(tx, operation)
		if err != nil {
			return err
		}
		if !current {
			state = "superseded"
			resultJSON = nil
			errorJSON = nil
		} else if publish != nil {
			if err := publish(tx); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE operations SET state=?,result_json=COALESCE(?,result_json),error_json=?,updated_at=? WHERE id=?`, state, resultJSON, errorJSON, nowTimestamp(""), id); err != nil {
			return err
		}
		output, err = readOperation(tx, id)
		return err
	})
	return output, err
}
func (s *Store) MarkOperationRunning(ctx context.Context, id string) error {
	return s.Write(ctx, func(tx *sql.Tx) error {
		result, err := tx.Exec(`UPDATE operations SET state='running',updated_at=? WHERE id=? AND state='pending'`, nowTimestamp(""), id)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if count != 1 {
			return ErrOperationFinal
		}
		return nil
	})
}
