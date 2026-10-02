package corestore

import (
	"context"
	"database/sql"
	"regexp"
	"sync"
	"time"
)

// Asynchronous Session/Run submissions share snapshot admission with SQLite
// mutations. The write transaction orders registration against lock acceptance.
func (s *Store) BeginTransientMutation(ctx context.Context, workID string) (func(), error) {
	registered := false
	err := s.Write(ctx, func(tx *sql.Tx) error {
		if err := AssertWorkMutable(tx, workID); err != nil {
			return err
		}
		s.transientMu.Lock()
		defer s.transientMu.Unlock()
		if s.transientWork == nil {
			s.transientWork = make(map[string]int)
		}
		s.transientWork[workID]++
		registered = true
		return nil
	})
	if err != nil {
		if registered {
			s.transientMu.Lock()
			s.transientWork[workID]--
			if s.transientWork[workID] == 0 {
				delete(s.transientWork, workID)
			}
			s.transientMu.Unlock()
		}
		return nil, err
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			s.transientMu.Lock()
			defer s.transientMu.Unlock()
			s.transientWork[workID]--
			if s.transientWork[workID] == 0 {
				delete(s.transientWork, workID)
			}
		})
	}, nil
}
func (s *Store) LockSnapshotWork(tx *sql.Tx, v SnapshotLock) error {
	s.transientMu.Lock()
	defer s.transientMu.Unlock()
	if s.transientWork[v.WorkID] > 0 {
		return repositoryFailure("WORK_BUSY")
	}
	return lockSnapshotWork(tx, v)
}

var snapshotDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)

type SnapshotJob struct {
	OperationID, OwnerUserID, Kind                          string
	SourceWorkID, TargetWorkID, SnapshotID, PackageID, Name *string
	RequestDigest, Phase, DeadlineAt                        string
	WorkerEpoch                                             int64
	CreatedAt, UpdatedAt                                    string
	CleanupError                                            *string
}
type SnapshotLock struct {
	WorkID, OperationID string
	WorkerEpoch         int64
}
type SnapshotPackage struct {
	ID, OwnerUserID    string
	Digest             *string
	Size               int64
	State              string
	JobID              *string
	CreatedAt          string
	ReadyAt, ExpiresAt *string
}
type SnapshotArtifact struct{ OperationID, ArtifactKey, Kind, LogicalID, State string }
type SnapshotTransfer struct {
	ID, OwnerUserID                         string
	PackageID, SnapshotID                   *string
	Kind, Phase, DeadlineAt, LastProgressAt string
	HelperID                                *string
	CreatedAt                               string
}

const snapshotJobColumns = `operation_id,owner_user_id,kind,source_work_id,target_work_id,snapshot_id,package_id,name,request_digest,phase,deadline_at,worker_epoch,created_at,updated_at,cleanup_error`
const snapshotPackageColumns = `id,owner_user_id,digest,size,state,job_id,created_at,ready_at,expires_at`

func scanSnapshotJob(row rowScanner) (SnapshotJob, error) {
	var v SnapshotJob
	err := row.Scan(&v.OperationID, &v.OwnerUserID, &v.Kind, &v.SourceWorkID, &v.TargetWorkID, &v.SnapshotID, &v.PackageID, &v.Name, &v.RequestDigest, &v.Phase, &v.DeadlineAt, &v.WorkerEpoch, &v.CreatedAt, &v.UpdatedAt, &v.CleanupError)
	return v, notFound(err)
}
func ReadSnapshotJob(tx *sql.Tx, id string) (SnapshotJob, error) {
	return scanSnapshotJob(tx.QueryRow(`SELECT `+snapshotJobColumns+` FROM snapshot_jobs WHERE operation_id=?`, id))
}
func SnapshotJobs(tx *sql.Tx) ([]SnapshotJob, error) {
	rows, err := tx.Query(`SELECT ` + snapshotJobColumns + ` FROM snapshot_jobs ORDER BY created_at,operation_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SnapshotJob{}
	for rows.Next() {
		v, err := scanSnapshotJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func InsertSnapshotJob(tx *sql.Tx, v SnapshotJob) error {
	if v.Phase != "accepted" || v.WorkerEpoch != 1 {
		return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
	}
	busy, err := exists(tx, `SELECT 1 FROM snapshot_jobs WHERE phase NOT IN ('succeeded','cleaned') LIMIT 1`)
	if err != nil {
		return err
	}
	if busy {
		return repositoryFailure("SNAPSHOT_CAPACITY_BUSY")
	}
	if v.PackageID != nil {
		pack, err := ReadSnapshotPackage(tx, *v.PackageID)
		if err != nil {
			return err
		}
		if pack.OwnerUserID != v.OwnerUserID || pack.State != "ready" || pack.ExpiresAt == nil || *pack.ExpiresAt <= v.CreatedAt {
			return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
		}
	}
	_, err = tx.Exec(`INSERT INTO snapshot_jobs(`+snapshotJobColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.OperationID, v.OwnerUserID, v.Kind, v.SourceWorkID, v.TargetWorkID, v.SnapshotID, v.PackageID, v.Name, v.RequestDigest, v.Phase, v.DeadlineAt, v.WorkerEpoch, v.CreatedAt, v.UpdatedAt, v.CleanupError)
	return err
}
func AssertSnapshotFence(tx *sql.Tx, id string, epoch int64) (SnapshotJob, error) {
	job, err := ReadSnapshotJob(tx, id)
	if err != nil {
		return job, err
	}
	if job.WorkerEpoch != epoch || job.Phase == "succeeded" || job.Phase == "cleaned" {
		return job, repositoryFailure("SNAPSHOT_WORKER_FENCED")
	}
	return job, nil
}
func lockSnapshotWork(tx *sql.Tx, v SnapshotLock) error {
	if err := AssertWorkMutable(tx, v.WorkID); err != nil {
		return err
	}
	pending, err := exists(tx, `SELECT 1 FROM work_file_jobs WHERE work_id=? AND state!='cleaned' LIMIT 1`, v.WorkID)
	if err != nil {
		return err
	}
	if pending {
		return repositoryFailure("WORK_BUSY")
	}
	job, err := AssertSnapshotFence(tx, v.OperationID, v.WorkerEpoch)
	if err != nil {
		return err
	}
	if job.Kind != "export" || job.SourceWorkID == nil || *job.SourceWorkID != v.WorkID {
		return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
	}
	_, err = tx.Exec(`INSERT INTO work_snapshot_locks(work_id,operation_id,worker_epoch) VALUES(?,?,?)`, v.WorkID, v.OperationID, v.WorkerEpoch)
	return err
}
func UpdateSnapshotPhase(tx *sql.Tx, id string, epoch int64, phase, now string, cleanupError *string) error {
	job, err := AssertSnapshotFence(tx, id, epoch)
	if err != nil {
		return err
	}
	if (job.Phase == "cleanup-pending" || job.Phase == "failed") && phase != "failed" && phase != "cleanup-pending" && phase != "cleaned" {
		return repositoryFailure("SNAPSHOT_WORKER_FENCED")
	}
	if phase == "cleaned" {
		pending, err := exists(tx, `SELECT 1 FROM work_snapshot_locks WHERE operation_id=? UNION ALL SELECT 1 FROM work_import_names WHERE operation_id=? UNION ALL SELECT 1 FROM snapshot_artifacts WHERE operation_id=? AND state!='cleaned' LIMIT 1`, id, id, id)
		if err != nil {
			return err
		}
		if pending {
			return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
		}
	}
	result, err := tx.Exec(`UPDATE snapshot_jobs SET phase=?,updated_at=?,cleanup_error=? WHERE operation_id=? AND worker_epoch=?`, phase, now, cleanupError, id, epoch)
	return changed(result, err, repositoryFailure("SNAPSHOT_WORKER_FENCED"))
}
func FenceSnapshotWorker(tx *sql.Tx, id, now string) (SnapshotJob, error) {
	job, err := ReadSnapshotJob(tx, id)
	if err != nil {
		return job, err
	}
	if job.Phase == "succeeded" || job.Phase == "cleaned" || !validBudget(job.WorkerEpoch+1) {
		return job, repositoryFailure("SNAPSHOT_WORKER_FENCED")
	}
	if _, err := tx.Exec(`UPDATE snapshot_jobs SET worker_epoch=worker_epoch+1,phase='cleanup-pending',updated_at=? WHERE operation_id=?`, now, id); err != nil {
		return job, err
	}
	if _, err := tx.Exec(`UPDATE work_snapshot_locks SET worker_epoch=worker_epoch+1 WHERE operation_id=?`, id); err != nil {
		return job, err
	}
	return ReadSnapshotJob(tx, id)
}

// Called only after Engine/helper and staging cleanup has been confirmed. A
// terminal HTTP result alone is not proof that these reservations are releasable.
func ReleaseSnapshotReservations(tx *sql.Tx, id string, epoch int64, absenceConfirmed bool) error {
	if !absenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	if _, err := AssertSnapshotFence(tx, id, epoch); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM work_snapshot_locks WHERE operation_id=? AND worker_epoch=?`, id, epoch); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM work_import_names WHERE operation_id=?`, id)
	return err
}
func ReserveImportName(tx *sql.Tx, owner, name, id string) error {
	busy, err := exists(tx, `SELECT 1 FROM work_import_names WHERE owner_user_id=? AND name=? UNION ALL SELECT 1 FROM works WHERE owner_user_id=? AND name=? LIMIT 1`, owner, name, owner, name)
	if err != nil {
		return err
	}
	if busy {
		return repositoryFailure("WORK_NAME_CONFLICT")
	}
	job, err := ReadSnapshotJob(tx, id)
	if err != nil {
		return err
	}
	if job.Kind != "import" || job.OwnerUserID != owner || job.Phase != "accepted" {
		return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
	}
	_, err = tx.Exec(`INSERT INTO work_import_names(owner_user_id,name,operation_id) VALUES(?,?,?)`, owner, name, id)
	return err
}
func InsertSnapshotArtifact(tx *sql.Tx, v SnapshotArtifact, epoch int64) error {
	if _, err := AssertSnapshotFence(tx, v.OperationID, epoch); err != nil {
		return err
	}
	_, err := tx.Exec(`INSERT INTO snapshot_artifacts(operation_id,artifact_key,kind,logical_id,state) VALUES(?,?,?,?,?)`, v.OperationID, v.ArtifactKey, v.Kind, v.LogicalID, v.State)
	return err
}
func SnapshotArtifacts(tx *sql.Tx, id string) ([]SnapshotArtifact, error) {
	rows, err := tx.Query(`SELECT operation_id,artifact_key,kind,logical_id,state FROM snapshot_artifacts WHERE operation_id=? ORDER BY artifact_key`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SnapshotArtifact{}
	for rows.Next() {
		var v SnapshotArtifact
		if err := rows.Scan(&v.OperationID, &v.ArtifactKey, &v.Kind, &v.LogicalID, &v.State); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func UpdateSnapshotArtifact(tx *sql.Tx, id string, epoch int64, key, state string) error {
	if _, err := AssertSnapshotFence(tx, id, epoch); err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE snapshot_artifacts SET state=? WHERE operation_id=? AND artifact_key=? AND state!='cleaned'`, state, id, key)
	return changed(result, err, repositoryFailure("SNAPSHOT_RECORD_CONFLICT"))
}
func scanSnapshotPackage(row rowScanner) (SnapshotPackage, error) {
	var v SnapshotPackage
	err := row.Scan(&v.ID, &v.OwnerUserID, &v.Digest, &v.Size, &v.State, &v.JobID, &v.CreatedAt, &v.ReadyAt, &v.ExpiresAt)
	return v, notFound(err)
}
func ReadSnapshotPackage(tx *sql.Tx, id string) (SnapshotPackage, error) {
	return scanSnapshotPackage(tx.QueryRow(`SELECT `+snapshotPackageColumns+` FROM snapshot_packages WHERE id=?`, id))
}
func InsertSnapshotPackage(tx *sql.Tx, v SnapshotPackage) error {
	if v.State != "staging" || !validBudget(v.Size) {
		return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
	}
	_, err := tx.Exec(`INSERT INTO snapshot_packages(`+snapshotPackageColumns+`) VALUES(?,?,?,?,?,?,?,?,?)`, v.ID, v.OwnerUserID, v.Digest, v.Size, v.State, v.JobID, v.CreatedAt, v.ReadyAt, v.ExpiresAt)
	return err
}
func SealSnapshotPackage(tx *sql.Tx, id, digest string, size int64, readyAt, expiresAt string) error {
	ready, err1 := time.Parse(time.RFC3339Nano, readyAt)
	expires, err2 := time.Parse(time.RFC3339Nano, expiresAt)
	if !snapshotDigest.MatchString(digest) || !validBudget(size) || err1 != nil || err2 != nil || !expires.After(ready) {
		return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
	}
	result, err := tx.Exec(`UPDATE snapshot_packages SET digest=?,size=?,state='ready',ready_at=?,expires_at=? WHERE id=? AND state='staging'`, digest, size, readyAt, expiresAt, id)
	return changed(result, err, repositoryFailure("SNAPSHOT_RECORD_CONFLICT"))
}
func SealOrReuseSnapshotPackage(tx *sql.Tx, id, owner, digest string, size int64, readyAt, expiresAt string) (SnapshotPackage, error) {
	current, err := ReadSnapshotPackage(tx, id)
	if err != nil {
		return current, err
	}
	if current.OwnerUserID != owner || current.State != "staging" {
		return current, repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
	}
	// Validate even when another package's bytes have the same digest.
	if err := SealSnapshotPackage(tx, id, digest, size, readyAt, expiresAt); err != nil {
		return current, err
	}
	duplicate, err := scanSnapshotPackage(tx.QueryRow(`SELECT `+snapshotPackageColumns+` FROM snapshot_packages WHERE owner_user_id=? AND digest=? AND size=? AND state='ready' AND expires_at>? AND id!=? ORDER BY ready_at,id LIMIT 1`, owner, digest, size, readyAt, id))
	if err == nil {
		_, err = tx.Exec(`UPDATE snapshot_packages SET state='expired',expires_at=? WHERE id=?`, readyAt, id)
		return duplicate, err
	}
	if err != ErrNotFound {
		return current, err
	}
	return ReadSnapshotPackage(tx, id)
}
func SnapshotPackageInUse(tx *sql.Tx, id string) (bool, error) {
	return exists(tx, `SELECT 1 FROM snapshot_transfers WHERE package_id=? UNION ALL SELECT 1 FROM snapshot_jobs WHERE package_id=? AND phase NOT IN ('succeeded','cleaned') LIMIT 1`, id, id)
}
func ExpireSnapshotPackage(tx *sql.Tx, id, now string) (bool, error) {
	busy, err := SnapshotPackageInUse(tx, id)
	if err != nil || busy {
		return false, err
	}
	result, err := tx.Exec(`UPDATE snapshot_packages SET state='expired' WHERE id=? AND state='ready' AND expires_at<=?`, id, now)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}
func MarkSnapshotPackageDeleting(tx *sql.Tx, id string) (bool, error) {
	busy, err := SnapshotPackageInUse(tx, id)
	if err != nil || busy {
		return false, err
	}
	result, err := tx.Exec(`UPDATE snapshot_packages SET state='deleting' WHERE id=? AND state IN ('staging','expired')`, id)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}
func AcceptSnapshotTransfer(tx *sql.Tx, v SnapshotTransfer, upload *SnapshotPackage) error {
	var count int
	if err := tx.QueryRow(`SELECT count(*) FROM snapshot_transfers`).Scan(&count); err != nil {
		return err
	}
	if count >= 2 {
		return repositoryFailure("SNAPSHOT_TRANSFER_BUSY")
	}
	if upload != nil {
		if v.Kind != "upload" || v.PackageID == nil || *v.PackageID != upload.ID || v.OwnerUserID != upload.OwnerUserID || upload.State != "staging" {
			return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
		}
		if err := InsertSnapshotPackage(tx, *upload); err != nil {
			return err
		}
	}
	if v.PackageID != nil {
		pack, err := ReadSnapshotPackage(tx, *v.PackageID)
		if err != nil {
			return err
		}
		if pack.OwnerUserID != v.OwnerUserID || (v.Kind == "download" && (pack.State != "ready" || pack.ExpiresAt == nil || *pack.ExpiresAt <= v.CreatedAt)) {
			return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
		}
	}
	if v.SnapshotID != nil {
		var owner string
		var packageID *string
		if err := tx.QueryRow(`SELECT owner_user_id,package_id FROM snapshot_jobs WHERE snapshot_id=?`, *v.SnapshotID).Scan(&owner, &packageID); err != nil {
			return notFound(err)
		}
		if owner != v.OwnerUserID || (v.PackageID != nil && (packageID == nil || *packageID != *v.PackageID)) {
			return repositoryFailure("SNAPSHOT_RECORD_CONFLICT")
		}
	}
	_, err := tx.Exec(`INSERT INTO snapshot_transfers(id,owner_user_id,package_id,snapshot_id,kind,phase,deadline_at,last_progress_at,helper_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`, v.ID, v.OwnerUserID, v.PackageID, v.SnapshotID, v.Kind, v.Phase, v.DeadlineAt, v.LastProgressAt, v.HelperID, v.CreatedAt)
	return err
}
func SnapshotTransfers(tx *sql.Tx) ([]SnapshotTransfer, error) {
	rows, err := tx.Query(`SELECT id,owner_user_id,package_id,snapshot_id,kind,phase,deadline_at,last_progress_at,helper_id,created_at FROM snapshot_transfers ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []SnapshotTransfer{}
	for rows.Next() {
		var v SnapshotTransfer
		if err := rows.Scan(&v.ID, &v.OwnerUserID, &v.PackageID, &v.SnapshotID, &v.Kind, &v.Phase, &v.DeadlineAt, &v.LastProgressAt, &v.HelperID, &v.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func UpdateSnapshotTransfer(tx *sql.Tx, id, phase, now string, helperID *string) error {
	result, err := tx.Exec(`UPDATE snapshot_transfers SET phase=?,last_progress_at=?,helper_id=? WHERE id=? AND (phase!='cleanup-pending' OR ?='cleanup-pending')`, phase, now, helperID, id, phase)
	return changed(result, err, repositoryFailure("SNAPSHOT_RECORD_CONFLICT"))
}
func FinishSnapshotTransfer(tx *sql.Tx, id string, absenceConfirmed bool) error {
	if !absenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	result, err := tx.Exec(`DELETE FROM snapshot_transfers WHERE id=?`, id)
	return changed(result, err, repositoryFailure("SNAPSHOT_RECORD_CONFLICT"))
}
