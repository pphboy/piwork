package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"os"
	"testing"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workpackage"
)

func TestUnpublishedSnapshotImportOperationRemainsOwnerOnly(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "import-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "import-other", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	now, work := packageNow(), "work-unpublished-import"
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: "work-imports", Kind: "import-work", IdempotencyKey: "unpublished-import", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: string(owner.Id), Kind: "import", TargetWorkID: &work, RequestDigest: "seed", Phase: "accepted", DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now})
		return corestore.MutationEffect{ResourceID: work}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	failure := `{"code":"PACKAGE_INVALID","stage":"runtime-prepare"}`
	if _, err := a.Store.CompleteOperation(ctx, accepted.OperationID, "failed", nil, &failure, nil); err != nil {
		t.Fatal(err)
	}
	for _, account := range []string{"import-owner", "import-other", "admin"} {
		login, err := a.Identity.Login(ctx, account, "development-fixture-pass", "snapshot-operation")
		if err != nil {
			t.Fatal(err)
		}
		status, body := httpCall(t, base, "/api/v1/operations/"+accepted.OperationID, "GET", "Bearer "+login.Token, nil)
		want := 404
		if account == "admin" {
			want = 403
		}
		if account == "import-owner" {
			want = 200
			if body["workId"] != work || body["state"] != "failed" || body["error"] == nil {
				t.Fatal(body)
			}
			if err := contracts.Validate("PublicOperationSchema", body); err != nil {
				t.Fatal(err)
			}
		}
		if status != want {
			t.Fatal(account, status, body)
		}
	}
	if _, err := a.Store.Work(ctx, work, true); err != corestore.ErrNotFound {
		t.Fatal("import exposed an unpublished Work", err)
	}
}

func seedReadySnapshot(t *testing.T, a *Application, owner string) (string, string, []byte) {
	t.Helper()
	ctx := context.Background()
	now := packageNow()
	work := "work-snapshot-owner"
	snapshot := "snapshot-owner-content"
	pack := "package-owner-content"
	data, err := os.ReadFile("../workpackage/testdata/golden-native-pi-package.work")
	if err != nil {
		t.Fatal(err)
	}
	verified, err := workpackage.Read(ctx, bytes.NewReader(data), workpackage.ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: owner, Name: "Owned", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: owner, WorkScope: work, Kind: "export-work", IdempotencyKey: "seed-ready", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if err := corestore.InsertSnapshotPackage(tx, corestore.SnapshotPackage{ID: pack, OwnerUserID: owner, State: "staging", CreatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: owner, Kind: "export", SourceWorkID: &work, SnapshotID: &snapshot, RequestDigest: "seed", Phase: "accepted", DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		if _, err := tx.Exec(`UPDATE snapshot_jobs SET package_id=? WHERE operation_id=?`, pack, id); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.SealSnapshotPackage(tx, pack, verified.Digest, verified.Size, now, time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano)); err != nil {
			return corestore.MutationEffect{}, err
		}
		if err := corestore.UpdateSnapshotPhase(tx, id, 1, "succeeded", now, nil); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: snapshot}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	result := `{"correlationId":"` + accepted.OperationID + `","result":{"observedState":"stopped"}}`
	if _, err := a.Store.CompleteOperation(ctx, accepted.OperationID, "succeeded", &result, nil, nil); err != nil {
		t.Fatal(err)
	}
	root, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		t.Fatal(err)
	}
	err = root.AtomicWrite(pack+".work", "snapshot-seed.tmp", data)
	root.Close()
	if err != nil {
		t.Fatal(err)
	}
	return snapshot, pack, data
}
func TestSnapshotContentOwnerBoundarySurvivesDeletedSourceAndExpires(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "snapshot-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "other-owner", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	snapshot, pack, data := seedReadySnapshot(t, a, string(owner.Id))
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET deleted_at=?,observed_state='deleted' WHERE id='work-snapshot-owner'`, packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	call := func(account, path string) (int, []byte) {
		t.Helper()
		login, err := a.Identity.Login(ctx, account, "development-fixture-pass", "snapshot-access")
		if err != nil {
			t.Fatal(err)
		}
		req, _ := http.NewRequest("GET", base+path, nil)
		req.Header.Set("Authorization", "Bearer "+login.Token)
		response, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil {
			t.Fatal(err)
		}
		return response.StatusCode, raw
	}
	path := "/api/v1/work-snapshots/" + snapshot + "/content"
	for _, account := range []string{"other-owner", "admin"} {
		status, raw := call(account, path)
		expected := 404
		if account == "admin" {
			expected = 403
		}
		if status != expected || bytes.Equal(raw, data) {
			t.Fatal(account, status, string(raw))
		}
	}
	status, raw := call("snapshot-owner", path)
	if status != 200 || !bytes.Equal(raw, data) {
		t.Fatal("sealed snapshot depended on deleted source", status, len(raw))
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE snapshot_packages SET expires_at=? WHERE id=?`, time.Now().Add(-time.Hour).UTC().Format(time.RFC3339Nano), pack)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	status, raw = call("snapshot-owner", path)
	if status != 410 || !bytes.Contains(raw, []byte("PACKAGE_EXPIRED")) {
		t.Fatal(status, string(raw))
	}
	if err := a.collectSnapshotGarbage(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	status, raw = call("snapshot-owner", path)
	if status != 410 {
		t.Fatal("expired receipt disappeared", status, string(raw))
	}
}

func TestCompletedSnapshotTransferSpoolRecoveryPreservesUnknownDirectory(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "spool")
	if err != nil {
		t.Fatal(err)
	}
	_, pack, _ := seedReadySnapshot(t, a, login.User.ID)
	area, err := a.Store.OpenSnapshotArea("transfers")
	if err != nil {
		t.Fatal(err)
	}
	defer area.Close()
	known, err := area.OpenDirectory("transfer-completed-owned")
	if err != nil {
		t.Fatal(err)
	}
	err = known.AtomicWrite("transfer-owner.json", "owner.tmp", snapshotRaw(snapshotUploadOwner{"transfer-completed-owned", pack, login.User.ID}))
	known.Close()
	if err != nil {
		t.Fatal(err)
	}
	unknown, err := area.OpenDirectory("transfer-unknown-retain")
	if err != nil {
		t.Fatal(err)
	}
	err = unknown.AtomicWrite("user-content", "unknown.tmp", []byte("retain"))
	unknown.Close()
	if err != nil {
		t.Fatal(err)
	}
	if err := a.cleanSnapshotTransferSpools(ctx); err != nil {
		t.Fatal(err)
	}
	names, err := area.Entries()
	if err != nil || len(names) != 1 || names[0] != "transfer-unknown-retain" {
		t.Fatal(names, err)
	}
}

func TestSnapshotGarbageCollectionWaitsForBothImportAndDownloadLeases(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "snapshot-gc")
	if err != nil {
		t.Fatal(err)
	}
	_, pack, _ := seedReadySnapshot(t, a, string(login.User.ID))
	now := packageNow()
	transfer := "transfer-protected-download"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.AcceptSnapshotTransfer(tx, corestore.SnapshotTransfer{ID: transfer, OwnerUserID: string(login.User.ID), PackageID: &pack, Kind: "download", Phase: "streaming", DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), LastProgressAt: now, CreatedAt: now}, nil)
	}); err != nil {
		t.Fatal(err)
	}
	work := "work-gc-unpublished"
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(login.User.ID), WorkScope: "work-imports", Kind: "import-work", IdempotencyKey: "gc-import", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: string(login.User.ID), Kind: "import", TargetWorkID: &work, PackageID: &pack, RequestDigest: "gc", Phase: "accepted", DeadlineAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now})
		return corestore.MutationEffect{ResourceID: work}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	root, err := a.Store.OpenSnapshotArea("packages")
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.AtomicWrite("unknown.work", "unknown.tmp", []byte("unowned bytes")); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE snapshot_packages SET expires_at=? WHERE id=?`, time.Now().Add(-time.Minute).UTC().Format(time.RFC3339Nano), pack)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	assertPresent := func() {
		t.Helper()
		if _, err := root.ReadPublishedFile(pack+".work", 2<<20); err != nil {
			t.Fatal("leased package removed", err)
		}
	}
	if err := a.collectSnapshotGarbage(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	assertPresent()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateSnapshotPhase(tx, accepted.OperationID, 1, "cleaned", packageNow(), nil)
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.collectSnapshotGarbage(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	assertPresent()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error { return corestore.FinishSnapshotTransfer(tx, transfer, true) }); err != nil {
		t.Fatal(err)
	}
	if err := a.collectSnapshotGarbage(ctx, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := root.ReadPublishedFile(pack+".work", 2<<20); !os.IsNotExist(err) {
		t.Fatal("unleased package bytes retained", err)
	}
	if raw, err := root.ReadPublishedFile("unknown.work", 2<<20); err != nil || string(raw) != "unowned bytes" {
		t.Fatal("GC changed unowned file", err)
	}
}

func TestSnapshotImportRejectsForgedOwner(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "forged-import")
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{"ownerId", "ownerUserId"} {
		status, view := httpCall(t, base, "/api/v1/work-imports", "POST", "Bearer "+login.Token, map[string]any{"packageId": "package-forged", "idempotencyKey": "forged-" + field, field: "other-administrator"})
		if status != 400 || view["code"] != "INVALID_REQUEST" {
			t.Fatal("owner override accepted", field, status, view)
		}
	}
}
