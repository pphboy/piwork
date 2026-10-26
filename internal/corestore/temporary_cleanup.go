package corestore

import (
	"database/sql"
	"errors"
	"time"
)

var ErrTemporaryCleanupPending = errors.New("temporary Service cleanup is not yet confirmed")

type TemporaryCleanupEvent struct {
	At      string `json:"at"`
	Stage   string `json:"stage"`
	Outcome string `json:"outcome"`
	Code    string `json:"code,omitempty"`
}

type TemporaryCleanupRecord struct {
	Version           int                     `json:"version"`
	WorkID            string                  `json:"workId"`
	ServiceID         string                  `json:"serviceId"`
	RunID             string                  `json:"runId"`
	CreateOperationID string                  `json:"createOperationId"`
	OperationID       string                  `json:"operationId,omitempty"`
	Trigger           string                  `json:"trigger"`
	State             string                  `json:"state"`
	Stage             string                  `json:"stage"`
	ErrorCode         string                  `json:"errorCode,omitempty"`
	LogState          string                  `json:"logState,omitempty"`
	CreatedAt         string                  `json:"createdAt"`
	UpdatedAt         string                  `json:"updatedAt"`
	Events            []TemporaryCleanupEvent `json:"events"`
	Truncated         bool                    `json:"truncated"`
}

func BindTemporaryCleanupOperationTx(tx *sql.Tx, workID, serviceID, operationID, now string) error {
	if !temporaryIdentifier.MatchString(operationID) || !utcTimestamp(now) {
		return ErrTemporaryIdentity
	}
	cleanup, found, err := ReadTemporaryCleanupTx(tx, workID, serviceID)
	if err != nil {
		return err
	}
	if !found {
		return ErrTemporaryIdentity
	}
	if cleanup.OperationID != "" && cleanup.OperationID != operationID {
		return ErrIdempotencyConflict
	}
	if cleanup.OperationID == operationID {
		return nil
	}
	cleanup.OperationID, cleanup.UpdatedAt = operationID, now
	if err := writeTemporaryJSON(tx, temporaryCleanupKey(workID, serviceID), now, cleanup); err != nil {
		return err
	}
	return AppendTemporaryCleanupEventTx(tx, workID, serviceID, cleanup.State, TemporaryCleanupEvent{At: now, Stage: "request", Outcome: "succeeded"})
}

const maxTemporaryCleanupEvents = 32

func temporaryCleanupKey(workID, serviceID string) string {
	return temporaryServiceNamespace + "cleanup:" + workID + ":" + serviceID
}

func ReadTemporaryCleanupTx(tx *sql.Tx, workID, serviceID string) (TemporaryCleanupRecord, bool, error) {
	if !temporaryIdentifier.MatchString(workID) || !temporaryIdentifier.MatchString(serviceID) {
		return TemporaryCleanupRecord{}, false, ErrTemporaryIdentity
	}
	var cleanup TemporaryCleanupRecord
	found, err := readTemporaryJSON(tx, temporaryCleanupKey(workID, serviceID), &cleanup)
	if err != nil || !found {
		return cleanup, found, err
	}
	if cleanup.Version != 1 || cleanup.WorkID != workID || cleanup.ServiceID != serviceID ||
		!temporaryIdentifier.MatchString(cleanup.RunID) || !temporaryIdentifier.MatchString(cleanup.CreateOperationID) ||
		cleanup.OperationID != "" && !temporaryIdentifier.MatchString(cleanup.OperationID) ||
		len(cleanup.Events) > maxTemporaryCleanupEvents || cleanup.CreatedAt == "" || cleanup.UpdatedAt == "" {
		return TemporaryCleanupRecord{}, false, ErrStorage
	}
	return cleanup, true, nil
}

func BeginTemporaryCleanupTx(tx *sql.Tx, record TemporaryServiceRecord, trigger, now string) error {
	if !validTemporaryOwner(record.Owner) || !temporaryIdentifier.MatchString(record.ServiceID) || !temporaryIdentifier.MatchString(record.CreateOperationID) || !temporaryCleanupTrigger(trigger) || !utcTimestamp(now) {
		return ErrTemporaryIdentity
	}
	existing, found, err := ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
	if err != nil {
		return err
	}
	if found {
		if existing.RunID != record.Owner.RunID || existing.CreateOperationID != record.CreateOperationID {
			return ErrTemporaryIdentity
		}
		return nil
	}
	cleanup := TemporaryCleanupRecord{Version: 1, WorkID: record.Owner.WorkID, ServiceID: record.ServiceID, RunID: record.Owner.RunID,
		CreateOperationID: record.CreateOperationID, Trigger: trigger, State: "requested", Stage: "request", CreatedAt: now, UpdatedAt: now,
		Events: []TemporaryCleanupEvent{{At: now, Stage: "request", Outcome: "started"}}}
	return writeTemporaryJSON(tx, temporaryCleanupKey(cleanup.WorkID, cleanup.ServiceID), now, cleanup)
}

func temporaryCleanupTrigger(trigger string) bool {
	switch trigger {
	case "run-succeeded", "run-failed", "run-cancelled", "run-interrupted", "agent-replaced", "work-stop", "work-delete", "core-shutdown", "explicit":
		return true
	}
	return false
}

func AssertTemporaryCleanupConfirmedTx(tx *sql.Tx, workID string) error {
	records, err := ListTemporaryServicesTx(tx, workID, "")
	if err != nil {
		return err
	}
	for _, record := range records {
		cleanup, found, err := ReadTemporaryCleanupTx(tx, workID, record.ServiceID)
		if err != nil {
			return err
		}
		if !found || cleanup.State != "completed" {
			return ErrTemporaryCleanupPending
		}
	}
	return nil
}
func utcTimestamp(value string) bool {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	return err == nil && parsed.Location() == time.UTC
}

func AppendTemporaryCleanupEventTx(tx *sql.Tx, workID, serviceID, state string, event TemporaryCleanupEvent) error {
	if !utcTimestamp(event.At) {
		return ErrTemporaryIdentity
	}
	switch event.Stage {
	case "request", "inspect", "stop", "remove", "release", "retry", "logs":
	default:
		return ErrTemporaryIdentity
	}
	switch event.Outcome {
	case "started", "succeeded", "failed", "unconfirmed":
	default:
		return ErrTemporaryIdentity
	}
	switch event.Code {
	case "", "DOCKER_UNAVAILABLE", "TEMPORARY_CREATE_UNCONFIRMED", "WORK_OPERATION_FAILED", "DIAGNOSTIC_PERSIST_FAILED", "LOGS_UNAVAILABLE", "LOGS_PARTIAL":
	default:
		return ErrTemporaryIdentity
	}
	switch state {
	case "requested", "running", "pending", "completed":
	default:
		return ErrTemporaryIdentity
	}
	cleanup, found, err := ReadTemporaryCleanupTx(tx, workID, serviceID)
	if err != nil {
		return err
	}
	if !found {
		return ErrTemporaryIdentity
	}
	if cleanup.State == "completed" {
		return ErrOperationFinal
	}
	if len(cleanup.Events) == maxTemporaryCleanupEvents {
		cleanup.Events = append([]TemporaryCleanupEvent(nil), cleanup.Events[1:]...)
		cleanup.Truncated = true
	}
	cleanup.Events = append(cleanup.Events, event)
	if event.Stage == "logs" {
		switch event.Code {
		case "LOGS_UNAVAILABLE":
			cleanup.LogState = "unavailable"
		case "LOGS_PARTIAL":
			cleanup.LogState = "partial"
		default:
			cleanup.LogState = "archived"
		}
	}
	cleanup.State, cleanup.Stage, cleanup.ErrorCode, cleanup.UpdatedAt = state, event.Stage, event.Code, event.At
	return writeTemporaryJSON(tx, temporaryCleanupKey(workID, serviceID), event.At, cleanup)
}
