package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"log"
	"os"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/workpackage"
)

func (a *Application) recoverSnapshotJobs(ctx context.Context, onlyPending bool) error {
	var jobs []corestore.SnapshotJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.SnapshotJobs(tx); return err }); err != nil {
		return err
	}
	for _, job := range jobs {
		if _, running := a.snapshotRunning.Load(job.OperationID); running {
			continue
		}
		if job.Phase == "succeeded" || job.Phase == "cleaned" {
			if !onlyPending {
				_ = a.removeSnapshotJobRoot(job.OperationID)
			}
			continue
		}
		if onlyPending && job.Phase != "cleanup-pending" {
			continue
		}
		if job.Kind != "export" && job.Kind != "import" {
			return corestore.ErrStorage
		}
		previous := job
		if job.Phase != "cleanup-pending" || !onlyPending {
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				var err error
				job, err = corestore.FenceSnapshotWorker(tx, job.OperationID, packageNow())
				return err
			}); err != nil {
				return err
			}
		}
		var recoveryErr error
		if job.Kind == "import" {
			recoveryErr = a.cleanupSnapshotImport(ctx, job, contracts.NewError("WORK_OPERATION_FAILED", ""))
		} else {
			recoveryErr = a.recoverSnapshotExport(ctx, previous, job)
		}
		if recoveryErr != nil {
			cleanup := "SNAPSHOT_CLEANUP_REQUIRED"
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				return corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "cleanup-pending", packageNow(), &cleanup)
			}); err != nil {
				return err
			}
			log.Print("piwork: snapshot cleanup remains pending for " + job.OperationID)
		}
	}
	if !onlyPending {
		return a.recoverSnapshotTransfers(ctx, false)
	}
	return a.recoverSnapshotTransfers(ctx, true)
}
func (a *Application) recoverSnapshotExport(ctx context.Context, previous, job corestore.SnapshotJob) error {
	var artifacts []corestore.SnapshotArtifact
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		artifacts, err = corestore.SnapshotArtifacts(tx, job.OperationID)
		return err
	}); err != nil {
		return err
	}
	for _, artifact := range artifacts {
		if artifact.Kind == "helper" && artifact.State != "cleaned" {
			var journal snapshotHelperJournal
			if strictMetadata([]byte(artifact.LogicalID), &journal) != nil {
				return corestore.ErrStorage
			}
			if err := a.retireSnapshotHelper(ctx, job, artifact.ArtifactKey, journal); err != nil {
				return err
			}
		}
	}
	if previous.Phase != "cleanup-pending" {
		for _, artifact := range artifacts {
			if artifact.ArtifactKey == "sealed-package" && artifact.Kind == "sealed-package" && artifact.State == "ready" {
				var marker struct {
					Digest    string `json:"digest"`
					Size      int64  `json:"size"`
					ReadyAt   string `json:"readyAt"`
					ExpiresAt string `json:"expiresAt"`
				}
				if strictMetadata([]byte(artifact.LogicalID), &marker) != nil || !packageUploadDigest.MatchString(marker.Digest) || marker.Size < 0 || job.PackageID == nil {
					return corestore.ErrStorage
				}
				root, err := a.Store.OpenSnapshotArea("packages")
				if err != nil {
					return err
				}
				file, err := root.OpenFile(*job.PackageID+".work", unix.O_RDONLY)
				root.Close()
				if err != nil {
					break
				}
				info, statErr := file.Stat()
				var verified workpackage.Verified
				if statErr == nil && info.Size() == marker.Size {
					verified, err = workpackage.Read(ctx, io.NewSectionReader(file, 0, info.Size()), workpackage.ReadOptions{})
					if err == nil {
						err = workpackage.ValidatePackageContent(ctx, verified, verified.Open(file))
					}
					if err == nil {
						err = workpackage.ValidateImages(ctx, verified, file)
					}
				} else {
					err = corestore.ErrStorage
				}
				file.Close()
				if err != nil || verified.Digest != marker.Digest {
					break
				}
				result := string(snapshotRaw(map[string]any{"correlationId": job.OperationID, "result": map[string]any{"observedState": "stopped"}}))
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					if _, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); err != nil {
						return err
					}
					if err := corestore.SealSnapshotPackage(tx, *job.PackageID, marker.Digest, marker.Size, marker.ReadyAt, marker.ExpiresAt); err != nil {
						return err
					}
					if err := corestore.ReleaseSnapshotReservations(tx, job.OperationID, job.WorkerEpoch, true); err != nil {
						return err
					}
					if _, err := tx.Exec(`UPDATE snapshot_jobs SET phase='succeeded',cleanup_error=NULL,updated_at=? WHERE operation_id=? AND worker_epoch=?`, packageNow(), job.OperationID, job.WorkerEpoch); err != nil {
						return err
					}
					_, err := tx.Exec(`UPDATE operations SET state='succeeded',result_json=?,error_json=NULL,updated_at=? WHERE id=? AND state IN ('pending','running')`, result, packageNow(), job.OperationID)
					return err
				}); err != nil {
					return err
				}
				_ = a.removeSnapshotJobRoot(job.OperationID)
				return nil
			}
		}
	}
	if job.PackageID != nil {
		root, err := a.Store.OpenSnapshotArea("packages")
		if err != nil {
			return err
		}
		err = root.Remove(*job.PackageID + ".work")
		root.Close()
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := a.removeSnapshotJobRoot(job.OperationID); err != nil {
		return err
	}
	failure := string(snapshotRaw(map[string]any{"code": "SNAPSHOT_EXPORT_FAILED", "stage": "runtime-prepare", "message": "Work export was interrupted.", "remediation": "Inspect the Work and retry export.", "retryable": false}))
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := corestore.AssertSnapshotFence(tx, job.OperationID, job.WorkerEpoch); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE snapshot_artifacts SET state='cleaned' WHERE operation_id=?`, job.OperationID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE snapshot_packages SET state='expired' WHERE id=? AND state='staging'`, job.PackageID); err != nil {
			return err
		}
		if err := corestore.ReleaseSnapshotReservations(tx, job.OperationID, job.WorkerEpoch, true); err != nil {
			return err
		}
		if err := corestore.UpdateSnapshotPhase(tx, job.OperationID, job.WorkerEpoch, "cleaned", packageNow(), nil); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE operations SET state='failed',error_json=?,updated_at=? WHERE id=? AND state IN ('pending','running')`, failure, packageNow(), job.OperationID)
		return err
	})
}
func (a *Application) recoverSnapshotTransfers(ctx context.Context, onlyPending bool) error {
	var transfers []corestore.SnapshotTransfer
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; transfers, err = corestore.SnapshotTransfers(tx); return err }); err != nil {
		return err
	}
	for _, transfer := range transfers {
		if _, active := a.snapshotTransfers.Load(transfer.ID); active || (onlyPending && transfer.Phase != "cleanup-pending") {
			continue
		}
		if transfer.Kind == "download" {
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error { return corestore.FinishSnapshotTransfer(tx, transfer.ID, true) }); err != nil {
				return err
			}
			continue
		}
		var journal *snapshotHelperJournal
		if transfer.HelperID != nil {
			var record snapshotHelperJournal
			if strictMetadata([]byte(*transfer.HelperID), &record) != nil {
				return corestore.ErrStorage
			}
			journal = &record
		}
		var pack corestore.SnapshotPackage
		if transfer.PackageID != nil {
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var err error
				pack, err = corestore.ReadSnapshotPackage(tx, *transfer.PackageID)
				return err
			}); err != nil {
				return err
			}
		}
		if err := a.cleanupSnapshotUpload(ctx, transfer, journal, pack.State == "ready"); err != nil {
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				return corestore.UpdateSnapshotTransfer(tx, transfer.ID, "cleanup-pending", packageNow(), transfer.HelperID)
			}); err != nil {
				return err
			}
		}
	}
	if err := a.cleanSnapshotTransferSpools(ctx); err != nil {
		return err
	}
	return a.collectSnapshotGarbage(ctx, time.Now())
}

type snapshotUploadOwner struct {
	TransferID  string `json:"transferId"`
	PackageID   string `json:"packageId"`
	OwnerUserID string `json:"ownerUserId"`
}

// A completed transfer can crash between its SQL commit and spool removal.
// Only a Core-owned marker and retained package receipt prove cleanup ownership.
func (a *Application) cleanSnapshotTransferSpools(ctx context.Context) error {
	a.snapshotStorageMu.Lock()
	defer a.snapshotStorageMu.Unlock()
	area, err := a.Store.OpenSnapshotArea("transfers")
	if err != nil {
		return err
	}
	defer area.Close()
	names, err := area.Entries()
	if err != nil {
		return err
	}
	for _, name := range names {
		if !validResourceID(name) {
			continue
		}
		if _, active := a.snapshotTransfers.Load(name); active {
			continue
		}
		var exists bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM snapshot_transfers WHERE id=?)`, name).Scan(&exists)
		}); err != nil {
			return err
		}
		if exists {
			continue
		}
		root, err := area.OpenPrivateDirectory(name)
		if err != nil {
			continue
		}
		raw, readErr := root.ReadFile("transfer-owner.json", 1<<20)
		root.Close()
		if readErr != nil {
			continue
		}
		var marker snapshotUploadOwner
		if strictMetadata(raw, &marker) != nil || marker.TransferID != name || !validResourceID(marker.PackageID) {
			continue
		}
		var pack corestore.SnapshotPackage
		err = a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			pack, err = corestore.ReadSnapshotPackage(tx, marker.PackageID)
			return err
		})
		if errors.Is(err, corestore.ErrNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		if pack.OwnerUserID != marker.OwnerUserID || pack.State == "staging" {
			continue
		}
		if err := area.RemoveTree(name); err != nil {
			return err
		}
	}
	return nil
}
