package coreapp

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"piwork/internal/corestore"
	"strings"
	"testing"
)

func TestPublishedHistoryBackupCleanupFailureCannotRestoreOldData(t *testing.T) {
	a := &Application{options: Options{DataDirectory: t.TempDir()}}
	id := "operation-memory-cleanup-fixture"
	root, err := a.historyApplyRoot(id)
	if err != nil {
		t.Fatal(err)
	}
	if err := root.AtomicMaterialWrite("history-backup-manifest.json", "manifest.tmp", []byte("retired backup"), 0600); err != nil {
		t.Fatal(err)
	}
	root.Close()
	parent := filepath.Join(a.options.DataDirectory, "runtime", "history-upgrades")
	if err := os.Chmod(parent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := a.cleanupHistoryBackup(id); err == nil {
		t.Fatal("unsafe cleanup accepted")
	}
	marker := filepath.Join(parent, id, "history-backup-manifest.json")
	if data, err := os.ReadFile(marker); err != nil || string(data) != "retired backup" {
		t.Fatal("failed cleanup destroyed recovery artifact", err)
	}
	plan := workApplyPlan{HistoryBackup: &applyHistoryBackup{State: "committed"}}
	if err := a.restoreHistoryUpgrade(context.Background(), id, &plan); err != nil {
		t.Fatal("published state attempted restoration", err)
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := a.cleanupHistoryBackup(id); err != nil {
		t.Fatal("retired cleanup is not retryable", err)
	}
	if _, err := os.Stat(marker); !os.IsNotExist(err) {
		t.Fatal("retired backup not removed", err)
	}
}

func TestRetiredHistoryCleanupKeepsPublicDiagnosticAndRetries(t *testing.T) {
	a, _, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	ctx := context.Background()
	user, err := a.Store.UserByAccount(ctx, "admin")
	if err != nil {
		t.Fatal(err)
	}
	work := "work-history-cleanup-0001"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: work, OwnerUserID: user.ID, Name: "Retired cleanup", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()})
	}); err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: user.ID, WorkScope: work, Kind: applyOperationKind, IdempotencyKey: "cleanup", RequestJSON: `{}`, TargetVersion: 1, WorkID: &work}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		return corestore.MutationEffect{ResourceID: work}, putApplyPlan(tx, id, workApplyPlan{WorkID: work, Control: 1, Stage: "validated", HistoryBackup: &applyHistoryBackup{State: "committed", BackupKey: "backup-fixture"}})
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.Store.CompleteOperation(ctx, accepted.OperationID, "succeeded", nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	root, err := a.historyApplyRoot(accepted.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	root.Close()
	parent := filepath.Join(a.options.DataDirectory, "runtime", "history-upgrades")
	if err := os.Chmod(parent, 0755); err != nil {
		t.Fatal(err)
	}
	if err := a.retireHistoryBackup(ctx, accepted.OperationID); err != nil {
		t.Fatal(err)
	}
	op, err := a.Store.Operation(ctx, accepted.OperationID)
	if err != nil || op.State != "succeeded" || op.ResultJSON == nil || !strings.Contains(*op.ResultJSON, "HISTORY_BACKUP_CLEANUP_REQUIRED") {
		t.Fatal("cleanup lost its real diagnostic or changed publication", op, err)
	}
	if err := os.Chmod(parent, 0700); err != nil {
		t.Fatal(err)
	}
	if err := a.cleanupRetiredHistoryBackups(ctx, work); err != nil {
		t.Fatal(err)
	}
	raw, err := a.Store.ControlMetadata(ctx, applyPlanKey(accepted.OperationID))
	var plan workApplyPlan
	if err != nil || strictMetadata(raw, &plan) != nil || plan.HistoryBackup.CleanupRequired || plan.HistoryBackup.State != "committed" {
		t.Fatal("retired cleanup did not preserve committed state", plan, err)
	}
	op, err = a.Store.Operation(ctx, accepted.OperationID)
	if err != nil || op.State != "succeeded" || !strings.Contains(*op.ResultJSON, `"outcome":"succeeded"`) {
		t.Fatal(op, err)
	}
}
