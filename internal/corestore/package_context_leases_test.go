package corestore

import (
	"context"
	"database/sql"
	"testing"
)

func TestContextCaptureRecoveryReleasesOnlyItsOwnArtifactLease(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := InsertPackageArtifact(tx, PackageArtifact{ID: "leased-core", ScopeKind: "core", Name: "tools", ContentDigest: "digest", MetadataJSON: `{"preparedEnvironment":` + packageEnvironment + `}`, StoragePath: "pi-packages/artifacts/fixture", CreatedAt: journalNow}); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES('tools',1,'leased-core',1,?,?)`, journalNow, journalNow)
		return err
	}, nil)
	jobID := acceptJournalOperation(t, s, "captured-package", func(tx *sql.Tx, id string) error {
		job := packageFixture(id)
		job.SourceJSON = `{"kind":"core","name":"tools"}`
		_, err := InsertPackageJob(tx, job)
		return err
	})
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := LeaseContextPackages(tx, "package_context_lease_fixture", []string{"tools"}, journalNow)
		return err
	}, nil)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	for i := 0; i < 2; i++ {
		writeQuota(t, s, RecoverContextPackageLeases, nil)
	}
	if err := s.Read(context.Background(), func(tx *sql.Tx) error {
		artifact, err := ReadPackageArtifact(tx, "leased-core")
		if err != nil {
			return err
		}
		if artifact.LeaseCount != 1 {
			t.Fatal("accepted job lease reset", artifact.LeaseCount)
		}
		job, err := ReadPackageJob(tx, jobID)
		if err != nil {
			return err
		}
		if job.LeasesReleased {
			t.Fatal("accepted job released")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		return FinishPackageJob(tx, jobID, 1, "failed", journalLater, `{"code":"PI_PACKAGE_INTERRUPTED"}`, nil, true)
	}, nil)
	if err := s.Read(context.Background(), func(tx *sql.Tx) error {
		artifact, err := ReadPackageArtifact(tx, "leased-core")
		if artifact.LeaseCount != 0 {
			t.Fatal("terminal job leaked", artifact.LeaseCount)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}
