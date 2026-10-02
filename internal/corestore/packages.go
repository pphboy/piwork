package corestore

import (
	"database/sql"
	"encoding/json"
	"errors"
	"strings"

	"piwork/internal/contracts"
)

type PackageArtifact struct {
	ID, ScopeKind                                             string
	WorkID                                                    *string
	Name, ContentDigest, MetadataJSON, StoragePath, CreatedAt string
	LeaseCount                                                int64
}
type PackageUpload struct {
	ID, ActorID, ScopeKind  string
	WorkID                  *string
	SourceKind, DisplayName string
	Digest                  *string
	Size                    int64
	State                   string
	ExpiresAt               *string
	LeaseCount              int64
	CreatedAt               string
}
type PackageJob struct {
	OperationID, ScopeKind                                                       string
	WorkID                                                                       *string
	ActorID, Kind, PrepareImageID, TrustedHelperImageID, PreparedEnvironmentJSON string
	AddToDefaults                                                                bool
	SourceJSON                                                                   string
	SourceUploadID                                                               *string
	RequestDigest                                                                string
	PackageName                                                                  *string
	Phase                                                                        string
	WorkerEpoch                                                                  int64
	HelperID                                                                     *string
	DeadlineAt, CreatedAt, UpdatedAt                                             string
	CleanupError                                                                 *string
	LeasesReleased                                                               bool
}

const packageJobColumns = `operation_id,scope_kind,work_id,actor_id,kind,prepare_image_id,trusted_helper_image_id,prepared_environment_json,add_to_defaults,source_json,source_upload_id,request_digest,package_name,phase,worker_epoch,helper_id,deadline_at,created_at,updated_at,cleanup_error,leases_released`
const packageArtifactColumns = `id,scope_kind,work_id,name,content_digest,metadata_json,storage_path,created_at,lease_count`
const packageUploadColumns = `id,actor_id,scope_kind,work_id,source_kind,display_name,digest,size,state,expires_at,lease_count,created_at`

func scanPackageJob(row rowScanner) (PackageJob, error) {
	var v PackageJob
	err := row.Scan(&v.OperationID, &v.ScopeKind, &v.WorkID, &v.ActorID, &v.Kind, &v.PrepareImageID, &v.TrustedHelperImageID, &v.PreparedEnvironmentJSON, &v.AddToDefaults, &v.SourceJSON, &v.SourceUploadID, &v.RequestDigest, &v.PackageName, &v.Phase, &v.WorkerEpoch, &v.HelperID, &v.DeadlineAt, &v.CreatedAt, &v.UpdatedAt, &v.CleanupError, &v.LeasesReleased)
	return v, notFound(err)
}
func ReadPackageJob(tx *sql.Tx, id string) (PackageJob, error) {
	return scanPackageJob(tx.QueryRow(`SELECT `+packageJobColumns+` FROM pi_package_jobs WHERE operation_id=?`, id))
}
func PackageJobs(tx *sql.Tx, liveOnly bool) ([]PackageJob, error) {
	query := `SELECT ` + packageJobColumns + ` FROM pi_package_jobs`
	if liveOnly {
		query += ` WHERE phase IN ('queued','source','prepare','validate','publish','cleanup-pending')`
	}
	query += ` ORDER BY created_at,operation_id`
	rows, err := tx.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []PackageJob{}
	for rows.Next() {
		v, err := scanPackageJob(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func ReadPackageArtifact(tx *sql.Tx, id string) (PackageArtifact, error) {
	var v PackageArtifact
	err := tx.QueryRow(`SELECT `+packageArtifactColumns+` FROM pi_package_artifacts WHERE id=?`, id).Scan(&v.ID, &v.ScopeKind, &v.WorkID, &v.Name, &v.ContentDigest, &v.MetadataJSON, &v.StoragePath, &v.CreatedAt, &v.LeaseCount)
	return v, notFound(err)
}
func InsertPackageArtifact(tx *sql.Tx, v PackageArtifact) error {
	if v.LeaseCount != 0 {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	_, err := tx.Exec(`INSERT INTO pi_package_artifacts(`+packageArtifactColumns+`) VALUES(?,?,?,?,?,?,?,?,0)`, v.ID, v.ScopeKind, v.WorkID, v.Name, v.ContentDigest, v.MetadataJSON, v.StoragePath, v.CreatedAt)
	return err
}
func ReadPackageUpload(tx *sql.Tx, id string) (PackageUpload, error) {
	var v PackageUpload
	err := tx.QueryRow(`SELECT `+packageUploadColumns+` FROM pi_package_uploads WHERE id=?`, id).Scan(&v.ID, &v.ActorID, &v.ScopeKind, &v.WorkID, &v.SourceKind, &v.DisplayName, &v.Digest, &v.Size, &v.State, &v.ExpiresAt, &v.LeaseCount, &v.CreatedAt)
	return v, notFound(err)
}
func InsertPackageUpload(tx *sql.Tx, v PackageUpload) error {
	if v.LeaseCount != 0 {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	_, err := tx.Exec(`INSERT INTO pi_package_uploads(`+packageUploadColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)`, v.ID, v.ActorID, v.ScopeKind, v.WorkID, v.SourceKind, v.DisplayName, v.Digest, v.Size, v.State, v.ExpiresAt, v.CreatedAt)
	return err
}
func UpdatePackageUpload(tx *sql.Tx, id, digest string, size int64, expires string) error {
	if !snapshotDigest.MatchString(digest) || !validBudget(size) {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	result, err := tx.Exec(`UPDATE pi_package_uploads SET state='ready',digest=?,size=?,expires_at=? WHERE id=? AND state='staging'`, digest, size, expires, id)
	return changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB"))
}
func capturedArtifact(sourceJSON string) (string, error) {
	var source struct {
		Kind       string `json:"kind"`
		ArtifactID string `json:"artifactId"`
	}
	if err := json.Unmarshal([]byte(sourceJSON), &source); err != nil {
		return "", repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if source.Kind == "core" {
		if source.ArtifactID == "" {
			return "", repositoryFailure("PI_PACKAGE_NOT_FOUND")
		}
		return source.ArtifactID, nil
	}
	return "", nil
}
func captureCorePackage(tx *sql.Tx, v *PackageJob) error {
	var source struct{ Kind, Name string }
	if err := json.Unmarshal([]byte(v.SourceJSON), &source); err != nil {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if v.ScopeKind != "work" || source.Kind != "core" {
		return nil
	}
	var artifactID string
	err := tx.QueryRow(`SELECT head_artifact_id FROM pi_package_catalog WHERE name=? AND enabled=1`, source.Name).Scan(&artifactID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return repositoryFailure("PI_PACKAGE_NOT_FOUND")
		}
		return err
	}
	artifact, err := ReadPackageArtifact(tx, artifactID)
	if err != nil {
		return err
	}
	if artifact.ScopeKind != "core" || artifact.Name != source.Name {
		return repositoryFailure("PI_PACKAGE_NOT_FOUND")
	}
	var metadata struct {
		PreparedEnvironment map[string]any `json:"preparedEnvironment"`
	}
	var target map[string]any
	if json.Unmarshal([]byte(artifact.MetadataJSON), &metadata) != nil || json.Unmarshal([]byte(v.PreparedEnvironmentJSON), &target) != nil || metadata.PreparedEnvironment == nil {
		return repositoryFailure("PI_PACKAGE_ENVIRONMENT_MISMATCH")
	}
	for _, key := range []string{"os", "architecture", "variant", "nodeAbi", "piSdkVersion"} {
		a, aOK := metadata.PreparedEnvironment[key]
		b, bOK := target[key]
		aBytes, _ := json.Marshal(a)
		bBytes, _ := json.Marshal(b)
		if !aOK || !bOK || string(aBytes) != string(bBytes) {
			return repositoryFailure("PI_PACKAGE_ENVIRONMENT_MISMATCH")
		}
	}
	bytes, err := json.Marshal(map[string]string{"kind": "core", "name": source.Name, "artifactId": artifactID})
	if err != nil {
		return err
	}
	v.SourceJSON = string(bytes)
	return nil
}

// InsertPackageJob is called by AcceptMutation: upload/artifact leases and the
// queued job become durable with the same Operation, or all roll back together.
func InsertPackageJob(tx *sql.Tx, v PackageJob) (PackageJob, error) {
	if v.Phase != "queued" || v.WorkerEpoch != 1 || v.LeasesReleased || v.HelperID != nil {
		return v, repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if v.WorkID != nil {
		if err := AssertWorkMutable(tx, *v.WorkID); err != nil {
			return v, err
		}
	}
	busy, err := exists(tx, `SELECT 1 FROM pi_package_jobs WHERE scope_kind=? AND work_id IS ? AND phase IN ('queued','source','prepare','validate','publish','cleanup-pending') LIMIT 1`, v.ScopeKind, v.WorkID)
	if err != nil {
		return v, err
	}
	if busy {
		return v, repositoryFailure("PI_PACKAGE_BUSY")
	}
	if _, err := contracts.ParseJSON(strings.NewReader(v.SourceJSON), 1<<20); err != nil {
		return v, repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if err := captureCorePackage(tx, &v); err != nil {
		return v, err
	}
	_, err = tx.Exec(`INSERT INTO pi_package_jobs(`+packageJobColumns+`) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, v.OperationID, v.ScopeKind, v.WorkID, v.ActorID, v.Kind, v.PrepareImageID, v.TrustedHelperImageID, v.PreparedEnvironmentJSON, v.AddToDefaults, v.SourceJSON, v.SourceUploadID, v.RequestDigest, v.PackageName, v.Phase, v.WorkerEpoch, v.HelperID, v.DeadlineAt, v.CreatedAt, v.UpdatedAt, v.CleanupError, v.LeasesReleased)
	if err != nil {
		return v, err
	}
	if v.SourceUploadID != nil {
		result, err := tx.Exec(`UPDATE pi_package_uploads SET lease_count=lease_count+1 WHERE id=? AND actor_id=? AND scope_kind=? AND work_id IS ? AND state='ready' AND expires_at>? AND lease_count<?`, *v.SourceUploadID, v.ActorID, v.ScopeKind, v.WorkID, v.CreatedAt, contracts.MaxSafeInteger)
		if err = changed(result, err, repositoryFailure("PI_PACKAGE_NOT_FOUND")); err != nil {
			return v, err
		}
	}
	artifactID, err := capturedArtifact(v.SourceJSON)
	if err != nil {
		return v, err
	}
	if artifactID != "" {
		result, err := tx.Exec(`UPDATE pi_package_artifacts SET lease_count=lease_count+1 WHERE id=? AND scope_kind='core' AND lease_count<?`, artifactID, contracts.MaxSafeInteger)
		if err = changed(result, err, repositoryFailure("PI_PACKAGE_NOT_FOUND")); err != nil {
			return v, err
		}
	}
	return v, nil
}
func livePackagePhase(phase string) bool {
	switch phase {
	case "queued", "source", "prepare", "validate", "publish":
		return true
	}
	return false
}
func AdvancePackageJob(tx *sql.Tx, id string, epoch int64, phase, now string, name, helperID *string) error {
	job, err := ReadPackageJob(tx, id)
	if err != nil {
		return err
	}
	if job.WorkerEpoch != epoch || !livePackagePhase(job.Phase) || !livePackagePhase(phase) || phase == "queued" || job.LeasesReleased {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	operation, err := readOperation(tx, id)
	if err != nil {
		return err
	}
	current, err := fenceCurrent(tx, operation)
	if err != nil {
		return err
	}
	if !current {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if job.WorkID != nil {
		if err := AssertWorkMutable(tx, *job.WorkID); err != nil {
			return err
		}
	}
	result, err := tx.Exec(`UPDATE pi_package_jobs SET phase=?,package_name=COALESCE(?,package_name),helper_id=COALESCE(?,helper_id),updated_at=? WHERE operation_id=? AND worker_epoch=?`, phase, name, helperID, now, id, epoch)
	if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
		return err
	}
	result, err = tx.Exec(`UPDATE operations SET state='running',updated_at=? WHERE id=? AND state IN ('pending','running')`, now, id)
	return changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB"))
}
func releasePackageLeases(tx *sql.Tx, job PackageJob) error {
	if job.LeasesReleased {
		return nil
	}
	if job.SourceUploadID != nil {
		result, err := tx.Exec(`UPDATE pi_package_uploads SET lease_count=lease_count-1 WHERE id=? AND lease_count>0`, *job.SourceUploadID)
		if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
			return err
		}
	}
	artifactID, err := capturedArtifact(job.SourceJSON)
	if err != nil {
		return err
	}
	if artifactID != "" {
		result, err := tx.Exec(`UPDATE pi_package_artifacts SET lease_count=lease_count-1 WHERE id=? AND lease_count>0`, artifactID)
		if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
			return err
		}
	}
	result, err := tx.Exec(`UPDATE pi_package_jobs SET leases_released=1 WHERE operation_id=? AND leases_released=0`, job.OperationID)
	return changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB"))
}
func BumpPackageWorker(tx *sql.Tx, id string, expected int64, now string) (PackageJob, error) {
	job, err := ReadPackageJob(tx, id)
	if err != nil {
		return job, err
	}
	if job.WorkerEpoch != expected || (!livePackagePhase(job.Phase) && job.Phase != "cleanup-pending") || !validBudget(expected+1) {
		return job, repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	result, err := tx.Exec(`UPDATE pi_package_jobs SET worker_epoch=worker_epoch+1,updated_at=? WHERE operation_id=? AND worker_epoch=?`, now, id, expected)
	if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
		return job, err
	}
	return ReadPackageJob(tx, id)
}
func CommitPackageJob(tx *sql.Tx, id string, epoch int64, now, resultJSON string, helperAbsenceConfirmed bool, publish func(*sql.Tx, PackageJob) error) error {
	job, err := ReadPackageJob(tx, id)
	if err != nil {
		return err
	}
	if job.WorkerEpoch != epoch || job.Phase != "publish" || job.LeasesReleased {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if !helperAbsenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	operation, err := readOperation(tx, id)
	if err != nil {
		return err
	}
	current, err := fenceCurrent(tx, operation)
	if err != nil {
		return err
	}
	if !current {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if job.WorkID != nil {
		if err := AssertWorkMutable(tx, *job.WorkID); err != nil {
			return err
		}
	}
	if publish != nil {
		if err := publish(tx, job); err != nil {
			return err
		}
	}
	result, err := tx.Exec(`UPDATE operations SET state='succeeded',result_json=?,error_json=NULL,updated_at=? WHERE id=? AND state IN ('pending','running')`, resultJSON, now, id)
	if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE pi_package_jobs SET phase='succeeded',updated_at=?,helper_id=NULL WHERE operation_id=?`, now, id); err != nil {
		return err
	}
	return releasePackageLeases(tx, job)
}
func FinishPackageJob(tx *sql.Tx, id string, epoch int64, phase, now, errorJSON string, cleanupError *string, helperAbsenceConfirmed bool) error {
	job, err := ReadPackageJob(tx, id)
	if err != nil {
		return err
	}
	if job.WorkerEpoch != epoch || (!livePackagePhase(job.Phase) && job.Phase != "cleanup-pending") {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if phase != "failed" && phase != "superseded" && phase != "cleanup-pending" {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if phase != "cleanup-pending" && !helperAbsenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	operationState := phase
	if phase == "cleanup-pending" {
		operationState = "running"
	}
	operation, err := readOperation(tx, id)
	if err != nil {
		return err
	}
	var errorValue any = errorJSON
	if operation.State == "superseded" {
		if phase != "superseded" && phase != "cleanup-pending" {
			return repositoryFailure("PI_PACKAGE_STALE_JOB")
		}
		operationState = "superseded"
		errorValue = nil
	}
	result, err := tx.Exec(`UPDATE operations SET state=?,error_json=?,updated_at=? WHERE id=? AND state IN ('pending','running','superseded')`, operationState, errorValue, now, id)
	if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE pi_package_jobs SET phase=?,cleanup_error=?,updated_at=? WHERE operation_id=?`, phase, cleanupError, now, id); err != nil {
		return err
	}
	if phase != "cleanup-pending" {
		return releasePackageLeases(tx, job)
	}
	return nil
}
func ReleaseTerminalPackageLeases(tx *sql.Tx, id string, helperAbsenceConfirmed bool) error {
	job, err := ReadPackageJob(tx, id)
	if err != nil {
		return err
	}
	if job.Phase != "succeeded" && job.Phase != "failed" && job.Phase != "superseded" {
		return repositoryFailure("PI_PACKAGE_STALE_JOB")
	}
	if !helperAbsenceConfirmed {
		return ErrReleaseUnconfirmed
	}
	return releasePackageLeases(tx, job)
}
func ReleaseQueuedWorkPackageLeases(tx *sql.Tx, workID string) error {
	jobs, err := PackageJobs(tx, true)
	if err != nil {
		return err
	}
	for _, job := range jobs {
		if job.WorkID != nil && *job.WorkID == workID && job.Phase == "queued" {
			if err := releasePackageLeases(tx, job); err != nil {
				return err
			}
		}
	}
	return nil
}
func LeaseCatalogPackages(tx *sql.Tx, names []string) ([]PackageArtifact, error) {
	out := []PackageArtifact{}
	for _, name := range names {
		var id string
		err := tx.QueryRow(`SELECT head_artifact_id FROM pi_package_catalog WHERE name=? AND enabled=1`, name).Scan(&id)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return nil, repositoryFailure("PI_PACKAGE_NOT_FOUND")
			}
			return nil, err
		}
		artifact, err := ReadPackageArtifact(tx, id)
		if err != nil {
			return nil, err
		}
		if artifact.ScopeKind != "core" || artifact.Name != name {
			return nil, repositoryFailure("PI_PACKAGE_NOT_FOUND")
		}
		result, err := tx.Exec(`UPDATE pi_package_artifacts SET lease_count=lease_count+1 WHERE id=? AND lease_count<?`, id, contracts.MaxSafeInteger)
		if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
			return nil, err
		}
		artifact.LeaseCount++
		out = append(out, artifact)
	}
	return out, nil
}

// Work creation temporarily leases captured catalog heads while copying the
// bytes. The private capture record makes those leases recoverable after a
// crash without resetting leases owned by accepted package jobs.
func LeaseContextPackages(tx *sql.Tx, key string, names []string, now string) ([]PackageArtifact, error) {
	if !controlKey.MatchString(key) || !strings.HasPrefix(key, "package_context_lease_") {
		return nil, ErrStorage
	}
	artifacts, err := LeaseCatalogPackages(tx, names)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(artifacts))
	for _, artifact := range artifacts {
		ids = append(ids, artifact.ID)
	}
	raw, _ := json.Marshal(ids)
	_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)`, key, string(raw), now)
	return artifacts, err
}

func ReleaseContextPackageLeases(tx *sql.Tx, key string) error {
	var raw string
	if err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key=?`, key).Scan(&raw); err != nil {
		return notFound(err)
	}
	var ids []string
	if err := json.Unmarshal([]byte(raw), &ids); err != nil || ids == nil {
		return ErrStorage
	}
	if err := ReleaseArtifactLeases(tx, ids); err != nil {
		return err
	}
	_, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, key)
	return err
}

// Called only before admission, under the installation OS lock: interrupted
// context publishers no longer exist, whereas package-job leases remain live.
func RecoverContextPackageLeases(tx *sql.Tx) error {
	rows, err := tx.Query(`SELECT key FROM control_metadata WHERE key GLOB 'package_context_lease_*' ORDER BY key`)
	if err != nil {
		return err
	}
	keys := []string{}
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			rows.Close()
			return err
		}
		keys = append(keys, key)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, key := range keys {
		if err := ReleaseContextPackageLeases(tx, key); err != nil {
			return err
		}
	}
	return nil
}

func ReleaseArtifactLeases(tx *sql.Tx, ids []string) error {
	for _, id := range ids {
		result, err := tx.Exec(`UPDATE pi_package_artifacts SET lease_count=lease_count-1 WHERE id=? AND lease_count>0`, id)
		if err = changed(result, err, repositoryFailure("PI_PACKAGE_STALE_JOB")); err != nil {
			return err
		}
	}
	return nil
}
func ExpirePackageUploads(tx *sql.Tx, now string) ([]string, error) {
	rows, err := tx.Query(`SELECT id FROM pi_package_uploads WHERE state='ready' AND expires_at<=? AND lease_count=0`, now)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for _, id := range ids {
		if _, err := tx.Exec(`UPDATE pi_package_uploads SET state='expired' WHERE id=? AND lease_count=0`, id); err != nil {
			return nil, err
		}
	}
	return ids, nil
}
func CollectiblePackageArtifacts(tx *sql.Tx, cutoff string) ([]PackageArtifact, error) {
	rows, err := tx.Query(`SELECT id FROM pi_package_artifacts WHERE scope_kind='core' AND created_at<=? AND lease_count=0 AND id NOT IN (SELECT head_artifact_id FROM pi_package_catalog)`, cutoff)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	out := []PackageArtifact{}
	for _, id := range ids {
		v, err := ReadPackageArtifact(tx, id)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}
