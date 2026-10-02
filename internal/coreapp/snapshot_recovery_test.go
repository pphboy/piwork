package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/workpackage"
)

func TestSnapshotExportRecoveryFencesAndSettlesPublication(t *testing.T) {
	for _, sealed := range []bool{false, true} {
		t.Run(map[bool]string{false: "unsealed", true: "sealed"}[sealed], func(t *testing.T) {
			a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
			ctx := context.Background()
			login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "snapshot-recovery")
			if err != nil {
				t.Fatal(err)
			}
			owner := string(login.User.ID)
			work := "work-recovery-owned"
			pack := "package-recovery-owned"
			snapshot := "snapshot-recovery-owned"
			now := packageNow()
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				return corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: owner, Name: "Recover", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
			}); err != nil {
				t.Fatal(err)
			}
			accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: owner, WorkScope: work, Kind: "export-work", IdempotencyKey: "recovery", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
				if err := corestore.InsertSnapshotPackage(tx, corestore.SnapshotPackage{ID: pack, OwnerUserID: owner, State: "staging", CreatedAt: now}); err != nil {
					return corestore.MutationEffect{}, err
				}
				if err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: owner, Kind: "export", SourceWorkID: &work, SnapshotID: &snapshot, RequestDigest: "recovery", Phase: "accepted", DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
					return corestore.MutationEffect{}, err
				}
				if _, err := tx.Exec(`UPDATE snapshot_jobs SET package_id=? WHERE operation_id=?`, pack, id); err != nil {
					return corestore.MutationEffect{}, err
				}
				if err := a.Store.LockSnapshotWork(tx, corestore.SnapshotLock{WorkID: work, OperationID: id, WorkerEpoch: 1}); err != nil {
					return corestore.MutationEffect{}, err
				}
				return corestore.MutationEffect{ResourceID: snapshot}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			if sealed {
				data, err := os.ReadFile("../workpackage/testdata/golden-native-pi-package.work")
				if err != nil {
					t.Fatal(err)
				}
				verified, err := workpackage.Read(ctx, bytes.NewReader(data), workpackage.ReadOptions{})
				if err != nil {
					t.Fatal(err)
				}
				packages, err := a.Store.OpenSnapshotArea("packages")
				if err != nil {
					t.Fatal(err)
				}
				err = packages.AtomicWrite(pack+".work", "recovery.tmp", data)
				packages.Close()
				if err != nil {
					t.Fatal(err)
				}
				marker := snapshotRaw(map[string]any{"digest": verified.Digest, "size": verified.Size, "readyAt": now, "expiresAt": time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)})
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					return corestore.InsertSnapshotArtifact(tx, corestore.SnapshotArtifact{OperationID: accepted.OperationID, ArtifactKey: "sealed-package", Kind: "sealed-package", LogicalID: string(marker), State: "ready"}, 1)
				}); err != nil {
					t.Fatal(err)
				}
			}
			if err := a.recoverSnapshotJobs(ctx, false); err != nil {
				t.Fatal(err)
			}
			operation, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			expected := "failed"
			phase := "cleaned"
			if sealed {
				expected = "succeeded"
				phase = "succeeded"
			}
			if operation.State != expected {
				t.Fatal("recovery outcome", operation)
			}
			var job corestore.SnapshotJob
			var locked bool
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var err error
				job, err = corestore.ReadSnapshotJob(tx, accepted.OperationID)
				if err != nil {
					return err
				}
				return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM work_snapshot_locks WHERE work_id=?)`, work).Scan(&locked)
			}); err != nil || locked || job.Phase != phase || job.WorkerEpoch != 2 {
				t.Fatal(job, locked, err)
			}
			if err := a.recoverSnapshotJobs(ctx, false); err != nil {
				t.Fatal("second recovery", err)
			}
			again, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil || again.State != expected {
				t.Fatal(again, err)
			}
		})
	}
}
