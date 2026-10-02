package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/corestore"
)

func TestPackageArtifactGarbagePreservesReferencesLeasesAndGrace(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	now := time.Now().UTC()
	old := now.Add(-25 * time.Hour)
	names := map[string]string{"old-head": strings.Repeat("a", 64), "old-unreferenced": strings.Repeat("b", 64), "old-leased": strings.Repeat("c", 64), "old-shared": strings.Repeat("d", 64), "recent-orphan": strings.Repeat("e", 64), "old-orphan": strings.Repeat("f", 64), "old-stage": ".package-stage-" + strings.Repeat("a", 32), "unknown": "operator-kept"}
	for _, name := range names {
		root, err := a.Store.OpenPackageArea("artifacts")
		if err != nil {
			t.Fatal(err)
		}
		child, err := root.OpenDirectory(name)
		root.Close()
		if err != nil {
			t.Fatal(err)
		}
		child.Close()
		path := filepath.Join(a.options.DataDirectory, "pi-packages", "artifacts", name)
		if name != names["recent-orphan"] {
			if err := os.Chtimes(path, old, old); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		for _, id := range []string{"old-head", "old-unreferenced", "old-leased", "old-shared", "current-shared"} {
			name := names[id]
			created := old.Format(time.RFC3339Nano)
			if id == "current-shared" {
				name = names["old-shared"]
				created = now.Format(time.RFC3339Nano)
			}
			if err := corestore.InsertPackageArtifact(tx, corestore.PackageArtifact{ID: id, ScopeKind: "core", Name: id, ContentDigest: "sha256:" + name, MetadataJSON: `{}`, StoragePath: filepath.Join("pi-packages", "artifacts", name), CreatedAt: created}); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE pi_package_artifacts SET lease_count=1 WHERE id='old-leased'`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO pi_package_catalog(name,enabled,head_artifact_id,generation,created_at,updated_at) VALUES('old-head',1,'old-head',1,?,?),('shared',1,'current-shared',1,?,?)`, packageNow(), packageNow(), packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.collectPackageArtifactGarbage(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if err := a.collectPackageArtifactGarbage(context.Background(), now); err != nil {
		t.Fatal("repeated collection", err)
	}
	for kind, name := range names {
		_, err := os.Lstat(filepath.Join(a.options.DataDirectory, "pi-packages", "artifacts", name))
		removed := kind == "old-unreferenced" || kind == "old-orphan" || kind == "old-stage"
		if (os.IsNotExist(err)) != removed {
			t.Fatal("wrong collection", kind, err)
		}
	}
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM pi_package_artifacts`).Scan(&count); err != nil {
			return err
		}
		if count != 3 {
			t.Fatal("shared/leased artifact records retired incorrectly", count)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPackageUploadExpiryRetainsLeasedContent(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	now := time.Now().UTC()
	old := now.Add(-time.Hour).Format(time.RFC3339Nano)
	ids := []string{"upload-11111111-1111-1111-1111-111111111111", "upload-22222222-2222-2222-2222-222222222222"}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		for _, id := range ids {
			digest := "sha256:" + strings.Repeat("a", 64)
			if err := corestore.InsertPackageUpload(tx, corestore.PackageUpload{ID: id, ActorID: "operator", ScopeKind: "core", SourceKind: "zip", DisplayName: "fixture.zip", Digest: &digest, Size: 3, State: "ready", ExpiresAt: &old, CreatedAt: old}); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`UPDATE pi_package_uploads SET lease_count=1 WHERE id=?`, ids[1])
		return err
	}); err != nil {
		t.Fatal(err)
	}
	root, err := a.Store.OpenPackageUploadsRoot()
	if err != nil {
		t.Fatal(err)
	}
	for i, id := range ids {
		if err := root.AtomicWrite(id+".zip", "publish-"+strings.Repeat(string(rune('a'+i)), 32)+".tmp", []byte("zip")); err != nil {
			t.Fatal(err)
		}
	}
	root.Close()
	if err := a.collectExpiredPackageUploads(context.Background(), now); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "pi-packages", "uploads", ids[0]+".zip")); !os.IsNotExist(err) {
		t.Fatal("expired upload kept", err)
	}
	if _, err := os.Stat(filepath.Join(a.options.DataDirectory, "pi-packages", "uploads", ids[1]+".zip")); err != nil {
		t.Fatal("leased content removed", err)
	}
}

func TestPackageJobGarbageRetainsCleanupOwnershipAndRecentOrphans(t *testing.T) {
	a, _, _ := appFixture(t, Options{})
	ctx := context.Background()
	now := time.Now().UTC()
	old := now.Add(-25 * time.Hour)
	terminal := "operation-" + strings.Repeat("1", 32)
	cleanup := "operation-" + strings.Repeat("2", 32)
	recent := "operation-" + strings.Repeat("3", 32)
	orphan := "operation-" + strings.Repeat("4", 32)
	unknown := "operator-kept"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, id := range []string{terminal, cleanup} {
			if _, err := tx.Exec(`INSERT INTO operations(id,kind,state,target_version,request_json,created_at,updated_at) VALUES(?,'pi-package-install','failed',1,'{"fence":{"scope":"none"}}',?,?)`, id, packageNow(), packageNow()); err != nil {
				return err
			}
			_, err := corestore.InsertPackageJob(tx, corestore.PackageJob{OperationID: id, ScopeKind: "core", ActorID: "operator", Kind: "install", PrepareImageID: "sha256:prepare", TrustedHelperImageID: "sha256:helper", PreparedEnvironmentJSON: `{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"}`, SourceJSON: `{"kind":"npm","spec":"npm:fixture@1"}`, RequestDigest: strings.Repeat("a", 64), Phase: "queued", WorkerEpoch: 1, DeadlineAt: now.Add(time.Hour).Format(time.RFC3339Nano), CreatedAt: packageNow(), UpdatedAt: packageNow()})
			if err != nil {
				return err
			}
			if id == terminal {
				if _, err := tx.Exec(`UPDATE pi_package_jobs SET phase='failed',leases_released=1 WHERE operation_id=?`, id); err != nil {
					return err
				}
			} else {
				if _, err := tx.Exec(`UPDATE pi_package_jobs SET phase='cleanup-pending' WHERE operation_id=?`, id); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{terminal, cleanup, recent, orphan, unknown} {
		root, err := a.Store.OpenPackageArea("jobs")
		if err != nil {
			t.Fatal(err)
		}
		child, err := root.OpenDirectory(id)
		root.Close()
		if err != nil {
			t.Fatal(err)
		}
		child.Close()
		if id != recent {
			if err := os.Chtimes(filepath.Join(a.options.DataDirectory, "pi-packages", "jobs", id), old, old); err != nil {
				t.Fatal(err)
			}
		}
	}
	for i := 0; i < 2; i++ {
		if err := a.collectPackageJobGarbage(ctx, now); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{terminal, cleanup, recent, orphan, unknown} {
		_, err := os.Lstat(filepath.Join(a.options.DataDirectory, "pi-packages", "jobs", id))
		removed := id == terminal || id == orphan
		if os.IsNotExist(err) != removed {
			t.Fatal("wrong job garbage decision", id, err)
		}
	}
}
