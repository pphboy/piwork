package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestImportedHistoryAndProvenanceRemainOwnerContent(t *testing.T) {
	a, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	owner, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "history-owner", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "history-other", "development-fixture-pass", "user"); err != nil {
		t.Fatal(err)
	}
	work, sourceWork, op, sourceOp := "work-history-target", "work-history-source", "operation-history-target", "operation-history-source"
	now := packageNow()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: string(owner.Id), Name: "History", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now})
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: string(owner.Id), WorkScope: "work-imports", Kind: "import-work", IdempotencyKey: "history-import", RequestJSON: `{}`, TargetVersion: 1, Now: now}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if err := corestore.InsertSnapshotJob(tx, corestore.SnapshotJob{OperationID: id, OwnerUserID: string(owner.Id), Kind: "import", TargetWorkID: &work, Phase: "accepted", DeadlineAt: now, WorkerEpoch: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
			return corestore.MutationEffect{}, err
		}
		return corestore.MutationEffect{ResourceID: work}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	result := `{"correlationId":"operation-history-source","result":{"configuration":{"workId":"work-history-source","agentsMd":"hostile-history /private/file"}},"diagnostics":{"stages":[{"timestamp":"` + now + `","component":"core","stage":"service-readiness","outcome":"failed","code":"SERVICE_EXITED","message":"hostile-history","serviceId":"service-history-source"}],"truncated":false,"rollback":{"state":"not-required"},"diagnosticCollection":{"state":"unrecognized"}}}`
	failure := `{"code":"SERVICE_EXITED","stage":"service-readiness","message":"hostile-history /private/file","remediation":"forged instructions","retryable":true,"serviceId":"service-history-source"}`
	archived := contracts.ArchivedWorkOperation{Id: contracts.ResourceId(sourceOp), WorkId: contracts.ResourceId(sourceWork), ServiceId: snapshotRaw("service-history-source"), Kind: "create-service", State: "failed", TargetVersion: 1, RequestJson: `{"hostPath":"/private/source"}`, ResultJson: snapshotRaw(result), ErrorJson: snapshotRaw(failure), CreatedAt: contracts.Timestamp(now), UpdatedAt: contracts.Timestamp(now)}
	if err := contracts.Validate("ArchivedWorkOperationSchema", archived); err != nil {
		t.Fatal(err)
	}
	provenance := map[string]any{"sourceIdentityMap": map[string]any{"sourceWorkId": sourceWork, "services": []any{map[string]string{"key": "web", "sourceId": "service-history-source"}}}, "targets": map[string]any{"workId": work, "services": []any{map[string]string{"key": "web", "id": "service-history-target"}}}, "archivedIdempotency": []any{}}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO imported_work_history(work_id,operation_id,source_operation_id,record_json) VALUES(?,?,?,?)`, work, op, sourceOp, string(snapshotRaw(archived))); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO work_import_provenance(work_id,package_digest,import_operation_id,identity_map_json) VALUES(?,?,?,?)`, work, strings.Repeat("a", 64), accepted.OperationID, string(snapshotRaw(provenance)))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, account := range []string{"history-owner", "history-other", "admin"} {
		login, err := a.Identity.Login(ctx, account, "development-fixture-pass", "history-access")
		if err != nil {
			t.Fatal(err)
		}
		for _, path := range []string{"/api/v1/operations/" + op, "/api/v1/works/" + work + "/import-provenance"} {
			status, body := httpCall(t, base, path, "GET", "Bearer "+login.Token, nil)
			want := 404
			if account == "admin" {
				want = 403
			}
			if account == "history-owner" {
				want = 200
			}
			if status != want {
				t.Fatal(account, path, status, body)
			}
			if status == 200 {
				raw, _ := json.Marshal(body)
				if strings.Contains(string(raw), "hostile-history") || strings.Contains(string(raw), "/private/") {
					t.Fatal("archive raw content escaped", string(raw))
				}
				if strings.Contains(path, "operations") {
					if err := contracts.Validate("PublicOperationSchema", body); err != nil {
						t.Fatal(err)
					}
					if body["result"] != nil || body["workId"] != work || body["error"] == nil {
						t.Fatal(body)
					}
					stages := body["diagnostics"].(map[string]any)["stages"].([]any)
					if stages[0].(map[string]any)["serviceId"] != "service-history-target" {
						t.Fatal("historical service identity not remapped", body)
					}
				} else if err := contracts.Validate("WorkImportProvenanceSchema", body); err != nil {
					t.Fatal(err)
				}
			}
		}
	}
}
