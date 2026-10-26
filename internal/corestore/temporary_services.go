package corestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"sort"

	"github.com/google/uuid"
)

// Temporary identities contain no command, environment, container output, or
// provider information. The private lease is never part of public diagnostics.
type TemporaryRunOwner struct {
	WorkID     string `json:"workId"`
	RunID      string `json:"runId"`
	Generation int64  `json:"generation"`
	InstanceID string `json:"instanceId"`
}

type TemporaryRunLease struct {
	Version   int               `json:"version"`
	Owner     TemporaryRunOwner `json:"owner"`
	LeaseID   string            `json:"leaseId"`
	State     string            `json:"state"`
	UpdatedAt string            `json:"updatedAt"`
}

type TemporaryServiceRecord struct {
	Version           int               `json:"version"`
	Owner             TemporaryRunOwner `json:"owner"`
	ServiceID         string            `json:"serviceId"`
	CreateOperationID string            `json:"createOperationId"`
	Mode              string            `json:"mode"`
	State             string            `json:"state"`
	UpdatedAt         string            `json:"updatedAt"`
	ContainerID       string            `json:"containerId,omitempty"`
	ExitCode          *int              `json:"exitCode,omitempty"`
}

func TemporaryRunOpenTx(tx *sql.Tx, owner TemporaryRunOwner) (bool, error) {
	if !validTemporaryOwner(owner) {
		return false, ErrTemporaryIdentity
	}
	lease, found, err := readTemporaryLease(tx, owner)
	if err != nil {
		return false, err
	}
	if !found || lease.Owner != owner {
		return false, ErrTemporaryIdentity
	}
	return lease.State == "open", nil
}

// MarkTemporaryLaunchingTx is the durable point of no automatic replay. It
// precedes the first Docker create and is atomic with the lease-open check.
func MarkTemporaryLaunchingTx(tx *sql.Tx, workID, serviceID, now string) error {
	record, found, err := ReadTemporaryServiceTx(tx, workID, serviceID)
	if err != nil {
		return err
	}
	if !found || record.State != "accepted" || now == "" {
		return ErrTemporaryIdentity
	}
	open, err := TemporaryRunOpenTx(tx, record.Owner)
	if err != nil {
		return err
	}
	if !open {
		return ErrTemporaryLeaseClosed
	}
	record.State, record.UpdatedAt = "launching", now
	return writeTemporaryJSON(tx, temporaryRecordKey(workID, serviceID), now, record)
}

// Persist a confirmed original container identity even if Run closure races
// the Docker reply; that identity remains the exact cleanup target.
func ConfirmTemporaryContainerTx(tx *sql.Tx, workID, serviceID, containerID, now string) error {
	if !temporaryIdentifier.MatchString(containerID) || now == "" {
		return ErrTemporaryIdentity
	}
	record, found, err := ReadTemporaryServiceTx(tx, workID, serviceID)
	if err != nil {
		return err
	}
	if !found || record.State != "launching" {
		return ErrTemporaryIdentity
	}
	record.State, record.ContainerID, record.UpdatedAt = "created", containerID, now
	return writeTemporaryJSON(tx, temporaryRecordKey(workID, serviceID), now, record)
}

func CompleteTemporaryCommandTx(tx *sql.Tx, workID, serviceID string, exitCode int, now string) error {
	record, found, err := ReadTemporaryServiceTx(tx, workID, serviceID)
	if err != nil {
		return err
	}
	if !found || record.Mode != "once" || record.State != "created" || now == "" {
		return ErrTemporaryIdentity
	}
	record.State, record.ExitCode, record.UpdatedAt = "completed", &exitCode, now
	return writeTemporaryJSON(tx, temporaryRecordKey(workID, serviceID), now, record)
}

var temporaryIdentifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,255}$`)
var ErrTemporaryLeaseClosed = errors.New("temporary Run creation lease is closed")
var ErrTemporaryIdentity = errors.New("temporary Run identity is invalid")

func validTemporaryOwner(owner TemporaryRunOwner) bool {
	return temporaryIdentifier.MatchString(owner.WorkID) && temporaryIdentifier.MatchString(owner.RunID) &&
		owner.Generation > 0 && temporaryIdentifier.MatchString(owner.InstanceID)
}

func temporaryLeaseKey(owner TemporaryRunOwner) string {
	return temporaryServiceNamespace + "lease:" + owner.WorkID + ":" + owner.RunID
}
func temporaryRecordKey(workID, serviceID string) string {
	return temporaryServiceNamespace + "service:" + workID + ":" + serviceID
}

func ReadTemporaryServiceTx(tx *sql.Tx, workID, serviceID string) (TemporaryServiceRecord, bool, error) {
	if !temporaryIdentifier.MatchString(workID) || !temporaryIdentifier.MatchString(serviceID) {
		return TemporaryServiceRecord{}, false, ErrTemporaryIdentity
	}
	var record TemporaryServiceRecord
	found, err := readTemporaryJSON(tx, temporaryRecordKey(workID, serviceID), &record)
	if err != nil || !found {
		return record, found, err
	}
	if record.Version != 1 || !validTemporaryOwner(record.Owner) || record.Owner.WorkID != workID || record.ServiceID != serviceID ||
		!temporaryIdentifier.MatchString(record.CreateOperationID) || (record.Mode != "once" && record.Mode != "listener") || record.State == "" || record.UpdatedAt == "" {
		return TemporaryServiceRecord{}, false, ErrStorage
	}
	return record, true, nil
}

func ListTemporaryServicesTx(tx *sql.Tx, workID, runID string) ([]TemporaryServiceRecord, error) {
	if !temporaryIdentifier.MatchString(workID) || runID != "" && !temporaryIdentifier.MatchString(runID) {
		return nil, ErrTemporaryIdentity
	}
	prefix := temporaryServiceNamespace + "service:" + workID + ":"
	rows, err := tx.Query(`SELECT key FROM control_metadata WHERE substr(key,1,?)=? ORDER BY key`, len(prefix), prefix)
	if err != nil {
		return nil, err
	}
	var serviceIDs []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return nil, err
		}
		serviceIDs = append(serviceIDs, key[len(prefix):])
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	result := make([]TemporaryServiceRecord, 0, len(serviceIDs))
	for _, serviceID := range serviceIDs {
		record, found, err := ReadTemporaryServiceTx(tx, workID, serviceID)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, ErrStorage
		}
		if runID == "" || record.Owner.RunID == runID {
			result = append(result, record)
		}
	}
	return result, nil
}

func readTemporaryJSON(tx *sql.Tx, key string, destination any) (bool, error) {
	var raw string
	err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key=?`, key).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if len(raw) > 16<<10 || json.Unmarshal([]byte(raw), destination) != nil {
		return false, ErrStorage
	}
	return true, nil
}

func writeTemporaryJSON(tx *sql.Tx, key, now string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil || len(raw) > 16<<10 {
		return ErrStorage
	}
	_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, key, string(raw), now)
	return err
}

func readTemporaryLease(tx *sql.Tx, owner TemporaryRunOwner) (TemporaryRunLease, bool, error) {
	var lease TemporaryRunLease
	found, err := readTemporaryJSON(tx, temporaryLeaseKey(owner), &lease)
	if err != nil || !found {
		return lease, found, err
	}
	if lease.Version != 1 || !validTemporaryOwner(lease.Owner) || lease.Owner.WorkID != owner.WorkID || lease.Owner.RunID != owner.RunID ||
		(lease.State != "open" && lease.State != "closing" && lease.State != "closed") || lease.State == "open" && !temporaryIdentifier.MatchString(lease.LeaseID) {
		return TemporaryRunLease{}, false, ErrStorage
	}
	return lease, true, nil
}

// OpenTemporaryRunLease is idempotent for the exact authenticated generation.
// A closing or closed lease cannot be reopened, even after a lost reply.
func (s *Store) OpenTemporaryRunLease(ctx context.Context, owner TemporaryRunOwner, now string) (TemporaryRunLease, error) {
	if !validTemporaryOwner(owner) || now == "" {
		return TemporaryRunLease{}, ErrTemporaryIdentity
	}
	if err := s.EnableTemporaryServiceStorage(); err != nil {
		return TemporaryRunLease{}, err
	}
	var result TemporaryRunLease
	err := s.Write(ctx, func(tx *sql.Tx) error {
		var err error
		result, err = OpenTemporaryRunLeaseTx(tx, owner, now)
		return err
	})
	return result, err
}

// OpenTemporaryRunLeaseTx lets the caller validate the current runtime and
// Work control version in the same transaction as lease admission.
func OpenTemporaryRunLeaseTx(tx *sql.Tx, owner TemporaryRunOwner, now string) (TemporaryRunLease, error) {
	if !validTemporaryOwner(owner) || now == "" {
		return TemporaryRunLease{}, ErrTemporaryIdentity
	}
	lease, found, err := readTemporaryLease(tx, owner)
	if err != nil {
		return TemporaryRunLease{}, err
	}
	if found {
		if lease.Owner != owner {
			return TemporaryRunLease{}, ErrTemporaryIdentity
		}
		if lease.State != "open" {
			return TemporaryRunLease{}, ErrTemporaryLeaseClosed
		}
		return lease, nil
	}
	lease = TemporaryRunLease{Version: 1, Owner: owner, LeaseID: "lease-" + uuid.NewString(), State: "open", UpdatedAt: now}
	if err := writeTemporaryJSON(tx, temporaryLeaseKey(owner), now, lease); err != nil {
		return TemporaryRunLease{}, err
	}
	return lease, nil
}

// CloseTemporaryRunLease persists a fence even if the open response was lost.
func (s *Store) CloseTemporaryRunLease(ctx context.Context, owner TemporaryRunOwner, now string) error {
	if !validTemporaryOwner(owner) || now == "" {
		return ErrTemporaryIdentity
	}
	if err := s.EnableTemporaryServiceStorage(); err != nil {
		return err
	}
	return s.Write(ctx, func(tx *sql.Tx) error {
		return CloseTemporaryRunLeaseTx(tx, owner, now)
	})
}

func CloseTemporaryRunLeaseTx(tx *sql.Tx, owner TemporaryRunOwner, now string) error {
	if !validTemporaryOwner(owner) || now == "" {
		return ErrTemporaryIdentity
	}
	lease, found, err := readTemporaryLease(tx, owner)
	if err != nil {
		return err
	}
	if found && lease.Owner != owner {
		return ErrTemporaryIdentity
	}
	if !found {
		lease = TemporaryRunLease{Version: 1, Owner: owner}
	}
	if lease.State == "closed" || lease.State == "closing" {
		return nil
	}
	lease.State, lease.UpdatedAt = "closing", now
	return writeTemporaryJSON(tx, temporaryLeaseKey(owner), now, lease)
}

// ValidateTemporaryLeaseTx may permit a closed lease only to retrieve an
// already accepted receipt; creating a new target requires an open lease.
func ValidateTemporaryLeaseTx(tx *sql.Tx, owner TemporaryRunOwner, leaseID string, allowClosed bool) error {
	if !validTemporaryOwner(owner) || !temporaryIdentifier.MatchString(leaseID) {
		return ErrTemporaryIdentity
	}
	lease, found, err := readTemporaryLease(tx, owner)
	if err != nil {
		return err
	}
	if !found || lease.Owner != owner || lease.LeaseID != leaseID {
		return ErrTemporaryIdentity
	}
	if !allowClosed && lease.State != "open" {
		return ErrTemporaryLeaseClosed
	}
	return nil
}

// AcceptTemporaryServiceTx must run inside the same mutation transaction that
// accepts the Service, so lease closure and creation cannot pass one another.
func AcceptTemporaryServiceTx(tx *sql.Tx, record TemporaryServiceRecord, leaseID string) error {
	if record.Version != 1 || !validTemporaryOwner(record.Owner) || !temporaryIdentifier.MatchString(record.ServiceID) ||
		!temporaryIdentifier.MatchString(record.CreateOperationID) || !temporaryIdentifier.MatchString(leaseID) ||
		(record.Mode != "once" && record.Mode != "listener") || record.State != "accepted" || record.UpdatedAt == "" {
		return ErrTemporaryIdentity
	}
	if err := ValidateTemporaryLeaseTx(tx, record.Owner, leaseID, false); err != nil {
		return err
	}
	existing, found, err := ReadTemporaryServiceTx(tx, record.Owner.WorkID, record.ServiceID)
	if err != nil {
		return err
	} else if found {
		if existing == record {
			return nil
		}
		return ErrIdempotencyConflict
	}
	if err := trimTemporaryHistoryTx(tx, record.Owner.WorkID, record.UpdatedAt); err != nil {
		return err
	}
	return writeTemporaryJSON(tx, temporaryRecordKey(record.Owner.WorkID, record.ServiceID), record.UpdatedAt, record)
}

const maxTemporaryServicesPerWork = 256

type TemporaryHistoryRetention struct {
	Version int   `json:"version"`
	Dropped int64 `json:"dropped"`
}

func TemporaryHistoryRetentionTx(tx *sql.Tx, workID string) (TemporaryHistoryRetention, error) {
	if !temporaryIdentifier.MatchString(workID) {
		return TemporaryHistoryRetention{}, ErrTemporaryIdentity
	}
	var retention TemporaryHistoryRetention
	found, err := readTemporaryJSON(tx, temporaryServiceNamespace+"retention:"+workID, &retention)
	if err != nil {
		return retention, err
	}
	if !found {
		return TemporaryHistoryRetention{Version: 1}, nil
	}
	if retention.Version != 1 || retention.Dropped < 0 {
		return TemporaryHistoryRetention{}, ErrStorage
	}
	return retention, nil
}

// Only completed records may be retired. Unknown or pending cleanup retains
// both its identity and quota until a real outcome can be confirmed.
func trimTemporaryHistoryTx(tx *sql.Tx, workID, now string) error {
	records, err := ListTemporaryServicesTx(tx, workID, "")
	if err != nil {
		return err
	}
	need := len(records) - maxTemporaryServicesPerWork + 1
	if need <= 0 {
		return nil
	}
	type candidate struct{ serviceID, updated string }
	var completed []candidate
	for _, record := range records {
		cleanup, found, err := ReadTemporaryCleanupTx(tx, workID, record.ServiceID)
		if err != nil {
			return err
		}
		if found && cleanup.State == "completed" {
			completed = append(completed, candidate{record.ServiceID, cleanup.UpdatedAt})
		}
	}
	if len(completed) < need {
		return ErrQuotaExceeded
	}
	sort.Slice(completed, func(i, j int) bool {
		if completed[i].updated == completed[j].updated {
			return completed[i].serviceID < completed[j].serviceID
		}
		return completed[i].updated < completed[j].updated
	})
	retention, err := TemporaryHistoryRetentionTx(tx, workID)
	if err != nil {
		return err
	}
	for _, item := range completed[:need] {
		if _, err := tx.Exec(`DELETE FROM control_metadata WHERE key IN (?,?)`, temporaryRecordKey(workID, item.serviceID), temporaryCleanupKey(workID, item.serviceID)); err != nil {
			return err
		}
		retention.Dropped++
	}
	return writeTemporaryJSON(tx, temporaryServiceNamespace+"retention:"+workID, now, retention)
}
