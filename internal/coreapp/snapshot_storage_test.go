package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestSnapshotVolumeClosureRejectsExtraRetainedVolumesAndUnknownConsumers(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "snapshot-storage-fixture")
	if err != nil {
		t.Fatal(err)
	}
	work := corestore.WorkRecord{ID: "work-snapshot-storage-fixture", OwnerUserID: owner.User.ID, Name: "storage closure", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, work); err != nil {
			return err
		}
		for role, logical := range map[string]string{"agent-private": "work-private", "workspace": "work-workspace"} {
			id := "volume-snapshot-" + role
			_, err := tx.Exec(`INSERT INTO volume_records(id,installation_id,work_id,volume_role,runtime_name,state,reference_count,created_at) VALUES(?,?,?,?,?,'active',1,?)`, id, a.Store.InstallationID(), work.ID, role, dockerengine.ManagedVolumeName(a.Store.InstallationID(), work.ID, logical), packageNow())
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES(?,'work',?,?)`, id, work.ID, packageNow()); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	collect := func() error {
		return a.Store.Read(ctx, func(tx *sql.Tx) error {
			result := snapshotMetadata{Work: work}
			return a.collectSnapshotVolumes(tx, &result, map[string]string{})
		})
	}
	if err := collect(); err != nil {
		t.Fatal("valid two-volume closure rejected", err)
	}
	for _, scenario := range []string{"extra-retained-volume", "unknown-service-consumer"} {
		t.Run(scenario, func(t *testing.T) {
			// Only the fixture creates and later removes these registry entries.
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				if scenario == "extra-retained-volume" {
					_, err := tx.Exec(`INSERT INTO volume_records(id,installation_id,work_id,volume_role,runtime_name,state,reference_count,created_at) VALUES('volume-snapshot-extra',?,?,'service-data','snapshot-retained-fixture','retained',1,?)`, a.Store.InstallationID(), work.ID, packageNow())
					return err
				}
				if _, err := tx.Exec(`INSERT INTO volume_references(volume_id,consumer_kind,consumer_id,created_at) VALUES('volume-snapshot-workspace','service','service-unmapped-fixture',?)`, packageNow()); err != nil {
					return err
				}
				_, err := tx.Exec(`UPDATE volume_records SET reference_count=reference_count+1 WHERE id='volume-snapshot-workspace'`)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			registry := func() string {
				t.Helper()
				var records []string
				if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
					rows, err := tx.Query(`SELECT id,runtime_name,reference_count FROM volume_records WHERE work_id=? ORDER BY id`, work.ID)
					if err != nil {
						return err
					}
					for rows.Next() {
						var id, runtime string
						var count int
						if err := rows.Scan(&id, &runtime, &count); err != nil {
							rows.Close()
							return err
						}
						raw, _ := json.Marshal([]any{id, runtime, count})
						records = append(records, string(raw))
					}
					if err := rows.Err(); err != nil {
						rows.Close()
						return err
					}
					rows.Close()
					refs, err := tx.Query(`SELECT r.volume_id,r.consumer_kind,r.consumer_id FROM volume_references r JOIN volume_records v ON v.id=r.volume_id WHERE v.work_id=? ORDER BY r.volume_id,r.consumer_kind,r.consumer_id`, work.ID)
					if err != nil {
						return err
					}
					defer refs.Close()
					for refs.Next() {
						var volume, kind, consumer string
						if err := refs.Scan(&volume, &kind, &consumer); err != nil {
							return err
						}
						raw, _ := json.Marshal([]string{volume, kind, consumer})
						records = append(records, string(raw))
					}
					return refs.Err()
				}); err != nil {
					t.Fatal(err)
				}
				return string(snapshotRaw(records))
			}
			before := registry()
			err := collect()
			_, diagnostic := contracts.ProjectError(err)
			if err == nil || diagnostic.Code != "SNAPSHOT_STORAGE_UNSUPPORTED" || registry() != before {
				t.Fatal("unsupported closure omitted or modified", diagnostic)
			}
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				if scenario == "extra-retained-volume" {
					_, err := tx.Exec(`DELETE FROM volume_records WHERE id='volume-snapshot-extra'`)
					return err
				}
				if _, err := tx.Exec(`DELETE FROM volume_references WHERE consumer_id='service-unmapped-fixture'`); err != nil {
					return err
				}
				_, err := tx.Exec(`UPDATE volume_records SET reference_count=reference_count-1 WHERE id='volume-snapshot-workspace'`)
				return err
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
