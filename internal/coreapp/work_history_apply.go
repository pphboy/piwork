package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
	"strings"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
	"piwork/internal/workhistory"
	"piwork/internal/workruntime"
)

type applyHistoryBackup struct {
	BackupKey               string                 `json:"backupKey"`
	ManifestDigest          string                 `json:"manifestDigest,omitempty"`
	State                   string                 `json:"state"`
	InitializationValidated bool                   `json:"initializationValidated"`
	CleanupRequired         bool                   `json:"cleanupRequired,omitempty"`
	Helper                  *snapshotHelperJournal `json:"helper,omitempty"`
	RecoveryControl         int64                  `json:"-"`
}

func pendingHistoryKey(workID string) string {
	return "work_history_upgrade_" + strings.ReplaceAll(workID, "-", "_")
}
func (a *Application) historyApplyRoot(operationID string) (*safefs.Root, error) {
	path := filepath.Join(a.options.DataDirectory, "runtime", "history-upgrades", operationID)
	if err := os.MkdirAll(path, 0700); err != nil {
		return nil, err
	}
	root, err := safefs.OpenRoot(path)
	if err != nil {
		return nil, err
	}
	if err = root.CheckPrivate(); err == nil {
		err = root.Lock()
	}
	if err != nil {
		root.Close()
		return nil, err
	}
	return root, nil
}

func (a *Application) runApplyHistoryHelper(ctx context.Context, operationID string, plan *workApplyPlan, action string) (workhistory.BackupResult, error) {
	var result workhistory.BackupResult
	if plan.HistoryBackup == nil {
		return result, corestore.ErrStorage
	}
	root, err := a.historyApplyRoot(operationID)
	if err != nil {
		return result, err
	}
	defer root.Close()
	image, err := a.requireSnapshotImage()
	if err != nil {
		return result, err
	}
	volume, err := a.dockerRuntime.EnsureVolume(ctx, plan.WorkID, "work-private")
	if err != nil {
		return result, err
	}
	contexts := []string{}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query("SELECT snapshot_id FROM work_context_snapshots WHERE work_id=? ORDER BY snapshot_id", plan.WorkID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if rows.Scan(&id) != nil {
				return corestore.ErrStorage
			}
			contexts = append(contexts, id)
		}
		return rows.Err()
	}); err != nil {
		return result, err
	}
	request := workhistory.BackupRequest{OperationID: operationID, WorkID: plan.WorkID, BackupKey: plan.HistoryBackup.BackupKey, ContextIDs: contexts}
	if action == "restore-history-backup" {
		request.ExpectedManifestDigest = plan.HistoryBackup.ManifestDigest
	}
	raw, err := json.Marshal(request)
	if err != nil {
		return result, err
	}
	if err := root.AtomicMaterialWrite("history-backup-request.json", "history-backup-request-"+uuid.NewString()+".tmp", raw, 0600); err != nil {
		return result, err
	}
	journal := plan.HistoryBackup.Helper
	if journal == nil {
		journal = &snapshotHelperJournal{Spec: dockerengine.SnapshotHelperSpec{WorkID: plan.WorkID, JobID: operationID, AttemptID: "attempt-" + uuid.NewString(), Epoch: plan.Control, ImageID: image, SpoolDirectory: filepath.Join(a.options.DataDirectory, "runtime", "history-upgrades", operationID), VolumeName: volume.Name, VolumeLogicalID: "work-private", Action: action}, CreationIssued: true}
		plan.HistoryBackup.Helper = journal
		if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
			return result, err
		}
	}
	if journal.Spec.Action != action {
		return result, corestore.ErrStorage
	}
	ensured, err := a.dockerRuntime.EnsureSnapshotHelper(ctx, journal.Spec)
	if err != nil {
		return result, err
	}
	if journal.ContainerID != "" && journal.ContainerID != ensured.ID {
		return result, dockerengine.ErrIdentity
	}
	journal.ContainerID = ensured.ID
	if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
		return result, err
	}
	var output json.RawMessage
	view, err := a.dockerRuntime.InspectSnapshotHelper(ctx, journal.Spec)
	if err != nil {
		return result, err
	}
	if view == nil || view.State == nil {
		return result, dockerengine.ErrStateUnknown
	}
	if view.State.Status == "created" {
		output, err = a.dockerRuntime.RunSnapshotHelper(ctx, journal.Spec)
	} else {
		// Recover a recorded attempt without starting its work a second time.
		deadline := time.Now().Add(60 * time.Second)
		for view.State.Running && time.Now().Before(deadline) {
			select {
			case <-ctx.Done():
				return result, ctx.Err()
			case <-time.After(100 * time.Millisecond):
			}
			view, err = a.dockerRuntime.InspectSnapshotHelper(ctx, journal.Spec)
			if err != nil || view == nil || view.State == nil {
				return result, dockerengine.ErrStateUnknown
			}
		}
		if view.State.Running || view.State.ExitCode != 0 {
			return result, dockerengine.ErrStateUnknown
		}
		output, err = root.ReadPublishedFile(action+"-result.json", 1<<20)
	}
	if err != nil {
		return result, err
	}
	if strictMetadata(output, &result) != nil {
		return result, corestore.ErrStorage
	}
	cleanup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := a.dockerRuntime.RemoveSnapshotHelper(cleanup, journal.Spec, journal.ContainerID); err != nil {
		return result, err
	}
	plan.HistoryBackup.Helper = nil
	if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
		return result, err
	}
	return result, nil
}

func (a *Application) prepareHistoryUpgrade(ctx context.Context, operationID string, plan *workApplyPlan, candidate workruntime.StartSpec) error {
	capabilities, err := a.inspector.InspectNativeAgent(ctx, candidate.ImageID)
	if err != nil {
		return err
	}
	if plan.PriorContextID != nil {
		prior, _, err := a.capturedContextSpec(ctx, plan.WorkID, 1, "inspection", *plan.PriorContextID, true)
		if err != nil {
			return err
		}
		old, err := a.inspector.InspectNativeAgent(ctx, prior.ImageID)
		if err != nil {
			return err
		}
		if old.WorkHistorySchema == 5 && capabilities.WorkHistorySchema == 4 {
			return contracts.NewError("CONTEXT_FORMAT_UNSUPPORTED", "")
		}
		if old.WorkHistorySchema == 5 || capabilities.WorkHistorySchema != 5 {
			return nil
		}
	}
	if capabilities.WorkHistorySchema != 5 {
		return nil
	}
	if plan.HistoryBackup == nil {
		plan.HistoryBackup = &applyHistoryBackup{BackupKey: uuid.NewString(), State: "planned"}
		if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
			return err
		}
	}
	if plan.HistoryBackup.State != "planned" {
		return nil
	}
	result, err := a.runApplyHistoryHelper(ctx, operationID, plan, "checkpoint-history")
	if err != nil {
		return err
	}
	if result.State == "not-required" {
		plan.HistoryBackup = nil
		return a.saveApplyPlan(ctx, operationID, *plan)
	}
	if result.SchemaVersion != 4 || result.State != "saved" || len(result.ManifestDigest) != 64 {
		return corestore.ErrStorage
	}
	plan.HistoryBackup.State = "saved"
	plan.HistoryBackup.ManifestDigest = result.ManifestDigest
	if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
		return err
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		raw, _ := json.Marshal(map[string]any{"operationId": operationID, "control": plan.Control})
		_, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", pendingHistoryKey(plan.WorkID), string(raw), packageNow())
		return err
	})
}

func (a *Application) restoreHistoryUpgrade(ctx context.Context, operationID string, plan *workApplyPlan) error {
	if plan.HistoryBackup == nil || plan.HistoryBackup.State == "restored" || plan.HistoryBackup.State == "committed" {
		return nil
	}
	if plan.HistoryBackup.State != "saved" {
		if plan.HistoryBackup.State != "planned" {
			return corestore.ErrStorage
		}
		result, err := a.runApplyHistoryHelper(ctx, operationID, plan, "checkpoint-history")
		if err != nil {
			return err
		}
		if result.State == "not-required" {
			plan.HistoryBackup.State = "restored"
		} else if result.State == "saved" && result.SchemaVersion == 4 && len(result.ManifestDigest) == 64 {
			plan.HistoryBackup.State = "saved"
			plan.HistoryBackup.ManifestDigest = result.ManifestDigest
		} else {
			return corestore.ErrStorage
		}
		if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
			return err
		}
		if plan.HistoryBackup.State == "restored" {
			return a.clearHistoryPending(ctx, plan.WorkID)
		}
	}
	if plan.HistoryBackup.Helper != nil {
		return dockerengine.ErrStateUnknown
	}
	result, err := a.runApplyHistoryHelper(ctx, operationID, plan, "restore-history-backup")
	if err != nil {
		return err
	}
	if result.SchemaVersion != 4 || result.State != "restored" {
		return corestore.ErrStorage
	}
	plan.HistoryBackup.State = "restored"
	if err := a.saveApplyPlan(ctx, operationID, *plan); err != nil {
		return err
	}
	return a.clearHistoryPending(ctx, plan.WorkID)
}

func (a *Application) clearHistoryPending(ctx context.Context, workID string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("DELETE FROM control_metadata WHERE key=?", pendingHistoryKey(workID))
		return err
	})
}

// Recovery can finish just before another accepted Apply resumes. Keep the
// evidence in the existing captured plan, including across a Core interruption;
// the drain skip still requires a fresh Engine confirmation that no Agent exists.
func (a *Application) restoredPriorHistory(ctx context.Context, plan workApplyPlan) (bool, error) {
	if plan.PriorContextID == nil {
		return false, nil
	}
	restored := false
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var id string
		err := tx.QueryRow("SELECT id FROM operations WHERE work_id=? AND kind=? AND state='superseded' AND target_version<? ORDER BY target_version DESC LIMIT 1", plan.WorkID, applyOperationKind, plan.Control).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		var raw string
		if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", applyPlanKey(id)).Scan(&raw); err != nil {
			return err
		}
		var prior workApplyPlan
		if strictMetadata([]byte(raw), &prior) != nil {
			return corestore.ErrStorage
		}
		restored = prior.WorkID == plan.WorkID && prior.Control < plan.Control && prior.PriorContextID != nil && *prior.PriorContextID == *plan.PriorContextID && (prior.HistoryRecovered || prior.HistoryBackup != nil && prior.HistoryBackup.State == "restored")
		return nil
	})
	return restored, err
}

// A cleanup failure cannot change a published active context or restore old data.
func (a *Application) cleanupHistoryBackup(operationID string) error {
	root, err := safefs.OpenRoot(filepath.Join(a.options.DataDirectory, "runtime", "history-upgrades"))
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer root.Close()
	if err := root.Lock(); err != nil {
		return err
	}
	return root.RemoveTree(operationID)
}

// Retry only retired Core-owned backup directories during the existing Work
// reconciliation. Cleanup cannot roll back a published format or stop a Run.
func (a *Application) cleanupRetiredHistoryBackups(ctx context.Context, workID string) error {
	ids := []string{}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query("SELECT o.id,o.target_version,m.value_json FROM operations o JOIN control_metadata m ON m.key='work_apply_'||replace(o.id,'-','_') WHERE o.work_id=? AND o.kind=? AND o.state IN ('succeeded','failed','superseded')", workID, applyOperationKind)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id, raw string
			var control int64
			if rows.Scan(&id, &control, &raw) != nil {
				return corestore.ErrStorage
			}
			var plan workApplyPlan
			if strictMetadata([]byte(raw), &plan) != nil || plan.WorkID != workID || plan.Control != control {
				return corestore.ErrStorage
			}
			if plan.HistoryBackup != nil && plan.HistoryBackup.Helper == nil && (plan.HistoryBackup.State == "committed" || plan.HistoryBackup.State == "restored") {
				ids = append(ids, id)
			}
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err := a.retireHistoryBackup(ctx, id); err != nil {
			return err
		}
	}
	return nil
}

func migrationGrant(operationID string, plan workApplyPlan) *contracts.WorkHistoryMigration {
	if plan.HistoryBackup == nil || plan.HistoryBackup.State != "saved" || plan.HistoryBackup.InitializationValidated {
		return nil
	}
	return &contracts.WorkHistoryMigration{OperationId: operationID, WorkId: plan.WorkID, FromSchema: 4, ToSchema: 5, StoreId: plan.HistoryBackup.BackupKey, BackupManifestDigest: contracts.WorkBlobDigest(plan.HistoryBackup.ManifestDigest)}
}

func (a *Application) clearCommittedHistory(tx *sql.Tx, operationID string, plan workApplyPlan) error {
	if plan.HistoryBackup == nil {
		return nil
	}
	plan.HistoryBackup.State = "committed"
	if err := putApplyPlan(tx, operationID, plan); err != nil {
		return err
	}
	_, err := tx.Exec("DELETE FROM control_metadata WHERE key=?", pendingHistoryKey(plan.WorkID))
	return err
}

func (a *Application) rejectUnresolvedHistoryTx(tx *sql.Tx, workID string) error {
	var raw string
	err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", pendingHistoryKey(workID)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return contracts.NewError("WORK_BUSY", "")
}

// Called only by the current coordinator while it owns the existing Work lock.
// The captured old plan keeps its original control; this nonserialized token fences recovery writes.
func (a *Application) reconcileHistoryUpgradeLocked(ctx context.Context, workID string, skipOperationID ...string) error {
	var pending struct {
		OperationID string `json:"operationId"`
		Control     int64  `json:"control"`
	}
	raw, err := a.Store.ControlMetadata(ctx, pendingHistoryKey(workID))
	if err != nil {
		return err
	}
	if len(raw) == 0 {
		_ = a.cleanupRetiredHistoryBackups(ctx, workID)
		return nil
	}
	if strictMetadata(raw, &pending) != nil || pending.OperationID == "" {
		return corestore.ErrStorage
	}
	if len(skipOperationID) == 1 && pending.OperationID == skipOperationID[0] {
		return nil
	}
	var plan workApplyPlan
	raw, err = a.Store.ControlMetadata(ctx, applyPlanKey(pending.OperationID))
	if err != nil || strictMetadata(raw, &plan) != nil || plan.WorkID != workID || plan.Control != pending.Control || plan.HistoryBackup == nil {
		return corestore.ErrStorage
	}
	var work corestore.WorkRecord
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; work, err = corestore.ReadWork(tx, workID, false); return err }); err != nil {
		return err
	}
	if work.ControlVersion < plan.Control {
		return errWorkSuperseded
	}
	if plan.HistoryBackup.State == "committed" || plan.HistoryBackup.State == "restored" {
		return a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec("DELETE FROM control_metadata WHERE key=?", pendingHistoryKey(workID))
			return err
		})
	}
	if work.ControlVersion == plan.Control {
		return contracts.NewError("WORK_BUSY", "")
	}
	plan.HistoryBackup.RecoveryControl = work.ControlVersion
	if err := a.removeApplyAgent(ctx, workID); err != nil {
		return err
	}
	if plan.HistoryBackup.Helper != nil {
		result, err := a.runApplyHistoryHelper(ctx, pending.OperationID, &plan, plan.HistoryBackup.Helper.Spec.Action)
		if err != nil {
			return err
		}
		if result.State == "saved" {
			plan.HistoryBackup.State = "saved"
			plan.HistoryBackup.ManifestDigest = result.ManifestDigest
		}
		if result.State == "restored" {
			plan.HistoryBackup.State = "restored"
		}
		if err := a.saveApplyPlan(ctx, pending.OperationID, plan); err != nil {
			return err
		}
	}
	if err := a.restoreHistoryUpgrade(ctx, pending.OperationID, &plan); err != nil {
		return err
	}
	return nil
}

// This only admits the one initialization-only migration generation for a saved
// Apply. Every ordinary Service RPC still requires authorizeServiceTx (ready).
func (a *Application) historyMigrationPlanTx(tx *sql.Tx, scope internaltls.Scope) (workApplyPlan, error) {
	var plan workApplyPlan
	if scope.InstallationID != a.Store.InstallationID() || scope.Generation < 1 || scope.InstanceID == "" {
		return plan, internaltls.ErrIdentity
	}
	var raw string
	if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", pendingHistoryKey(scope.WorkID)).Scan(&raw); err != nil {
		return plan, internaltls.ErrStale
	}
	var pending struct {
		OperationID string `json:"operationId"`
		Control     int64  `json:"control"`
	}
	if strictMetadata([]byte(raw), &pending) != nil {
		return plan, corestore.ErrStorage
	}
	if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", applyPlanKey(pending.OperationID)).Scan(&raw); err != nil {
		return plan, err
	}
	if strictMetadata([]byte(raw), &plan) != nil || plan.WorkID != scope.WorkID || plan.Control != pending.Control || plan.Generation != scope.Generation || plan.InstanceID != scope.InstanceID || plan.Stage != "starting" || plan.HistoryBackup == nil || plan.HistoryBackup.State != "saved" || plan.HistoryBackup.InitializationValidated || len(plan.HistoryBackup.ManifestDigest) != 64 {
		return plan, internaltls.ErrStale
	}
	var eligible bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM runtime_generations g JOIN works w ON w.id=g.work_id JOIN operations o ON o.id=? WHERE g.work_id=? AND g.generation=? AND g.instance_id=? AND g.state='starting' AND g.generation=(SELECT MAX(n.generation) FROM runtime_generations n WHERE n.work_id=g.work_id) AND w.control_version=? AND w.deleted_at IS NULL AND o.kind=? AND o.state IN ('pending','running') AND o.target_version=?)`, pending.OperationID, scope.WorkID, scope.Generation, scope.InstanceID, plan.Control, applyOperationKind, plan.Control).Scan(&eligible); err != nil {
		return plan, err
	}
	if !eligible {
		return plan, internaltls.ErrStale
	}
	return plan, nil
}

func (server *serviceRPC) AuthorizeHistoryMigration(ctx context.Context, request *servicesv1.WorkPrivateRequest) (*servicesv1.WorkPrivateResponse, error) {
	scope, ok := internaltls.ServicePrincipal(ctx)
	if !ok {
		return nil, rpcServiceError(internaltls.ErrIdentity)
	}
	if request == nil {
		return nil, rpcServiceError(contracts.NewError("INVALID_REQUEST", ""))
	}
	input, err := contracts.Decode[contracts.WorkHistoryMigration](strings.NewReader(request.InputJson), "WorkHistoryMigrationSchema", 16<<10)
	if err != nil {
		return nil, rpcServiceError(contracts.NewError("INVALID_REQUEST", ""))
	}
	err = server.App.Store.Read(ctx, func(tx *sql.Tx) error {
		plan, err := server.App.historyMigrationPlanTx(tx, scope)
		if err != nil {
			return err
		}
		if input.WorkId != scope.WorkID || input.FromSchema != 4 || input.ToSchema != 5 || input.StoreId != plan.HistoryBackup.BackupKey || string(input.BackupManifestDigest) != plan.HistoryBackup.ManifestDigest {
			return internaltls.ErrIdentity
		}
		var pending string
		if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", pendingHistoryKey(scope.WorkID)).Scan(&pending); err != nil {
			return err
		}
		var p struct {
			OperationID string `json:"operationId"`
			Control     int64  `json:"control"`
		}
		if strictMetadata([]byte(pending), &p) != nil || input.OperationId != p.OperationID {
			return internaltls.ErrIdentity
		}
		root, err := server.App.historyApplyRoot(input.OperationId)
		if err != nil {
			return err
		}
		defer root.Close()
		file, err := root.ReadPublishedFile("history-backup-manifest.json", 1<<20)
		if err != nil {
			return err
		}
		digest := sha256.Sum256(file)
		if hex.EncodeToString(digest[:]) != plan.HistoryBackup.ManifestDigest {
			return internaltls.ErrIdentity
		}
		return nil
	})
	if err != nil {
		return nil, rpcServiceError(err)
	}
	return &servicesv1.WorkPrivateResponse{ValueJson: `{"authorized":true}`}, nil
}

func (a *Application) retireHistoryBackup(ctx context.Context, operationID string) error {
	cleanupErr := a.cleanupHistoryBackup(operationID)
	if os.IsNotExist(cleanupErr) {
		cleanupErr = nil
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		var raw string
		if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", applyPlanKey(operationID)).Scan(&raw); err != nil {
			return err
		}
		var plan workApplyPlan
		if strictMetadata([]byte(raw), &plan) != nil || plan.HistoryBackup == nil || plan.HistoryBackup.State != "committed" && plan.HistoryBackup.State != "restored" {
			return corestore.ErrStorage
		}
		changed := plan.HistoryBackup.CleanupRequired != (cleanupErr != nil)
		if !changed {
			return nil
		}
		plan.HistoryBackup.CleanupRequired = cleanupErr != nil
		var result *string
		var state, work string
		var control int64
		if err := tx.QueryRow("SELECT result_json,state,work_id,target_version FROM operations WHERE id=?", operationID).Scan(&result, &state, &work, &control); err != nil {
			return err
		}
		if work != plan.WorkID || control != plan.Control || state != "succeeded" && state != "failed" && state != "superseded" {
			return corestore.ErrStorage
		}
		envelope := decodeDiagnosticEnvelope(result, operationID)
		outcome := "succeeded"
		if cleanupErr != nil {
			outcome = "failed"
		}
		event := diagnostics.Event{Component: "core", Stage: "runtime-prepare", Outcome: outcome, Code: "HISTORY_BACKUP_CLEANUP_REQUIRED"}
		envelope.Diagnostics = diagnostics.Append(envelope.Diagnostics, event)
		encoded, err := json.Marshal(envelope)
		if err != nil {
			return err
		}
		if err := putApplyPlan(tx, operationID, plan); err != nil {
			return err
		}
		_, err = tx.Exec("UPDATE operations SET result_json=?,updated_at=? WHERE id=?", string(encoded), packageNow(), operationID)
		return err
	})
}
