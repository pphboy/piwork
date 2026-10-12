package coreapp

import (
	"context"
	"database/sql"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
)

func TestCreateWorkNameConflictIncludesFieldAndPreservesOccupancy(t *testing.T) {
	for _, occupied := range []string{"visible", "deleted", "import"} {
		t.Run(occupied, func(t *testing.T) {
			a, base, _ := appFixture(t, Options{})
			ctx := context.Background()
			owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "name-owner", "development-fixture-pass", "user")
			if err != nil {
				t.Fatal(err)
			}
			login, err := a.Identity.Login(ctx, "name-owner", "development-fixture-pass", "test")
			if err != nil {
				t.Fatal(err)
			}
			name, now := "笔记", packageNow()
			if occupied == "import" {
				_, err = a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: "work-imports", Kind: "import-work", IdempotencyKey: "held-import", RequestJSON: `{}`, TargetVersion: 1}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
					target := "work-import-name-holder"
					if err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: string(owner.Id), Kind: "import", TargetWorkID: &target, Name: &name, Phase: "accepted", WorkerEpoch: 1, RequestDigest: "fixture", CreatedAt: now, UpdatedAt: now, DeadlineAt: "2099-01-01T00:00:00Z"}); err != nil {
						return corestore.MutationEffect{}, err
					}
					return corestore.MutationEffect{ResourceID: target}, corestore.ReserveImportName(tx, string(owner.Id), name, id)
				})
			} else {
				err = a.Store.Write(ctx, func(tx *sql.Tx) error {
					work := corestore.WorkRecord{ID: "work-name-holder", OwnerUserID: string(owner.Id), Name: name, DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}
					if occupied == "deleted" {
						work.DesiredState, work.ObservedState, work.DeletedAt = "deleted", "deleted", &now
					}
					return corestore.InsertWork(tx, work)
				})
			}
			if err != nil {
				t.Fatal(err)
			}
			// Occupied names must be rejected before touching runtime dependencies.
			// These sentinels satisfy admission but cannot prepare an image.
			a.mu.Lock()
			a.state, a.engine, a.inspector = "READY", &dockerengine.Engine{}, &dockerengine.ImageInspector{}
			a.mu.Unlock()
			t.Cleanup(func() { a.engine, a.inspector = nil, nil })
			auth := "Bearer " + login.Token
			status, body := httpCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": name, "idempotencyKey": "new-create"})
			if status != 409 || body["code"] != "WORK_NAME_CONFLICT" || body["field"] != "name" || body["operationId"] != nil || body["workId"] != nil {
				t.Fatal(status, body)
			}
			if status, body := httpCall(t, base, "/api/v1/works", "POST", auth, map[string]string{"name": "Available", "idempotencyKey": "free-create"}); status != 503 || body["code"] != "RUNTIME_UNAVAILABLE" {
				t.Fatal("unrelated failure became a name conflict", status, body)
			}
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var works, creates, imports int
				if err := tx.QueryRow(`SELECT (SELECT count(*) FROM works),(SELECT count(*) FROM operations WHERE kind='create-work'),(SELECT count(*) FROM work_import_names)`).Scan(&works, &creates, &imports); err != nil {
					return err
				}
				if creates != 0 || occupied == "import" && (works != 0 || imports != 1) || occupied != "import" && (works != 1 || imports != 0) {
					t.Fatalf("conflict changed durable records: works=%d creates=%d imports=%d", works, creates, imports)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
