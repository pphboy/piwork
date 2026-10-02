package corestore

import (
	"database/sql"
	"errors"
	"regexp"
	"time"

	"piwork/internal/contracts"
)

type rowScanner interface{ Scan(...any) error }

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
func changed(result sql.Result, err error, conflict error) error {
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count != 1 {
		return conflict
	}
	return nil
}

// Repository codes are internal domains. HTTP handlers must explicitly project
// them; unknown internal codes cannot turn into client controlled messages.
type RepositoryError struct{ code string }

func (e *RepositoryError) Error() string { return e.code }
func (e *RepositoryError) Code() string  { return e.code }
func (e *RepositoryError) Is(other error) bool {
	target, ok := other.(*RepositoryError)
	return ok && target.code == e.code
}
func repositoryFailure(code string) error {
	switch code {
	case "NOT_FOUND", "AUTH_REQUIRED", "WORK_FILES_UNAVAILABLE", "WORK_SNAPSHOT_BUSY", "FILE_ACCESS_BUSY", "FILE_CLEANUP_REQUIRED", "FILE_CONFLICT", "WORK_BUSY", "SNAPSHOT_RECORD_CONFLICT", "SNAPSHOT_WORKER_FENCED", "SNAPSHOT_TRANSFER_BUSY", "SNAPSHOT_CAPACITY_BUSY", "WORK_NAME_CONFLICT", "PI_PACKAGE_BUSY", "PI_PACKAGE_NOT_FOUND", "PI_PACKAGE_STALE_JOB", "PI_PACKAGE_ENVIRONMENT_MISMATCH":
		return &RepositoryError{code: code}
	default:
		return ErrStorage
	}
}
func exists(tx *sql.Tx, query string, args ...any) (bool, error) {
	var one int
	err := tx.QueryRow(query, args...).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

type FileGate struct {
	WorkID    string
	Epoch     int64
	Closed    bool
	UpdatedAt string
}
type FileJob struct {
	ID, WorkID, OwnerUserID, SessionID                        string
	CoreEpoch, WorkEpoch, RuntimeGeneration                   int64
	Kind, State, TrustedImageID, VolumeName, PathSegmentsJSON string
	DestinationSegmentsJSON                                   *string
	AcceptedAt, DeadlineAt, UpdatedAt                         string
	CleanedAt, ErrorCode                                      *string
}
type FileAttempt struct {
	ID, JobID, Kind             string
	Epoch                       int64
	ContainerName               string
	ContainerID                 *string
	State, CreatedAt, UpdatedAt string
}
type FileTemporary struct {
	ID, JobID, ParentSegmentsJSON, Name string
	Device, Inode                       *string
	State, CreatedAt, UpdatedAt         string
}

const fileJobColumns = `id,work_id,owner_user_id,session_id,core_epoch,work_epoch,runtime_generation,kind,state,trusted_image_id,volume_name,path_segments_json,destination_segments_json,accepted_at,deadline_at,updated_at,cleaned_at,error_code`

func scanFileJob(row rowScanner) (FileJob, error) {
	var v FileJob
	err := row.Scan(&v.ID, &v.WorkID, &v.OwnerUserID, &v.SessionID, &v.CoreEpoch, &v.WorkEpoch, &v.RuntimeGeneration, &v.Kind, &v.State, &v.TrustedImageID, &v.VolumeName, &v.PathSegmentsJSON, &v.DestinationSegmentsJSON, &v.AcceptedAt, &v.DeadlineAt, &v.UpdatedAt, &v.CleanedAt, &v.ErrorCode)
	return v, notFound(err)
}
func ReadFileJob(tx *sql.Tx, id string) (FileJob, error) {
	return scanFileJob(tx.QueryRow(`SELECT `+fileJobColumns+` FROM work_file_jobs WHERE id=?`, id))
}
func PendingFileJobs(tx *sql.Tx, workID *string) ([]FileJob, error) {
	query := `SELECT ` + fileJobColumns + ` FROM work_file_jobs WHERE state!='cleaned'`
	var args []any
	if workID != nil {
		query += ` AND work_id=?`
		args = append(args, *workID)
	}
	query += ` ORDER BY accepted_at,id`
	rows, err := tx.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FileJob{}
	for rows.Next() {
		v, err := scanFileJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func NextFileCoreEpoch(tx *sql.Tx) (int64, error) {
	var epoch int64
	err := tx.QueryRow(`UPDATE work_file_core_epoch SET epoch=epoch+1 WHERE id=1 AND epoch<? RETURNING epoch`, contracts.MaxSafeInteger).Scan(&epoch)
	return epoch, notFound(err)
}
func ReadFileGate(tx *sql.Tx, workID string) (FileGate, error) {
	var v FileGate
	err := tx.QueryRow(`SELECT work_id,epoch,closed,updated_at FROM work_file_gates WHERE work_id=?`, workID).Scan(&v.WorkID, &v.Epoch, &v.Closed, &v.UpdatedAt)
	return v, notFound(err)
}
func ensureFileGate(tx *sql.Tx, workID, now string) (FileGate, error) {
	if _, err := tx.Exec(`INSERT INTO work_file_gates(work_id,epoch,closed,updated_at) VALUES(?,1,0,?) ON CONFLICT(work_id) DO NOTHING`, workID, now); err != nil {
		return FileGate{}, err
	}
	return ReadFileGate(tx, workID)
}
func CloseFileGate(tx *sql.Tx, workID, now string) (FileGate, error) {
	if _, err := ensureFileGate(tx, workID, now); err != nil {
		return FileGate{}, err
	}
	result, err := tx.Exec(`UPDATE work_file_gates SET closed=1,epoch=epoch+1,updated_at=? WHERE work_id=? AND epoch<?`, now, workID, contracts.MaxSafeInteger)
	if err = changed(result, err, repositoryFailure("FILE_CONFLICT")); err != nil {
		return FileGate{}, err
	}
	return ReadFileGate(tx, workID)
}
func OpenFileGate(tx *sql.Tx, workID, now string) (FileGate, error) {
	if _, err := ensureFileGate(tx, workID, now); err != nil {
		return FileGate{}, err
	}
	pending, err := exists(tx, `SELECT 1 FROM work_file_jobs WHERE work_id=? AND state!='cleaned' LIMIT 1`, workID)
	if err != nil {
		return FileGate{}, err
	}
	if pending {
		return FileGate{}, repositoryFailure("FILE_CLEANUP_REQUIRED")
	}
	if err := AssertWorkMutable(tx, workID); err != nil {
		return FileGate{}, err
	}
	result, err := tx.Exec(`UPDATE work_file_gates SET closed=0,epoch=epoch+1,updated_at=? WHERE work_id=? AND epoch<?`, now, workID, contracts.MaxSafeInteger)
	if err = changed(result, err, repositoryFailure("FILE_CONFLICT")); err != nil {
		return FileGate{}, err
	}
	return ReadFileGate(tx, workID)
}
func assertFileSession(tx *sql.Tx, owner, session, now string) error {
	valid, err := exists(tx, `SELECT 1 FROM login_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.enabled=1`, session, owner, now)
	if err != nil {
		return err
	}
	if !valid {
		return repositoryFailure("AUTH_REQUIRED")
	}
	return nil
}
func AssertFileAccess(tx *sql.Tx, workID, owner, session, now string) error {
	if err := assertFileSession(tx, owner, session, now); err != nil {
		return err
	}
	work, err := ReadWork(tx, workID, false)
	if err != nil {
		return err
	}
	if work.OwnerUserID != owner {
		return ErrNotFound
	}
	if work.DesiredState != "running" || (work.ObservedState != "ready" && work.ObservedState != "degraded") {
		return repositoryFailure("WORK_FILES_UNAVAILABLE")
	}
	gate, err := ReadFileGate(tx, workID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if gate.Closed {
		return repositoryFailure("WORK_FILES_UNAVAILABLE")
	}
	pending, err := exists(tx, `SELECT 1 FROM work_file_jobs WHERE work_id=? AND state='cleanup-pending' LIMIT 1`, workID)
	if err != nil {
		return err
	}
	if pending {
		return repositoryFailure("FILE_CLEANUP_REQUIRED")
	}
	return nil
}
func fileMutation(kind string) bool {
	switch kind {
	case "PUT", "MKCOL", "COPY", "MOVE", "DELETE", "PROPPATCH":
		return true
	}
	return false
}
func AcceptFileJob(tx *sql.Tx, v FileJob, first *FileAttempt) (FileJob, error) {
	if v.State != "accepted" || v.CleanedAt != nil {
		return FileJob{}, repositoryFailure("FILE_CONFLICT")
	}
	if err := AssertFileAccess(tx, v.WorkID, v.OwnerUserID, v.SessionID, v.AcceptedAt); err != nil {
		return FileJob{}, err
	}
	gate, err := ensureFileGate(tx, v.WorkID, v.AcceptedAt)
	if err != nil {
		return FileJob{}, err
	}
	if err := AssertWorkMutable(tx, v.WorkID); err != nil {
		return FileJob{}, err
	}
	var coreEpoch int64
	if err := tx.QueryRow(`SELECT epoch FROM work_file_core_epoch WHERE id=1`).Scan(&coreEpoch); err != nil {
		return FileJob{}, err
	}
	if coreEpoch != v.CoreEpoch {
		return FileJob{}, repositoryFailure("FILE_CONFLICT")
	}
	var total, user, work int
	if err := tx.QueryRow(`SELECT count(*),COALESCE(sum(CASE WHEN owner_user_id=? THEN 1 ELSE 0 END),0),COALESCE(sum(CASE WHEN work_id=? THEN 1 ELSE 0 END),0) FROM work_file_jobs WHERE state!='cleaned'`, v.OwnerUserID, v.WorkID).Scan(&total, &user, &work); err != nil {
		return FileJob{}, err
	}
	if total >= 16 || user >= 8 || work >= 4 {
		return FileJob{}, repositoryFailure("FILE_ACCESS_BUSY")
	}
	if fileMutation(v.Kind) {
		busy, err := exists(tx, `SELECT 1 FROM work_file_jobs WHERE work_id=? AND state!='cleaned' AND kind IN ('PUT','MKCOL','COPY','MOVE','DELETE','PROPPATCH') LIMIT 1`, v.WorkID)
		if err != nil {
			return FileJob{}, err
		}
		if busy {
			return FileJob{}, repositoryFailure("FILE_ACCESS_BUSY")
		}
	}
	v.WorkEpoch = gate.Epoch
	if _, err := tx.Exec(`INSERT INTO work_file_jobs(`+fileJobColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.ID, v.WorkID, v.OwnerUserID, v.SessionID, v.CoreEpoch, v.WorkEpoch, v.RuntimeGeneration, v.Kind, v.State, v.TrustedImageID, v.VolumeName, v.PathSegmentsJSON, v.DestinationSegmentsJSON, v.AcceptedAt, v.DeadlineAt, v.UpdatedAt, v.CleanedAt, v.ErrorCode); err != nil {
		return FileJob{}, err
	}
	if first != nil {
		if first.JobID != v.ID || first.Kind != "request" || first.State != "planned" {
			return FileJob{}, repositoryFailure("FILE_CONFLICT")
		}
		copy := *first
		copy.Epoch = gate.Epoch
		if err := InsertFileAttempt(tx, copy); err != nil {
			return FileJob{}, err
		}
	}
	return v, nil
}
func AuthorizeFileCommit(tx *sql.Tx, id string, epoch int64, now string) error {
	job, err := ReadFileJob(tx, id)
	if err != nil {
		return err
	}
	if (job.State != "running" && job.State != "prepared") || job.WorkEpoch != epoch {
		return repositoryFailure("FILE_CONFLICT")
	}
	var coreEpoch int64
	if err := tx.QueryRow(`SELECT epoch FROM work_file_core_epoch WHERE id=1`).Scan(&coreEpoch); err != nil {
		return err
	}
	if job.CoreEpoch != coreEpoch {
		return repositoryFailure("FILE_CONFLICT")
	}
	gate, err := ReadFileGate(tx, job.WorkID)
	if err != nil {
		return err
	}
	if gate.Closed || gate.Epoch != epoch {
		return repositoryFailure("WORK_FILES_UNAVAILABLE")
	}
	if err := AssertWorkMutable(tx, job.WorkID); err != nil {
		return err
	}
	if err := assertFileSession(tx, job.OwnerUserID, job.SessionID, now); err != nil {
		return err
	}
	result, err := tx.Exec(`UPDATE work_file_jobs SET state='committing',updated_at=? WHERE id=? AND state=?`, now, id, job.State)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}
func UpdateFileJobState(tx *sql.Tx, id, expected, state, now string, errorCode *string) error {
	if expected == "cleaned" || state == "cleaned" || state == "committing" {
		return repositoryFailure("FILE_CONFLICT")
	}
	if (expected == "cleanup-pending" || expected == "cancelling" || expected == "finished") && state != "cleanup-pending" && state != "cancelling" {
		return repositoryFailure("FILE_CONFLICT")
	}
	result, err := tx.Exec(`UPDATE work_file_jobs SET state=?,updated_at=?,error_code=? WHERE id=? AND state=?`, state, now, errorCode, id, expected)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}
func MarkFileCleaned(tx *sql.Tx, id, now string) error {
	job, err := ReadFileJob(tx, id)
	if err != nil {
		return err
	}
	if job.State == "cleaned" {
		return repositoryFailure("FILE_CONFLICT")
	}
	pending, err := exists(tx, `SELECT 1 FROM work_file_attempts WHERE job_id=? AND state!='removed' UNION ALL SELECT 1 FROM work_file_temporaries WHERE job_id=? AND state NOT IN ('published','cleaned') LIMIT 1`, id, id)
	if err != nil {
		return err
	}
	if pending {
		return repositoryFailure("FILE_CLEANUP_REQUIRED")
	}
	result, err := tx.Exec(`UPDATE work_file_jobs SET state='cleaned',cleaned_at=?,updated_at=? WHERE id=?`, now, now, id)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}
func InsertFileAttempt(tx *sql.Tx, v FileAttempt) error {
	job, err := ReadFileJob(tx, v.JobID)
	if err != nil {
		return err
	}
	if job.State == "cleaned" || v.State != "planned" || (v.Kind == "request" && v.Epoch != job.WorkEpoch) {
		return repositoryFailure("FILE_CONFLICT")
	}
	_, err = tx.Exec(`INSERT INTO work_file_attempts(id,job_id,kind,epoch,container_name,container_id,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, v.ID, v.JobID, v.Kind, v.Epoch, v.ContainerName, v.ContainerID, v.State, v.CreatedAt, v.UpdatedAt)
	return err
}
func FileAttempts(tx *sql.Tx, jobID string) ([]FileAttempt, error) {
	rows, err := tx.Query(`SELECT id,job_id,kind,epoch,container_name,container_id,state,created_at,updated_at FROM work_file_attempts WHERE job_id=? ORDER BY created_at,id`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FileAttempt{}
	for rows.Next() {
		var v FileAttempt
		if err := rows.Scan(&v.ID, &v.JobID, &v.Kind, &v.Epoch, &v.ContainerName, &v.ContainerID, &v.State, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func UpdateFileAttempt(tx *sql.Tx, id, expected, state, now string, containerID *string) error {
	if expected == "removed" || (state == "removed" && expected != "exited") {
		return repositoryFailure("FILE_CONFLICT")
	}
	result, err := tx.Exec(`UPDATE work_file_attempts SET state=?,container_id=COALESCE(?,container_id),updated_at=? WHERE id=? AND state=?`, state, containerID, now, id, expected)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}

// A create timeout can leave a planned/unknown attempt with no container ID.
// Recovery must confirm name-based Engine absence before collecting that row.
func ConfirmFileAttemptRemoved(tx *sql.Tx, id, expected, now string, absenceConfirmed bool) error {
	if !absenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	if expected == "removed" {
		return repositoryFailure("FILE_CONFLICT")
	}
	result, err := tx.Exec(`UPDATE work_file_attempts SET state='removed',updated_at=? WHERE id=? AND state=?`, now, id, expected)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}
func InsertFileTemporary(tx *sql.Tx, v FileTemporary) error {
	job, err := ReadFileJob(tx, v.JobID)
	if err != nil {
		return err
	}
	if job.State == "cleaned" || v.State != "planned" || v.Device != nil || v.Inode != nil {
		return repositoryFailure("FILE_CONFLICT")
	}
	_, err = tx.Exec(`INSERT INTO work_file_temporaries(id,job_id,parent_segments_json,name,device,inode,state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, v.ID, v.JobID, v.ParentSegmentsJSON, v.Name, v.Device, v.Inode, v.State, v.CreatedAt, v.UpdatedAt)
	return err
}
func FileTemporaries(tx *sql.Tx, jobID string) ([]FileTemporary, error) {
	rows, err := tx.Query(`SELECT id,job_id,parent_segments_json,name,device,inode,state,created_at,updated_at FROM work_file_temporaries WHERE job_id=? ORDER BY created_at,id`, jobID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []FileTemporary{}
	for rows.Next() {
		var v FileTemporary
		if err := rows.Scan(&v.ID, &v.JobID, &v.ParentSegmentsJSON, &v.Name, &v.Device, &v.Inode, &v.State, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

var fileIdentity = regexp.MustCompile(`^[0-9]+$`)

func ConfirmFileTemporary(tx *sql.Tx, id, jobID, device, inode, now string) error {
	if !fileIdentity.MatchString(device) || !fileIdentity.MatchString(inode) {
		return repositoryFailure("FILE_CONFLICT")
	}
	result, err := tx.Exec(`UPDATE work_file_temporaries SET state='created',device=?,inode=?,updated_at=? WHERE id=? AND job_id=? AND state='planned'`, device, inode, now, id, jobID)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}
func MarkFileTemporary(tx *sql.Tx, id, jobID, state, now string) error {
	allowed := `state IN ('planned','created','uncertain')`
	switch state {
	case "published":
		allowed = `state='created'`
	case "cleaned", "uncertain":
	default:
		return repositoryFailure("FILE_CONFLICT")
	}
	result, err := tx.Exec(`UPDATE work_file_temporaries SET state=?,updated_at=? WHERE id=? AND job_id=? AND `+allowed, state, now, id, jobID)
	return changed(result, err, repositoryFailure("FILE_CONFLICT"))
}
func ReserveFileCleanupRetry(tx *sql.Tx, jobID, now string, explicit bool) (bool, error) {
	job, err := ReadFileJob(tx, jobID)
	if err != nil {
		return false, err
	}
	if job.State == "cleaned" {
		return false, nil
	}
	instant, err := time.Parse(time.RFC3339Nano, now)
	if err != nil {
		return false, repositoryFailure("FILE_CONFLICT")
	}
	var started string
	var attempts int64
	err = tx.QueryRow(`SELECT window_started_at,attempts FROM work_file_cleanup_retries WHERE job_id=?`, jobID).Scan(&started, &attempts)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return false, err
	}
	restart := explicit || errors.Is(err, sql.ErrNoRows)
	if !restart {
		previous, err := time.Parse(time.RFC3339Nano, started)
		if err != nil {
			return false, ErrUnsupported
		}
		restart = instant.Sub(previous) >= 10*time.Minute
		if !restart && attempts >= 3 {
			return false, nil
		}
	}
	if restart {
		started = now
		attempts = 1
	} else {
		attempts++
	}
	_, err = tx.Exec(`INSERT INTO work_file_cleanup_retries(job_id,window_started_at,attempts,last_attempt_at) VALUES(?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET window_started_at=excluded.window_started_at,attempts=excluded.attempts,last_attempt_at=excluded.last_attempt_at`, jobID, started, attempts, now)
	return err == nil, err
}
func CollectCleanedFiles(tx *sql.Tx, now string) (int64, error) {
	instant, err := time.Parse(time.RFC3339Nano, now)
	if err != nil {
		return 0, repositoryFailure("FILE_CONFLICT")
	}
	result, err := tx.Exec(`DELETE FROM work_file_jobs WHERE state='cleaned' AND cleaned_at<=?`, instant.Add(-24*time.Hour).UTC().Format("2006-01-02T15:04:05.000Z"))
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
