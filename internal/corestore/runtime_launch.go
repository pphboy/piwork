package corestore

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/safefs"
)

// RuntimeLaunchBinding is private runtime state, not user Work configuration.
// The referenced secret stays in the platform secret store.
type RuntimeLaunchBinding struct {
	Version           int    `json:"version"`
	WorkID            string `json:"workId"`
	Generation        int64  `json:"generation"`
	InstanceID        string `json:"instanceId"`
	ControlVersion    int64  `json:"controlVersion"`
	ContextID         string `json:"contextId"`
	ImageID           string `json:"imageId"`
	ModelRef          string `json:"modelRef"`
	CredentialRef     string `json:"credentialRef"`
	CredentialVersion string `json:"credentialVersion,omitempty"`
	Published         bool   `json:"published"`
	Activated         bool   `json:"activated"`
}

type RuntimeReplacement struct {
	Version          int                  `json:"version"`
	WorkID           string               `json:"workId"`
	ControlVersion   int64                `json:"controlVersion"`
	OperationID      string               `json:"operationId,omitempty"`
	SourceGeneration int64                `json:"sourceGeneration"`
	SourceInstanceID string               `json:"sourceInstanceId"`
	Target           RuntimeLaunchBinding `json:"target"`
	Stage            string               `json:"stage"`
}

func runtimeLaunchKey(workID string, generation int64) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d", workID, generation)))
	return "runtime_launch_" + hex.EncodeToString(sum[:])
}

func runtimeReplacementKey(workID string) string {
	sum := sha256.Sum256([]byte(workID))
	return "runtime_replacement_" + hex.EncodeToString(sum[:])
}

func validRuntimeLaunch(v RuntimeLaunchBinding) bool {
	return v.Version == 1 && strings.HasPrefix(v.WorkID, "work-") && safefs.ValidFileName(v.WorkID) && v.Generation > 0 && v.Generation <= contracts.MaxSafeInteger && strings.HasPrefix(v.InstanceID, "agent-") && safefs.ValidFileName(v.InstanceID) && v.ControlVersion > 0 && safefs.ValidFileName(v.ContextID) && len(v.ImageID) == 71 && strings.HasPrefix(v.ImageID, "sha256:") && isLowerHex(v.ImageID[7:]) && safefs.ValidFileName(v.ModelRef) && modelSecret.MatchString(v.CredentialRef) && len(v.CredentialVersion) <= 128
}

func isLowerHex(value string) bool {
	for _, c := range value {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func readPrivateRuntimeRecord(tx *sql.Tx, key string, out any) (bool, error) {
	var raw string
	if err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key=?`, key).Scan(&raw); errors.Is(err, sql.ErrNoRows) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if _, err := contracts.ParseJSON(strings.NewReader(raw), 1<<20); err != nil {
		return false, ErrStorage
	}
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return false, ErrStorage
	}
	return true, nil
}

func ReadRuntimeLaunchTx(tx *sql.Tx, workID string, generation int64) (RuntimeLaunchBinding, bool, error) {
	var value RuntimeLaunchBinding
	found, err := readPrivateRuntimeRecord(tx, runtimeLaunchKey(workID, generation), &value)
	if err != nil || !found {
		return value, found, err
	}
	if !validRuntimeLaunch(value) || value.WorkID != workID || value.Generation != generation {
		return RuntimeLaunchBinding{}, false, ErrStorage
	}
	return value, true, nil
}

// PutRuntimeLaunchTx is idempotent and never silently rebinds a generation.
func PutRuntimeLaunchTx(tx *sql.Tx, value RuntimeLaunchBinding) error {
	if !validRuntimeLaunch(value) {
		return ErrStorage
	}
	prior, found, err := ReadRuntimeLaunchTx(tx, value.WorkID, value.Generation)
	if err != nil {
		return err
	}
	if found {
		if prior != value {
			return ErrRevisionConflict
		}
		return nil
	}
	return insertPrivateRuntimeRecord(tx, runtimeLaunchKey(value.WorkID, value.Generation), value)
}

// ReplaceUnpublishedRuntimeLaunchTx permits a later accepted control target to
// bind a new credential only before this generation published any material.
// The caller must also prove that no container or credential file exists.
func ReplaceUnpublishedRuntimeLaunchTx(tx *sql.Tx, prior, next RuntimeLaunchBinding, at time.Time) error {
	current, found, err := ReadRuntimeLaunchTx(tx, prior.WorkID, prior.Generation)
	if err != nil || !found {
		if err == nil {
			err = ErrNotFound
		}
		return err
	}
	if current != prior || prior.Published || prior.Activated || !validRuntimeLaunch(next) || next.Published || next.Activated || next.WorkID != prior.WorkID || next.Generation != prior.Generation || next.InstanceID != prior.InstanceID || next.ContextID != prior.ContextID || next.ImageID != prior.ImageID || next.ModelRef != prior.ModelRef || next.ControlVersion <= prior.ControlVersion {
		return ErrRevisionConflict
	}
	var control int64
	var desired string
	if err := tx.QueryRow(`SELECT control_version,desired_state FROM works WHERE id=? AND deleted_at IS NULL`, next.WorkID).Scan(&control, &desired); err != nil {
		return err
	}
	if control != next.ControlVersion || desired != "running" {
		return ErrRevisionConflict
	}
	raw, err := json.Marshal(next)
	if err != nil {
		return ErrStorage
	}
	_, err = tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?`, string(raw), at.UTC().Format(time.RFC3339Nano), runtimeLaunchKey(next.WorkID, next.Generation))
	return err
}

func validRuntimeReplacement(v RuntimeReplacement) bool {
	return v.Version == 1 && validRuntimeLaunch(v.Target) && v.WorkID == v.Target.WorkID && v.ControlVersion >= v.Target.ControlVersion && v.SourceGeneration > 0 && v.Target.Generation > v.SourceGeneration && strings.HasPrefix(v.SourceInstanceID, "agent-") && safefs.ValidFileName(v.SourceInstanceID) && (v.OperationID == "" || safefs.ValidFileName(v.OperationID)) && (v.Stage == "prepared" || v.Stage == "old-removed" || v.Stage == "starting")
}

func ReadRuntimeReplacementTx(tx *sql.Tx, workID string) (RuntimeReplacement, bool, error) {
	var value RuntimeReplacement
	found, err := readPrivateRuntimeRecord(tx, runtimeReplacementKey(workID), &value)
	if err != nil || !found {
		return value, found, err
	}
	if !validRuntimeReplacement(value) || value.WorkID != workID {
		return RuntimeReplacement{}, false, ErrStorage
	}
	return value, true, nil
}

// PutRuntimeReplacementTx records the reserved target before external effects.
func PutRuntimeReplacementTx(tx *sql.Tx, value RuntimeReplacement) error {
	if !validRuntimeReplacement(value) || value.Stage != "prepared" || value.Target.Published {
		return ErrStorage
	}
	prior, found, err := ReadRuntimeReplacementTx(tx, value.WorkID)
	if err != nil {
		return err
	}
	if found {
		if prior != value {
			return ErrRevisionConflict
		}
		return nil
	}
	return insertPrivateRuntimeRecord(tx, runtimeReplacementKey(value.WorkID), value)
}

// RebaseRuntimeReplacementTx continues the same reserved target under a later
// explicitly accepted Start/Retry. Its launch credential remains pinned.
func RebaseRuntimeReplacementTx(tx *sql.Tx, workID, operationID, contextID string, control int64, at time.Time) error {
	plan, found, err := ReadRuntimeReplacementTx(tx, workID)
	if err != nil || !found {
		return err
	}
	if plan.ControlVersion >= control || contextID == "" || contextID != plan.Target.ContextID || !safefs.ValidFileName(operationID) {
		return ErrRevisionConflict
	}
	var actual int64
	var desired string
	if err := tx.QueryRow(`SELECT control_version,desired_state FROM works WHERE id=? AND deleted_at IS NULL`, workID).Scan(&actual, &desired); err != nil {
		return err
	}
	if actual != control || desired != "running" {
		return ErrRevisionConflict
	}
	plan.ControlVersion, plan.OperationID = control, operationID
	raw, err := json.Marshal(plan)
	if err != nil {
		return ErrStorage
	}
	_, err = tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?`, string(raw), at.UTC().Format(time.RFC3339Nano), runtimeReplacementKey(workID))
	return err
}

func insertPrivateRuntimeRecord(tx *sql.Tx, key string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return ErrStorage
	}
	_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)`, key, string(raw), time.Now().UTC().Format(time.RFC3339Nano))
	return err
}

// AdvanceRuntimeReplacementTx moves a previously reserved target forward.
// The caller proves external cleanup before selecting old-removed.
func AdvanceRuntimeReplacementTx(tx *sql.Tx, workID string, targetGeneration int64, next string, at time.Time) (RuntimeReplacement, error) {
	plan, found, err := ReadRuntimeReplacementTx(tx, workID)
	if err != nil || !found {
		if err == nil {
			err = ErrNotFound
		}
		return plan, err
	}
	if plan.Target.Generation != targetGeneration {
		return plan, ErrRevisionConflict
	}
	var control int64
	var desired string
	if err := tx.QueryRow(`SELECT control_version,desired_state FROM works WHERE id=? AND deleted_at IS NULL`, workID).Scan(&control, &desired); err != nil {
		return plan, err
	}
	if control != plan.ControlVersion || desired != "running" {
		return plan, ErrRevisionConflict
	}
	if plan.Stage == next {
		return plan, nil
	}
	if plan.Stage == "prepared" && next == "old-removed" {
		plan.Stage = next
	} else if plan.Stage == "old-removed" && next == "starting" {
		source, err := readRuntimeGeneration(tx, workID, plan.SourceGeneration)
		if err != nil || source.InstanceID == nil || *source.InstanceID != plan.SourceInstanceID {
			return plan, ErrRevisionConflict
		}
		var maxGeneration int64
		if err := tx.QueryRow(`SELECT COALESCE(MAX(generation),0) FROM runtime_generations WHERE work_id=?`, workID).Scan(&maxGeneration); err != nil || maxGeneration != source.Generation {
			return plan, ErrRevisionConflict
		}
		now := at.UTC().Format(time.RFC3339Nano)
		if _, err := tx.Exec(`UPDATE runtime_generations SET state='stopped',next_retry_at=NULL,ready_since=NULL,updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, now, workID, source.Generation, *source.InstanceID); err != nil {
			return plan, err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,retry_window_started_at,next_retry_at,ready_since,created_at,updated_at) VALUES(?,?,?,'starting',?,?,?,NULL,?,?)`, workID, plan.Target.Generation, plan.Target.InstanceID, source.RetryCount, source.RetryWindowStartedAt, source.NextRetryAt, now, now); err != nil {
			return plan, err
		}
		if err := PutRuntimeLaunchTx(tx, plan.Target); err != nil {
			return plan, err
		}
		plan.Stage = next
	} else {
		return plan, ErrRevisionConflict
	}
	raw, err := json.Marshal(plan)
	if err != nil {
		return plan, ErrStorage
	}
	_, err = tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?`, string(raw), at.UTC().Format(time.RFC3339Nano), runtimeReplacementKey(workID))
	return plan, err
}

// MarkRuntimeLaunchPublishedTx records the publication boundary monotonically.
func MarkRuntimeLaunchPublishedTx(tx *sql.Tx, workID string, generation int64, instanceID string, at time.Time) error {
	value, found, err := ReadRuntimeLaunchTx(tx, workID, generation)
	if err != nil || !found {
		if err == nil {
			err = ErrNotFound
		}
		return err
	}
	if value.InstanceID != instanceID {
		return ErrRevisionConflict
	}
	if value.Published {
		return nil
	}
	value.Published = true
	raw, err := json.Marshal(value)
	if err != nil {
		return ErrStorage
	}
	_, err = tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?`, string(raw), at.UTC().Format(time.RFC3339Nano), runtimeLaunchKey(workID, generation))
	return err
}

func MarkRuntimeLaunchActivatedTx(tx *sql.Tx, workID string, generation int64, instanceID string, at time.Time) error {
	value, found, err := ReadRuntimeLaunchTx(tx, workID, generation)
	if err != nil || !found {
		return err
	}
	if value.InstanceID != instanceID || !value.Published {
		return ErrRevisionConflict
	}
	if value.Activated {
		return nil
	}
	value.Activated = true
	raw, err := json.Marshal(value)
	if err != nil {
		return ErrStorage
	}
	_, err = tx.Exec(`UPDATE control_metadata SET value_json=?,updated_at=? WHERE key=?`, string(raw), at.UTC().Format(time.RFC3339Nano), runtimeLaunchKey(workID, generation))
	return err
}

func FinishRuntimeReplacementTx(tx *sql.Tx, workID string, targetGeneration int64) error {
	plan, found, err := ReadRuntimeReplacementTx(tx, workID)
	if err != nil || !found {
		return err
	}
	if plan.Stage != "starting" || plan.Target.Generation != targetGeneration {
		return ErrRevisionConflict
	}
	_, err = tx.Exec(`DELETE FROM control_metadata WHERE key=?`, runtimeReplacementKey(workID))
	return err
}

// CancelRuntimeReplacementTx is called only after the latest stop/delete has
// confirmed runtime and helper cleanup.
func CancelRuntimeReplacementTx(tx *sql.Tx, workID string) error {
	plan, found, err := ReadRuntimeReplacementTx(tx, workID)
	if err != nil || !found {
		return err
	}
	var control int64
	var desired string
	if err := tx.QueryRow(`SELECT control_version,desired_state FROM works WHERE id=? AND deleted_at IS NULL`, workID).Scan(&control, &desired); err != nil {
		return err
	}
	if desired == "running" || control <= plan.ControlVersion {
		return ErrRevisionConflict
	}
	_, err = tx.Exec(`DELETE FROM control_metadata WHERE key=?`, runtimeReplacementKey(workID))
	return err
}

// DiscardSupersededRuntimeReplacementTx releases an older reservation only
// after its caller has confirmed the exact instance and helpers are settled.
func DiscardSupersededRuntimeReplacementTx(tx *sql.Tx, workID string, control int64) error {
	plan, found, err := ReadRuntimeReplacementTx(tx, workID)
	if err != nil || !found {
		return err
	}
	var current int64
	if err := tx.QueryRow(`SELECT control_version FROM works WHERE id=? AND deleted_at IS NULL`, workID).Scan(&current); err != nil {
		return err
	}
	if current != control || plan.ControlVersion >= control {
		return ErrRevisionConflict
	}
	_, err = tx.Exec(`DELETE FROM control_metadata WHERE key=?`, runtimeReplacementKey(workID))
	return err
}
