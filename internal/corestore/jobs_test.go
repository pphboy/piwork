package corestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"
)

const journalNow = "2026-09-30T00:00:00.000Z"
const journalLater = "2026-09-30T01:00:00.000Z"
const journalOwner = "user-mutation-00000001"

func seedFileWork(t *testing.T, s *Store) int64 {
	t.Helper()
	seedMutationWork(t, s)
	var epoch int64
	writeQuota(t, s, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, mutationWorkID); err != nil {
			return err
		}
		if err := InsertLoginSession(tx, LoginSessionRecord{ID: "file-session", UserID: journalOwner, TokenDigest: "private-hash", ExpiresAt: "2026-10-30T00:00:00.000Z", CreatedAt: journalNow}); err != nil {
			return err
		}
		var err error
		epoch, err = NextFileCoreEpoch(tx)
		return err
	}, nil)
	return epoch
}
func fileFixture(id, kind string, epoch int64) FileJob {
	return FileJob{ID: id, WorkID: mutationWorkID, OwnerUserID: journalOwner, SessionID: "file-session", CoreEpoch: epoch, RuntimeGeneration: 1, Kind: kind, State: "accepted", TrustedImageID: "sha256:trusted", VolumeName: "persistent-workspace", PathSegmentsJSON: `["中文.txt"]`, AcceptedAt: journalNow, DeadlineAt: journalLater, UpdatedAt: journalNow}
}
func acceptFile(t *testing.T, s *Store, v FileJob, attempt *FileAttempt) FileJob {
	t.Helper()
	var accepted FileJob
	writeQuota(t, s, func(tx *sql.Tx) error { var err error; accepted, err = AcceptFileJob(tx, v, attempt); return err }, nil)
	return accepted
}
func TestFileJournalReopenEpochCommitAndCleanup(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	epoch := seedFileWork(t, s)
	attempt := FileAttempt{ID: "attempt-1", JobID: "upload-1", Kind: "request", Epoch: 1, ContainerName: "owned-helper", State: "planned", CreatedAt: journalNow, UpdatedAt: journalNow}
	job := acceptFile(t, s, fileFixture("upload-1", "PUT", epoch), &attempt)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return InsertFileTemporary(tx, FileTemporary{ID: "temporary-1", JobID: job.ID, ParentSegmentsJSON: `[]`, Name: ".owned-temp", State: "planned", CreatedAt: journalNow, UpdatedAt: journalNow})
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return ConfirmFileTemporary(tx, "temporary-1", job.ID, "9", "81", journalNow) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return UpdateFileAttempt(tx, attempt.ID, "planned", "creating", journalNow, nil)
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return UpdateFileAttempt(tx, attempt.ID, "creating", "running", journalNow, pointer("container-1"))
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateFileJobState(tx, job.ID, "accepted", "running", journalNow, nil) }, nil)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	if err := s.Read(context.Background(), func(tx *sql.Tx) error {
		actual, err := ReadFileJob(tx, job.ID)
		if err != nil {
			return err
		}
		if actual.OwnerUserID != journalOwner || actual.SessionID != "file-session" || actual.CoreEpoch != epoch || actual.WorkEpoch != job.WorkEpoch || actual.PathSegmentsJSON != job.PathSegmentsJSON {
			t.Fatal(actual)
		}
		attempts, err := FileAttempts(tx, job.ID)
		if err != nil {
			return err
		}
		temps, err := FileTemporaries(tx, job.ID)
		if err != nil {
			return err
		}
		if len(attempts) != 1 || attempts[0].ContainerID == nil || *attempts[0].ContainerID != "container-1" || len(temps) != 1 || *temps[0].Inode != "81" {
			t.Fatal(attempts, temps)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error { return MarkFileCleaned(tx, job.ID, journalNow) }, repositoryFailure("FILE_CLEANUP_REQUIRED"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := AcceptFileJob(tx, fileFixture("upload-2", "PUT", epoch), nil)
		return err
	}, repositoryFailure("FILE_ACCESS_BUSY"))
	writeQuota(t, s, func(tx *sql.Tx) error { _, err := NextFileCoreEpoch(tx); return err }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AuthorizeFileCommit(tx, job.ID, job.WorkEpoch, journalNow) }, repositoryFailure("FILE_CONFLICT"))
	writeQuota(t, s, func(tx *sql.Tx) error { _, err := CloseFileGate(tx, mutationWorkID, journalNow); return err }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { _, err := OpenFileGate(tx, mutationWorkID, journalNow); return err }, repositoryFailure("FILE_CLEANUP_REQUIRED"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		return UpdateFileJobState(tx, job.ID, "running", "cleanup-pending", journalNow, nil)
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return UpdateFileJobState(tx, job.ID, "cleanup-pending", "running", journalNow, nil)
	}, repositoryFailure("FILE_CONFLICT"))
	writeQuota(t, s, func(tx *sql.Tx) error { return ConfirmFileAttemptRemoved(tx, attempt.ID, "running", journalNow, false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error { return ConfirmFileAttemptRemoved(tx, attempt.ID, "running", journalNow, true) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return MarkFileCleaned(tx, job.ID, journalNow) }, repositoryFailure("FILE_CLEANUP_REQUIRED"))
	writeQuota(t, s, func(tx *sql.Tx) error { return MarkFileTemporary(tx, "temporary-1", job.ID, "cleaned", journalNow) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return MarkFileCleaned(tx, job.ID, journalNow) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateFileJobState(tx, job.ID, "cleaned", "running", journalNow, nil) }, repositoryFailure("FILE_CONFLICT"))
	writeQuota(t, s, func(tx *sql.Tx) error { _, err := OpenFileGate(tx, mutationWorkID, journalNow); return err }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		n, err := CollectCleanedFiles(tx, journalLater)
		if n != 0 {
			t.Fatal(n)
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		n, err := CollectCleanedFiles(tx, "2026-10-02T00:00:00.000Z")
		if n != 1 {
			t.Fatal(n)
		}
		return err
	}, nil)
}
func TestFileJournalSessionCommitPermissionLimitsAndRetries(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	epoch := seedFileWork(t, s)
	job := acceptFile(t, s, fileFixture("write", "PUT", epoch), nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateFileJobState(tx, job.ID, "accepted", "prepared", journalNow, nil) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE login_sessions SET revoked_at=? WHERE id='file-session'`, journalNow)
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AuthorizeFileCommit(tx, job.ID, job.WorkEpoch, journalNow) }, repositoryFailure("AUTH_REQUIRED"))
	writeQuota(t, s, func(tx *sql.Tx) error { _, err := tx.Exec(`UPDATE login_sessions SET revoked_at=NULL`); return err }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AuthorizeFileCommit(tx, job.ID, job.WorkEpoch, journalNow) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AuthorizeFileCommit(tx, job.ID, job.WorkEpoch, journalNow) }, repositoryFailure("FILE_CONFLICT"))
	for i := 0; i < 3; i++ {
		acceptFile(t, s, fileFixture(fmt.Sprintf("read-%d", i), "GET", epoch), nil)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := AcceptFileJob(tx, fileFixture("read-4", "GET", epoch), nil)
		return err
	}, repositoryFailure("FILE_ACCESS_BUSY"))
	for i := 0; i < 4; i++ {
		writeQuota(t, s, func(tx *sql.Tx) error {
			ok, err := ReserveFileCleanupRetry(tx, job.ID, journalNow, false)
			if ok != (i < 3) {
				t.Fatalf("retry %d: %v", i, ok)
			}
			return err
		}, nil)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		ok, err := ReserveFileCleanupRetry(tx, job.ID, journalNow, true)
		if !ok {
			t.Fatal("explicit retry rejected")
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		ok, err := ReserveFileCleanupRetry(tx, job.ID, journalLater, false)
		if !ok {
			t.Fatal("new window rejected")
		}
		return err
	}, nil)
}
func snapshotFixture(id, kind string) SnapshotJob {
	v := SnapshotJob{OperationID: id, OwnerUserID: journalOwner, Kind: kind, RequestDigest: strings.Repeat("a", 64), Phase: "accepted", WorkerEpoch: 1, CreatedAt: journalNow, UpdatedAt: journalNow, DeadlineAt: journalLater}
	if kind == "export" {
		v.SourceWorkID = pointer(mutationWorkID)
		v.SnapshotID = pointer("snapshot-" + id)
	}
	return v
}
func acceptJournalOperation(t *testing.T, s *Store, key string, effect func(*sql.Tx, string) error) string {
	t.Helper()
	accepted, err := s.AcceptMutation(context.Background(), MutationRequest{PrincipalID: journalOwner, WorkScope: mutationWorkID, Kind: key, IdempotencyKey: key, RequestJSON: `{}`, TargetVersion: 1}, func(tx *sql.Tx, id string) (MutationEffect, error) {
		return MutationEffect{ResourceID: mutationWorkID}, effect(tx, id)
	})
	if err != nil {
		t.Fatal(err)
	}
	return accepted.OperationID
}
func TestSnapshotJournalLockFenceAndQuotaMutation(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	release, err := s.BeginTransientMutation(context.Background(), mutationWorkID)
	if err != nil {
		t.Fatal(err)
	}
	id := acceptJournalOperation(t, s, "export-work", func(tx *sql.Tx, id string) error { return InsertSnapshotJob(tx, snapshotFixture(id, "export")) })
	writeQuota(t, s, func(tx *sql.Tx) error { return s.LockSnapshotWork(tx, SnapshotLock{mutationWorkID, id, 1}) }, repositoryFailure("WORK_BUSY"))
	release()
	release()
	writeQuota(t, s, func(tx *sql.Tx) error { return s.LockSnapshotWork(tx, SnapshotLock{mutationWorkID, id, 1}) }, nil)
	if _, err := s.BeginTransientMutation(context.Background(), mutationWorkID); !errors.Is(err, ErrSnapshotBusy) {
		t.Fatal(err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		return ReserveQuota(tx, QuotaReservation{WorkID: mutationWorkID, SubjectKind: "agent", SubjectID: "agent"}, QuotaLimits{}, QuotaLimits{})
	}, ErrSnapshotBusy)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return RegisterVolume(tx, VolumeRecord{ID: "no-create", WorkID: mutationWorkID}, nil, nil)
	}, ErrSnapshotBusy)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return InsertSnapshotArtifact(tx, SnapshotArtifact{id, "helper", "container", "owned-helper", "planned"}, 1)
	}, nil)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	writeQuota(t, s, func(tx *sql.Tx) error { return AssertWorkMutable(tx, mutationWorkID) }, ErrSnapshotBusy)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return InsertSnapshotJob(tx, snapshotFixture("unpublished-operation", "import"))
	}, repositoryFailure("SNAPSHOT_CAPACITY_BUSY"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		job, err := FenceSnapshotWorker(tx, id, journalNow)
		if err != nil {
			return err
		}
		if job.WorkerEpoch != 2 || job.Phase != "cleanup-pending" {
			t.Fatal(job)
		}
		return nil
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateSnapshotArtifact(tx, id, 1, "helper", "created") }, repositoryFailure("SNAPSHOT_WORKER_FENCED"))
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateSnapshotPhase(tx, id, 2, "capturing", journalNow, nil) }, repositoryFailure("SNAPSHOT_WORKER_FENCED"))
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseSnapshotReservations(tx, id, 2, false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateSnapshotPhase(tx, id, 2, "cleaned", journalNow, nil) }, repositoryFailure("SNAPSHOT_RECORD_CONFLICT"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := UpdateSnapshotArtifact(tx, id, 2, "helper", "cleaned"); err != nil {
			return err
		}
		if err := ReleaseSnapshotReservations(tx, id, 2, true); err != nil {
			return err
		}
		return UpdateSnapshotPhase(tx, id, 2, "cleaned", journalNow, nil)
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AssertWorkMutable(tx, mutationWorkID) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateSnapshotPhase(tx, id, 2, "capturing", journalNow, nil) }, repositoryFailure("SNAPSHOT_WORKER_FENCED"))
}

func TestFileAndSnapshotAdmissionExcludeEachOtherUntilConfirmedCleanup(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	epoch := seedFileWork(t, s)
	job := acceptFile(t, s, fileFixture("file-before-snapshot", "PUT", epoch), nil)
	operation := acceptJournalOperation(t, s, "export-work", func(tx *sql.Tx, id string) error { return InsertSnapshotJob(tx, snapshotFixture(id, "export")) })
	lock := SnapshotLock{mutationWorkID, operation, 1}
	writeQuota(t, s, func(tx *sql.Tx) error { return s.LockSnapshotWork(tx, lock) }, repositoryFailure("WORK_BUSY"))
	writeQuota(t, s, func(tx *sql.Tx) error { return MarkFileCleaned(tx, job.ID, journalNow) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return s.LockSnapshotWork(tx, lock) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := AcceptFileJob(tx, fileFixture("file-during-snapshot", "PUT", epoch), nil)
		return err
	}, ErrSnapshotBusy)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseSnapshotReservations(tx, operation, 1, false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := AcceptFileJob(tx, fileFixture("file-still-blocked", "PUT", epoch), nil)
		return err
	}, ErrSnapshotBusy)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseSnapshotReservations(tx, operation, 1, true) }, nil)
	acceptFile(t, s, fileFixture("file-after-snapshot", "PUT", epoch), nil)
}
func TestSnapshotPackageTransferAndImportReservationsPreventCollection(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	pack := SnapshotPackage{ID: "pack-1", OwnerUserID: journalOwner, State: "staging", CreatedAt: journalNow}
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := InsertSnapshotPackage(tx, pack); err != nil {
			return err
		}
		return SealSnapshotPackage(tx, pack.ID, strings.Repeat("b", 64), 41, journalNow, journalLater)
	}, nil)
	id := acceptJournalOperation(t, s, "import-work", func(tx *sql.Tx, id string) error {
		job := snapshotFixture(id, "import")
		job.PackageID = pointer(pack.ID)
		if err := InsertSnapshotJob(tx, job); err != nil {
			return err
		}
		return ReserveImportName(tx, journalOwner, "新项目", id)
	})
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	writeQuota(t, s, func(tx *sql.Tx) error { return CheckWorkQuota(tx, pointer(int64(2)), 1) }, ErrQuotaExceeded)
	writeQuota(t, s, func(tx *sql.Tx) error {
		changed, err := ExpireSnapshotPackage(tx, pack.ID, "2026-10-01T00:00:00.000Z")
		if changed {
			t.Fatal("active import package expired")
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveImportName(tx, journalOwner, "新项目", id) }, repositoryFailure("WORK_NAME_CONFLICT"))
	for i := 0; i < 2; i++ {
		transfer := SnapshotTransfer{ID: fmt.Sprintf("transfer-%d", i), OwnerUserID: journalOwner, PackageID: pointer(pack.ID), Kind: "download", Phase: "accepted", CreatedAt: journalNow, DeadlineAt: journalLater, LastProgressAt: journalNow}
		writeQuota(t, s, func(tx *sql.Tx) error { return AcceptSnapshotTransfer(tx, transfer, nil) }, nil)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		return AcceptSnapshotTransfer(tx, SnapshotTransfer{ID: "overflow", OwnerUserID: journalOwner}, nil)
	}, repositoryFailure("SNAPSHOT_TRANSFER_BUSY"))
	writeQuota(t, s, func(tx *sql.Tx) error { return FinishSnapshotTransfer(tx, "transfer-0", false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error { return FinishSnapshotTransfer(tx, "transfer-0", true) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return UpdateSnapshotTransfer(tx, "transfer-1", "cleanup-pending", journalNow, pointer("slow-helper"))
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return UpdateSnapshotTransfer(tx, "transfer-1", "streaming", journalNow, nil) }, repositoryFailure("SNAPSHOT_RECORD_CONFLICT"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := ReleaseSnapshotReservations(tx, id, 1, true); err != nil {
			return err
		}
		return UpdateSnapshotPhase(tx, id, 1, "cleaned", journalNow, nil)
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		changed, err := MarkSnapshotPackageDeleting(tx, pack.ID)
		if changed {
			t.Fatal("in-use package marked deleting")
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return FinishSnapshotTransfer(tx, "transfer-1", true) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		changed, err := ExpireSnapshotPackage(tx, pack.ID, "2026-10-01T00:00:00.000Z")
		if !changed {
			t.Fatal("unleased package retained")
		}
		return err
	}, nil)
}
func TestStableNetworkIdentityCollisionsAndReopen(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	ids := []string{"work-a1b2c3d4-1111-2222-3333-444444444444", "work-a1b2c3d4-5555-2222-3333-444444444444"}
	writeQuota(t, s, func(tx *sql.Tx) error {
		for i, id := range ids {
			if err := InsertWork(tx, WorkRecord{ID: id, OwnerUserID: journalOwner, Name: fmt.Sprintf("中文项目%d", i), DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1}); err != nil {
				return err
			}
			name, err := AssignWorkNetworkName(tx, id, journalNow)
			if err != nil {
				return err
			}
			expected := []string{"w-a1b2c3d4", "w-a1b2c3d45555"}[i]
			if name != expected {
				t.Fatal(name, expected)
			}
		}
		for _, service := range []string{"one", "two", "中文"} {
			if err := insertQuotaService(tx, service); err != nil {
				return err
			}
			label, err := AssignServiceDomainLabel(tx, mutationWorkID, service, "Notes", journalNow)
			if err != nil {
				return err
			}
			if service == "one" && label != "notes" {
				t.Fatal(label)
			}
			if service != "one" && label == "notes" {
				t.Fatal(label)
			}
		}
		return nil
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := insertQuotaService(tx, "legacy-name"); err != nil {
			return err
		}
		label, err := AssignServiceDomainLabel(tx, mutationWorkID, "legacy-name", "demo-", journalNow)
		if err != nil || !dnsLabel.MatchString(label) || label == "demo-" {
			t.Fatal("invalid legacy name did not get safe label", label, err)
		}
		return err
	}, nil)

	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	writeQuota(t, s, func(tx *sql.Tx) error {
		label, err := AssignServiceDomainLabel(tx, mutationWorkID, "one", "Renamed", journalNow)
		if label != "notes" {
			t.Fatal(label)
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET tombstoned_at=? WHERE service_id='one'`, journalNow)
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		label, err := AssignServiceDomainLabel(tx, mutationWorkID, "two", "notes", journalNow)
		if label == "notes" {
			t.Fatal(label)
		}
		return err
	}, nil)
}
