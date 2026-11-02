package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

func TestPriorApplyActualReaderSeparatesIOFromConfirmedCorruption(t *testing.T) {
	for _, mode := range []string{"cancelled", "closed-store", "missing-root", "missing-file", "missing-record", "missing-secret", "malformed-secret", "corrupt-content"} {
		t.Run(mode, func(t *testing.T) {
			a, _, id, _ := runModelFixture(t)
			ctx := context.Background()
			work, err := a.Store.Work(ctx, id, false)
			if err != nil {
				t.Fatal(err)
			}
			contextID := *work.ActiveContextID
			accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: work.OwnerUserID, WorkScope: id, Kind: applyOperationKind, IdempotencyKey: mode, RequestJSON: `{}`, TargetVersion: work.ControlVersion, WorkID: &id, FenceScope: "work"}, func(*sql.Tx, string) (corestore.MutationEffect, error) {
				return corestore.MutationEffect{ResourceID: id}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			operation, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			root := filepath.Join(a.options.DataDirectory, "works", id, "contexts", contextID)
			if mode == "missing-file" || mode == "corrupt-content" {
				if err := os.MkdirAll(root, 0700); err != nil {
					t.Fatal(err)
				}
				if mode == "corrupt-content" {
					if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(`{}`), 0600); err != nil {
						t.Fatal(err)
					}
				}
			}
			if mode == "missing-record" {
				contextID = "context-missing-original"
			}
			if mode == "missing-secret" || mode == "malformed-secret" {
				var credential string
				if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
					var raw string
					if err := tx.QueryRow(`SELECT configuration_json FROM work_context_snapshots WHERE snapshot_id=?`, contextID).Scan(&raw); err != nil {
						return err
					}
					var configuration contracts.WorkConfig
					if err := json.Unmarshal([]byte(raw), &configuration); err != nil {
						return err
					}
					metadata, _, _, err := a.catalogModelTx(tx, string(configuration.ModelRef), false)
					credential = metadata.CredentialRef
					return err
				}); err != nil {
					t.Fatal(err)
				}
				if err := a.files.RemoveSecret(credential); err != nil {
					t.Fatal(err)
				}
				if mode == "malformed-secret" {
					if err := a.files.WriteSecret(credential, []byte("malformed-no-newline")); err != nil {
						t.Fatal(err)
					}
				}
			}
			attempt, cancel := context.WithCancel(ctx)
			defer cancel()
			if mode == "cancelled" {
				cancel()
			}
			reader := a
			if mode == "closed-store" {
				closed, err := corestore.Open(ctx, corestore.Options{Directory: t.TempDir(), InstallationID: "installation-closed-read-fixture"})
				if err != nil {
					t.Fatal(err)
				}
				if err := closed.Close(); err != nil {
					t.Fatal(err)
				}
				reader = &Application{Store: closed}
			}
			_, _, readErr := reader.capturedPriorApplyContext(attempt, id, contextID)
			permanent := mode == "corrupt-content" || mode == "missing-record"
			if readErr == nil || errors.Is(readErr, errCapturedWork) != permanent {
				t.Fatalf("actual read misclassified: mode=%s permanent=%t error=%v", mode, errors.Is(readErr, errCapturedWork), readErr)
			}
			_, _, legacyErr := reader.capturedContextSpec(attempt, id, 1, "inspection", contextID, true)
			if !errors.Is(legacyErr, errCapturedWork) {
				t.Fatal("existing launch error mapping changed")
			}
			// Use a live publication context: a read cancellation must not become a
			// permanent context failure merely because the next owner check is live.
			result := a.finishApplyPriorContextFailure(ctx, operation, readErr)

			after, err := a.Store.Operation(ctx, operation.ID)
			if err != nil {
				t.Fatal(err)
			}
			if permanent {
				if result != nil || after.State != "failed" {
					t.Fatal("confirmed corrupt context did not terminate")
				}
			} else if !errors.Is(result, readErr) || after.State != operation.State {
				t.Fatal("read failure terminated original operation")
			}
			current, err := a.Store.Work(ctx, id, false)
			if err != nil {
				t.Fatal(err)
			}
			if current.ControlVersion != work.ControlVersion || current.ObservedState != work.ObservedState {
				t.Fatal("preflight changed Work")
			}
		})
	}
}
