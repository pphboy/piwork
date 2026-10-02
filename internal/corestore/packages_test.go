package corestore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

const packageEnvironment = `{"os":"linux","architecture":"amd64","variant":"","nodeAbi":"137","piSdkVersion":"0.55.0"}`

func packageFixture(id string) PackageJob {
	return PackageJob{OperationID: id, ScopeKind: "work", WorkID: pointer(mutationWorkID), ActorID: journalOwner, Kind: "install", PrepareImageID: "sha256:prepare", TrustedHelperImageID: "sha256:native-helper", PreparedEnvironmentJSON: packageEnvironment, SourceJSON: `{"kind":"zip"}`, RequestDigest: strings.Repeat("c", 64), Phase: "queued", WorkerEpoch: 1, DeadlineAt: journalLater, CreatedAt: journalNow, UpdatedAt: journalNow}
}
func seedPackageUpload(t *testing.T, s *Store, id string) {
	t.Helper()
	writeQuota(t, s, func(tx *sql.Tx) error {
		return InsertPackageUpload(tx, PackageUpload{ID: id, ActorID: journalOwner, ScopeKind: "work", WorkID: pointer(mutationWorkID), SourceKind: "zip", DisplayName: "source.zip", Digest: pointer(strings.Repeat("d", 64)), Size: 128, State: "ready", ExpiresAt: pointer(journalLater), CreatedAt: journalNow})
	}, nil)
}
func TestPackageUploadLeaseRecoveryFenceAndTerminalImmutability(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	seedPackageUpload(t, s, "source-upload")
	id := acceptJournalOperation(t, s, "pi-package-install", func(tx *sql.Tx, id string) error {
		job := packageFixture(id)
		job.SourceUploadID = pointer("source-upload")
		_, err := InsertPackageJob(tx, job)
		return err
	})
	writeQuota(t, s, func(tx *sql.Tx) error {
		return AdvancePackageJob(tx, id, 1, "prepare", journalNow, nil, pointer("owned-helper"))
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		ids, err := ExpirePackageUploads(tx, "2026-10-01T00:00:00.000Z")
		if len(ids) != 0 {
			t.Fatal(ids)
		}
		return err
	}, nil)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	writeQuota(t, s, func(tx *sql.Tx) error {
		job, err := ReadPackageJob(tx, id)
		if err != nil {
			return err
		}
		upload, err := ReadPackageUpload(tx, "source-upload")
		if err != nil {
			return err
		}
		if job.ActorID != journalOwner || job.WorkID == nil || *job.WorkID != mutationWorkID || job.TrustedHelperImageID != "sha256:native-helper" || job.HelperID == nil || *job.HelperID != "owned-helper" || upload.LeaseCount != 1 {
			t.Fatal(job, upload)
		}
		return nil
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return FinishPackageJob(tx, id, 1, "cleanup-pending", journalNow, `{"code":"DEPENDENCY_UNAVAILABLE"}`, pointer("cleanup incomplete"), false)
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AdvancePackageJob(tx, id, 1, "prepare", journalNow, nil, nil) }, repositoryFailure("PI_PACKAGE_STALE_JOB"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		job := packageFixture("another-operation")
		_, err := InsertPackageJob(tx, job)
		return err
	}, repositoryFailure("PI_PACKAGE_BUSY"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		job, err := BumpPackageWorker(tx, id, 1, journalNow)
		if job.WorkerEpoch != 2 {
			t.Fatal(job)
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return FinishPackageJob(tx, id, 1, "failed", journalNow, `{}`, nil, true) }, repositoryFailure("PI_PACKAGE_STALE_JOB"))
	writeQuota(t, s, func(tx *sql.Tx) error { return FinishPackageJob(tx, id, 2, "failed", journalNow, `{}`, nil, false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseTerminalPackageLeases(tx, id, true) }, repositoryFailure("PI_PACKAGE_STALE_JOB"))
	writeQuota(t, s, func(tx *sql.Tx) error { return FinishPackageJob(tx, id, 2, "failed", journalNow, `{}`, nil, true) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseTerminalPackageLeases(tx, id, true) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		upload, err := ReadPackageUpload(tx, "source-upload")
		if err != nil {
			return err
		}
		if upload.LeaseCount != 0 {
			t.Fatal(upload)
		}
		return nil
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return AdvancePackageJob(tx, id, 2, "source", journalNow, nil, nil) }, repositoryFailure("PI_PACKAGE_STALE_JOB"))
	writeQuota(t, s, func(tx *sql.Tx) error {
		ids, err := ExpirePackageUploads(tx, "2026-10-01T00:00:00.000Z")
		if len(ids) != 1 {
			t.Fatal(ids)
		}
		return err
	}, nil)
}
func TestPackageCoreArtifactCaptureLeaseAndAtomicPublish(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	seedMutationWork(t, s)
	artifact := PackageArtifact{ID: "old-artifact", ScopeKind: "core", Name: "tools", ContentDigest: strings.Repeat("e", 64), MetadataJSON: `{"preparedEnvironment":` + packageEnvironment + `}`, StoragePath: "private/artifacts/old", CreatedAt: journalNow}
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := InsertPackageArtifact(tx, artifact); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES(?,1,?,1,?,?)`, artifact.Name, artifact.ID, journalNow, journalNow)
		return err
	}, nil)
	id := acceptJournalOperation(t, s, "from-core", func(tx *sql.Tx, id string) error {
		job := packageFixture(id)
		job.SourceJSON = `{"kind":"core","name":"tools"}`
		_, err := InsertPackageJob(tx, job)
		return err
	})
	artifact.ID = "new-artifact"
	artifact.StoragePath = "private/artifacts/new"
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := InsertPackageArtifact(tx, artifact); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE pi_package_catalog SET head_artifact_id='new-artifact',generation=2`)
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		job, err := ReadPackageJob(tx, id)
		if err != nil {
			return err
		}
		if !strings.Contains(job.SourceJSON, `"artifactId":"old-artifact"`) {
			t.Fatal(job.SourceJSON)
		}
		garbage, err := CollectiblePackageArtifacts(tx, journalLater)
		if len(garbage) != 0 {
			t.Fatal(garbage)
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return AdvancePackageJob(tx, id, 1, "publish", journalNow, pointer("tools"), nil)
	}, nil)
	rejected := errors.New("injected publication failure")
	writeQuota(t, s, func(tx *sql.Tx) error {
		return CommitPackageJob(tx, id, 1, journalNow, `{}`, true, func(tx *sql.Tx, _ PackageJob) error {
			if _, err := tx.Exec(`UPDATE works SET name='should-roll-back' WHERE id=?`, mutationWorkID); err != nil {
				return err
			}
			return rejected
		})
	}, rejected)
	work, err := s.Work(context.Background(), mutationWorkID, false)
	if err != nil || work.Name == "should-roll-back" {
		t.Fatal(work, err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error { return CommitPackageJob(tx, id, 1, journalNow, `{}`, false, nil) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return CommitPackageJob(tx, id, 1, journalNow, `{"installed":true}`, true, func(tx *sql.Tx, _ PackageJob) error {
			_, err := tx.Exec(`UPDATE works SET name='published' WHERE id=?`, mutationWorkID)
			return err
		})
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		old, err := ReadPackageArtifact(tx, "old-artifact")
		if err != nil {
			return err
		}
		garbage, err := CollectiblePackageArtifacts(tx, journalLater)
		if err != nil {
			return err
		}
		job, err := ReadPackageJob(tx, id)
		if old.LeaseCount != 0 || len(garbage) != 1 || garbage[0].ID != "old-artifact" || !job.LeasesReleased || job.Phase != "succeeded" {
			t.Fatal(old, garbage, job)
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return CommitPackageJob(tx, id, 1, journalNow, `{}`, true, nil) }, repositoryFailure("PI_PACKAGE_STALE_JOB"))
}
func TestPackageAcceptanceRollsBackInvalidUploadAndEnvironment(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	seedMutationWork(t, s)
	seedPackageUpload(t, s, "protected-upload")
	request := MutationRequest{PrincipalID: journalOwner, WorkScope: mutationWorkID, Kind: "pi-package-install", IdempotencyKey: "invalid-upload", RequestJSON: `{}`, TargetVersion: 1}
	_, err := s.AcceptMutation(context.Background(), request, func(tx *sql.Tx, id string) (MutationEffect, error) {
		job := packageFixture(id)
		job.ActorID = "foreign-actor"
		job.SourceUploadID = pointer("protected-upload")
		_, err := InsertPackageJob(tx, job)
		return MutationEffect{ResourceID: mutationWorkID}, err
	})
	if !errors.Is(err, repositoryFailure("PI_PACKAGE_NOT_FOUND")) {
		t.Fatal(err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		jobs, err := PackageJobs(tx, false)
		if err != nil {
			return err
		}
		var operations int
		if err := tx.QueryRow(`SELECT count(*) FROM operations`).Scan(&operations); err != nil {
			return err
		}
		upload, err := ReadPackageUpload(tx, "protected-upload")
		if len(jobs) != 0 || operations != 0 || upload.LeaseCount != 0 {
			t.Fatal(jobs, operations, upload)
		}
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		a := PackageArtifact{ID: "incompatible", ScopeKind: "core", Name: "wrong", ContentDigest: strings.Repeat("f", 64), MetadataJSON: `{"preparedEnvironment":{"os":"windows"}}`, StoragePath: "private/incompatible", CreatedAt: journalNow}
		if err := InsertPackageArtifact(tx, a); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES('wrong',1,'incompatible',1,?,?)`, journalNow, journalNow)
		return err
	}, nil)
	request.IdempotencyKey = "wrong-env"
	_, err = s.AcceptMutation(context.Background(), request, func(tx *sql.Tx, id string) (MutationEffect, error) {
		job := packageFixture(id)
		job.SourceJSON = `{"kind":"core","name":"wrong"}`
		_, err := InsertPackageJob(tx, job)
		return MutationEffect{ResourceID: mutationWorkID}, err
	})
	if !errors.Is(err, repositoryFailure("PI_PACKAGE_ENVIRONMENT_MISMATCH")) {
		t.Fatal(err)
	}
}
