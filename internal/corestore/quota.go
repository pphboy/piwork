package corestore

import (
	"context"
	"database/sql"
	"errors"

	"piwork/internal/contracts"
)

var ErrQuotaExceeded = errors.New("resource quota was exceeded")
var ErrReleaseUnconfirmed = errors.New("resource release has not been confirmed")
var ErrVolumeReferenced = errors.New("volume still has references")
var ErrVolumeState = errors.New("volume state conflicts with this request")

func AssertWorkMutable(tx *sql.Tx, workID string) error {
	var locked int
	if err := tx.QueryRow("SELECT count(*) FROM work_snapshot_locks WHERE work_id=?", workID).Scan(&locked); err != nil {
		return err
	}
	if locked != 0 {
		return ErrSnapshotBusy
	}
	return nil
}

type QuotaLimits struct {
	CPUMillis          int64
	MemoryBytes        int64
	MaxServices        *int64
	MaxRetainedVolumes *int64
	MaxWorks           *int64
}
type QuotaReservation struct {
	WorkID              string
	SubjectKind         string
	SubjectID           string
	DesiredCPUMillis    int64
	DesiredMemoryBytes  int64
	OccupiedCPUMillis   int64
	OccupiedMemoryBytes int64
	ServiceSlots        int64
	VolumeSlots         int64
	UpdatedAt           string
}
type QuotaUsage struct {
	CPUMillis   int64
	MemoryBytes int64
}

func validBudget(value int64) bool { return value >= 0 && value <= contracts.MaxSafeInteger }
func validLimits(limits QuotaLimits) bool {
	if !validBudget(limits.CPUMillis) || !validBudget(limits.MemoryBytes) {
		return false
	}
	for _, limit := range []*int64{limits.MaxServices, limits.MaxRetainedVolumes, limits.MaxWorks} {
		if limit != nil && !validBudget(*limit) {
			return false
		}
	}
	return true
}
func maximum(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
func ReadQuotaReservation(tx *sql.Tx, workID, kind, id string) (QuotaReservation, error) {
	var value QuotaReservation
	err := tx.QueryRow(`SELECT work_id,subject_kind,subject_id,desired_cpu_millis,desired_memory_bytes,occupied_cpu_millis,occupied_memory_bytes,service_slots,volume_slots,updated_at FROM quota_reservations WHERE work_id=? AND subject_kind=? AND subject_id=?`, workID, kind, id).Scan(&value.WorkID, &value.SubjectKind, &value.SubjectID, &value.DesiredCPUMillis, &value.DesiredMemoryBytes, &value.OccupiedCPUMillis, &value.OccupiedMemoryBytes, &value.ServiceSlots, &value.VolumeSlots, &value.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return value, err
}
func (s *Store) QuotaReservation(ctx context.Context, workID, kind, id string) (QuotaReservation, error) {
	var value QuotaReservation
	err := s.Read(ctx, func(tx *sql.Tx) error {
		var err error
		value, err = ReadQuotaReservation(tx, workID, kind, id)
		return err
	})
	return value, err
}
func quotaUsage(tx *sql.Tx, workID *string) (QuotaUsage, error) {
	var usage QuotaUsage
	query := `SELECT desired_cpu_millis,desired_memory_bytes,occupied_cpu_millis,occupied_memory_bytes FROM quota_reservations`
	var args []any
	if workID != nil {
		query += " WHERE work_id=?"
		args = append(args, *workID)
	}
	rows, err := tx.Query(query, args...)
	if err != nil {
		return usage, err
	}
	defer rows.Close()
	for rows.Next() {
		var desiredCPU, desiredMemory, occupiedCPU, occupiedMemory int64
		if err := rows.Scan(&desiredCPU, &desiredMemory, &occupiedCPU, &occupiedMemory); err != nil {
			return usage, err
		}
		for _, n := range []int64{desiredCPU, desiredMemory, occupiedCPU, occupiedMemory} {
			if !validBudget(n) {
				return usage, ErrUnsupported
			}
		}
		cpu, memory := maximum(desiredCPU, occupiedCPU), maximum(desiredMemory, occupiedMemory)
		if usage.CPUMillis > contracts.MaxSafeInteger-cpu || usage.MemoryBytes > contracts.MaxSafeInteger-memory {
			return usage, ErrQuotaExceeded
		}
		usage.CPUMillis += cpu
		usage.MemoryBytes += memory
	}
	return usage, rows.Err()
}

// ReserveQuota runs inside the caller's acceptance transaction. Existing
// occupation cannot be reduced by supplying a smaller desired definition.
func ReserveQuota(tx *sql.Tx, next QuotaReservation, work, host QuotaLimits) error {
	if err := AssertWorkMutable(tx, next.WorkID); err != nil {
		return err
	}
	if !validLimits(work) || !validLimits(host) || next.WorkID == "" || next.SubjectKind == "" || next.SubjectID == "" {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	for _, value := range []int64{next.DesiredCPUMillis, next.DesiredMemoryBytes, next.OccupiedCPUMillis, next.OccupiedMemoryBytes, next.ServiceSlots, next.VolumeSlots} {
		if !validBudget(value) {
			return contracts.NewError("INVALID_REQUEST", "")
		}
	}
	current, err := ReadQuotaReservation(tx, next.WorkID, next.SubjectKind, next.SubjectID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	next.OccupiedCPUMillis = maximum(next.OccupiedCPUMillis, current.OccupiedCPUMillis)
	next.OccupiedMemoryBytes = maximum(next.OccupiedMemoryBytes, current.OccupiedMemoryBytes)
	local, err := quotaUsage(tx, &next.WorkID)
	if err != nil {
		return err
	}
	global, err := quotaUsage(tx, nil)
	if err != nil {
		return err
	}
	cpuDelta := maximum(next.DesiredCPUMillis, next.OccupiedCPUMillis) - maximum(current.DesiredCPUMillis, current.OccupiedCPUMillis)
	memoryDelta := maximum(next.DesiredMemoryBytes, next.OccupiedMemoryBytes) - maximum(current.DesiredMemoryBytes, current.OccupiedMemoryBytes)
	if cpuDelta > work.CPUMillis-local.CPUMillis || cpuDelta > host.CPUMillis-global.CPUMillis || memoryDelta > work.MemoryBytes-local.MemoryBytes || memoryDelta > host.MemoryBytes-global.MemoryBytes {
		return ErrQuotaExceeded
	}
	if work.MaxServices != nil {
		var count int64
		if err := tx.QueryRow("SELECT count(*) FROM service_heads WHERE work_id=? AND tombstoned_at IS NULL", next.WorkID).Scan(&count); err != nil {
			return err
		}
		// Acceptance may reserve before inserting its new head. Count the
		// proposed slot as well, without counting an existing head twice.
		if next.SubjectKind == "service" && next.ServiceSlots > 0 {
			var exists bool
			if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM service_heads WHERE work_id=? AND service_id=? AND tombstoned_at IS NULL)`, next.WorkID, next.SubjectID).Scan(&exists); err != nil {
				return err
			}
			if !exists {
				count++
			}
		}
		if count > *work.MaxServices {
			return ErrQuotaExceeded
		}
	}
	if err := CheckVolumeQuota(tx, next.WorkID, work.MaxRetainedVolumes, host.MaxRetainedVolumes, 0); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO quota_reservations(work_id,subject_kind,subject_id,desired_cpu_millis,desired_memory_bytes,occupied_cpu_millis,occupied_memory_bytes,service_slots,volume_slots,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(work_id,subject_kind,subject_id) DO UPDATE SET desired_cpu_millis=excluded.desired_cpu_millis,desired_memory_bytes=excluded.desired_memory_bytes,occupied_cpu_millis=excluded.occupied_cpu_millis,occupied_memory_bytes=excluded.occupied_memory_bytes,service_slots=excluded.service_slots,volume_slots=excluded.volume_slots,updated_at=excluded.updated_at`, next.WorkID, next.SubjectKind, next.SubjectID, next.DesiredCPUMillis, next.DesiredMemoryBytes, next.OccupiedCPUMillis, next.OccupiedMemoryBytes, next.ServiceSlots, next.VolumeSlots, nowTimestamp(next.UpdatedAt))
	return err
}
func CheckWorkQuota(tx *sql.Tx, maxWorks *int64, additional int64) error {
	if maxWorks == nil {
		return nil
	}
	if !validBudget(*maxWorks) || additional < 0 {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	var count int64
	if err := tx.QueryRow("SELECT count(*) FROM works WHERE deleted_at IS NULL").Scan(&count); err != nil {
		return err
	}
	var imports int64
	if err := tx.QueryRow("SELECT count(*) FROM work_import_names").Scan(&imports); err != nil {
		return err
	}
	if additional > *maxWorks-count-imports {
		return ErrQuotaExceeded
	}
	return nil
}
func CheckVolumeQuota(tx *sql.Tx, workID string, workMax, hostMax *int64, additional int64) error {
	if additional < 0 {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	for _, limit := range []struct {
		Value *int64
		Work  bool
	}{{workMax, true}, {hostMax, false}} {
		if limit.Value == nil {
			continue
		}
		if !validBudget(*limit.Value) {
			return contracts.NewError("INVALID_REQUEST", "")
		}
		var count int64
		query := "SELECT count(*) FROM volume_records WHERE state!='purged'"
		var args []any
		if limit.Work {
			query += " AND work_id=?"
			args = append(args, workID)
		}
		if err := tx.QueryRow(query, args...).Scan(&count); err != nil {
			return err
		}
		if additional > *limit.Value-count {
			return ErrQuotaExceeded
		}
	}
	return nil
}
func ConfirmQuotaOccupation(tx *sql.Tx, workID, kind, id string, cpu, memory int64, releaseConfirmed bool) error {
	if err := AssertWorkMutable(tx, workID); err != nil {
		return err
	}
	if !validBudget(cpu) || !validBudget(memory) {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	current, err := ReadQuotaReservation(tx, workID, kind, id)
	if err != nil {
		return err
	}
	if (cpu < current.OccupiedCPUMillis || memory < current.OccupiedMemoryBytes) && !releaseConfirmed {
		return ErrReleaseUnconfirmed
	}
	// Growth is accepted through ReserveQuota with limits before Engine create.
	if cpu > maximum(current.DesiredCPUMillis, current.OccupiedCPUMillis) || memory > maximum(current.DesiredMemoryBytes, current.OccupiedMemoryBytes) {
		return ErrQuotaExceeded
	}
	_, err = tx.Exec(`UPDATE quota_reservations SET occupied_cpu_millis=?,occupied_memory_bytes=?,updated_at=? WHERE work_id=? AND subject_kind=? AND subject_id=?`, cpu, memory, nowTimestamp(""), workID, kind, id)
	return err
}
func ReleaseQuota(tx *sql.Tx, workID, kind, id string, releaseConfirmed bool) error {
	if err := AssertWorkMutable(tx, workID); err != nil {
		return err
	}
	if !releaseConfirmed {
		return ErrReleaseUnconfirmed
	}
	current, err := ReadQuotaReservation(tx, workID, kind, id)
	if err != nil {
		return err
	}
	if current.OccupiedCPUMillis != 0 || current.OccupiedMemoryBytes != 0 {
		return ErrReleaseUnconfirmed
	}
	_, err = tx.Exec(`UPDATE quota_reservations SET desired_cpu_millis=0,desired_memory_bytes=0,updated_at=? WHERE work_id=? AND subject_kind=? AND subject_id=?`, nowTimestamp(""), workID, kind, id)
	return err
}

type VolumeRecord struct {
	ID             string
	InstallationID string
	WorkID         string
	ServiceID      *string
	Role           string
	RuntimeName    string
	State          string
	ReferenceCount int64
	RetainedAt     *string
	PurgedAt       *string
	CreatedAt      string
}

func ReadVolume(tx *sql.Tx, id string) (VolumeRecord, error) {
	var volume VolumeRecord
	err := tx.QueryRow(`SELECT id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,retained_at,purged_at,created_at FROM volume_records WHERE id=?`, id).Scan(&volume.ID, &volume.InstallationID, &volume.WorkID, &volume.ServiceID, &volume.Role, &volume.RuntimeName, &volume.State, &volume.ReferenceCount, &volume.RetainedAt, &volume.PurgedAt, &volume.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return volume, err
}
func RegisterVolume(tx *sql.Tx, volume VolumeRecord, workMax, hostMax *int64) error {
	if err := AssertWorkMutable(tx, volume.WorkID); err != nil {
		return err
	}
	if volume.ID == "" || volume.InstallationID == "" || volume.WorkID == "" || volume.RuntimeName == "" || (volume.Role != "workspace" && volume.Role != "agent-private" && volume.Role != "service-data") || volume.ReferenceCount != 0 {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	current, err := ReadVolume(tx, volume.ID)
	if err == nil {
		if current.InstallationID != volume.InstallationID || current.WorkID != volume.WorkID || current.Role != volume.Role || current.RuntimeName != volume.RuntimeName || (current.ServiceID == nil) != (volume.ServiceID == nil) || (current.ServiceID != nil && *current.ServiceID != *volume.ServiceID) {
			return ErrVolumeState
		}
		return nil
	}
	if !errors.Is(err, ErrNotFound) {
		return err
	}
	if err := CheckVolumeQuota(tx, volume.WorkID, workMax, hostMax, 1); err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO volume_records(id,installation_id,work_id,service_id,volume_role,runtime_name,state,reference_count,created_at) VALUES(?,?,?,?,?,?,'active',0,?)`, volume.ID, volume.InstallationID, volume.WorkID, volume.ServiceID, volume.Role, volume.RuntimeName, nowTimestamp(volume.CreatedAt))
	return err
}
func syncVolumeReferences(tx *sql.Tx, id string) error {
	result, err := tx.Exec(`UPDATE volume_records SET reference_count=(SELECT count(*) FROM volume_references WHERE volume_id=?),
state=CASE WHEN (SELECT count(*) FROM volume_references WHERE volume_id=?)=0 THEN 'retained' ELSE 'active' END,
retained_at=CASE WHEN (SELECT count(*) FROM volume_references WHERE volume_id=?)=0 THEN COALESCE(retained_at,?) ELSE NULL END WHERE id=? AND state IN ('active','retained')`, id, id, id, nowTimestamp(""), id)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return ErrVolumeState
	}
	return nil
}
func AttachVolumeReference(tx *sql.Tx, volumeID, kind, consumer string) error {
	volume, err := ReadVolume(tx, volumeID)
	if err != nil {
		return err
	}
	if err := AssertWorkMutable(tx, volume.WorkID); err != nil {
		return err
	}
	if volume.State != "active" && volume.State != "retained" {
		return ErrVolumeState
	}
	if kind == "work" {
		if consumer != volume.WorkID {
			return ErrVolumeState
		}
	} else if kind == "service" {
		if volume.Role == "agent-private" || (volume.ServiceID != nil && *volume.ServiceID != consumer) {
			return ErrVolumeState
		}
		var count int
		if err := tx.QueryRow("SELECT count(*) FROM service_heads WHERE work_id=? AND service_id=? AND tombstoned_at IS NULL", volume.WorkID, consumer).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			return ErrNotFound
		}
	} else {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	if _, err := tx.Exec(`INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES(?,?,?,?) ON CONFLICT(volume_id,consumer_kind,consumer_id) DO NOTHING`, volumeID, kind, consumer, nowTimestamp("")); err != nil {
		return err
	}
	return syncVolumeReferences(tx, volumeID)
}
func DetachVolumeReference(tx *sql.Tx, volumeID, kind, consumer string) error {
	volume, err := ReadVolume(tx, volumeID)
	if err != nil {
		return err
	}
	if err := AssertWorkMutable(tx, volume.WorkID); err != nil {
		return err
	}
	if volume.State != "active" && volume.State != "retained" {
		return ErrVolumeState
	}
	if _, err := tx.Exec("DELETE FROM volume_references WHERE volume_id=? AND consumer_kind=? AND consumer_id=?", volumeID, kind, consumer); err != nil {
		return err
	}
	return syncVolumeReferences(tx, volumeID)
}
func RetainWorkVolumes(tx *sql.Tx, workID string) error {
	if err := AssertWorkMutable(tx, workID); err != nil {
		return err
	}
	if _, err := tx.Exec("DELETE FROM volume_references WHERE volume_id IN (SELECT id FROM volume_records WHERE work_id=?)", workID); err != nil {
		return err
	}
	_, err := tx.Exec(`UPDATE volume_records SET reference_count=0,state='retained',retained_at=COALESCE(retained_at,?) WHERE work_id=? AND state IN ('active','retained')`, nowTimestamp(""), workID)
	return err
}
func RequestVolumePurge(tx *sql.Tx, id string) error {
	volume, err := ReadVolume(tx, id)
	if err != nil {
		return err
	}
	if err := AssertWorkMutable(tx, volume.WorkID); err != nil {
		return err
	}
	if volume.State == "purge_pending" || volume.State == "purged" {
		return nil
	}
	var count int64
	if err := tx.QueryRow("SELECT count(*) FROM volume_references WHERE volume_id=?", id).Scan(&count); err != nil {
		return err
	}
	if count != 0 || volume.ReferenceCount != 0 {
		return ErrVolumeReferenced
	}
	_, err = tx.Exec("UPDATE volume_records SET state='purge_pending' WHERE id=?", id)
	return err
}
func CompleteVolumePurge(tx *sql.Tx, id string, absenceConfirmed bool) error {
	if !absenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	volume, err := ReadVolume(tx, id)
	if err != nil {
		return err
	}
	if volume.State == "purged" {
		return nil
	}
	if volume.State != "purge_pending" {
		return ErrVolumeState
	}
	_, err = tx.Exec("UPDATE volume_records SET state='purged',purged_at=? WHERE id=?", nowTimestamp(""), id)
	return err
}
