package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/packagehelper"
	"piwork/internal/packageprepare"
	"piwork/internal/pipackage"
)

func (a *Application) recoverCorePackageJobs(ctx context.Context) error {
	var plans []dockerengine.ResourcePlan
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT work_id,resource_kind,logical_id,runtime_id,labels_json FROM resource_bindings WHERE installation_id=? AND resource_kind IN ('package-helper','package-volume','package-network')`, a.Store.InstallationID())
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var plan dockerengine.ResourcePlan
			var logical, raw string
			if err := rows.Scan(&plan.WorkID, &plan.Kind, &logical, &plan.Name, &raw); err != nil {
				return err
			}
			if !validResourceID(plan.WorkID) || !strings.HasPrefix(logical, plan.WorkID+"/") || json.Unmarshal([]byte(raw), &plan.Labels) != nil {
				return corestore.ErrStorage
			}
			plan.LogicalID = strings.TrimPrefix(logical, plan.WorkID+"/")
			plans = append(plans, plan)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	for _, plan := range plans {
		unsettled, err := a.Store.PackageCreationUnsettled(ctx, plan.WorkID, plan.Kind, plan.LogicalID, plan.Name)
		if err != nil {
			return err
		}
		if unsettled {
			a.dockerRuntime.MarkPackageCreationUncertain(plan.Name)
		}
	}
	// Settle every registered helper, including a pre-acceptance environment
	// probe interrupted before its Operation could exist.
	for _, plan := range plans {
		if plan.Kind == "package-helper" {
			if err := a.dockerRuntime.RemovePlannedPackageHelper(ctx, plan); err != nil {
				return errRecoveryRequired
			}
			if err := a.Store.ReleaseResourceIntent(ctx, plan.WorkID, plan.Kind, plan.LogicalID, true); err != nil {
				return err
			}
		}
	}
	resourceJobs := map[dockerengine.PackageIdentity]bool{}
	for _, plan := range plans {
		if plan.Kind == "package-volume" || plan.Kind == "package-network" {
			resourceJobs[dockerengine.PackageIdentity{WorkID: plan.WorkID, JobID: plan.LogicalID}] = true
		}
	}
	for id := range resourceJobs {
		if err := a.dockerRuntime.RemovePackageResources(ctx, id); err != nil {
			return errRecoveryRequired
		}
		if err := a.Store.ReleaseResourceIntent(ctx, id.WorkID, "package-volume", id.JobID, true); err != nil {
			return err
		}
		if err := a.Store.ReleaseResourceIntent(ctx, id.WorkID, "package-network", id.JobID, true); err != nil {
			return err
		}
	}
	var jobs []corestore.PackageJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PackageJobs(tx, true); return err }); err != nil {
		return err
	}
	for _, job := range jobs {
		// Take a fresh fence before recovery can publish or release leases.
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			var err error
			job, err = corestore.BumpPackageWorker(tx, job.OperationID, job.WorkerEpoch, packageNow())
			return err
		}); err != nil {
			return err
		}
		if job.Phase == "queued" {
			a.kickCorePackageJob(job.OperationID)
			continue
		}
		// Reading and revalidating a completed capture is static. Recovery can
		// publish it after confirmed cleanup without rerunning package scripts.
		operation, err := a.Store.Operation(ctx, job.OperationID)
		if err != nil {
			return err
		}
		if operation.State == "superseded" {
			if err := a.finishCorePackage(job, "prepare", errWorkSuperseded, false); err != nil {
				return err
			}
			_ = a.removeCorePackageJobRoot(job.OperationID)
			continue
		}
		var prior struct{ Code, Stage string }
		if operation.ErrorJSON != nil {
			_ = json.Unmarshal([]byte(*operation.ErrorJSON), &prior)
		}
		if operation.ErrorJSON == nil || prior.Code == "PI_PACKAGE_CLEANUP_PENDING" {
			if captured, err := a.recoverCapturedPackage(ctx, job); err == nil {
				// Restore an ordinary live publication phase after cleanup-pending.
				if job.Phase == "cleanup-pending" {
					if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
						_, err := tx.Exec(`UPDATE pi_package_jobs SET phase='validate',cleanup_error=NULL WHERE operation_id=? AND worker_epoch=? AND phase='cleanup-pending'`, job.OperationID, job.WorkerEpoch)
						return err
					}); err != nil {
						return err
					}
				}
				stage, err := a.publishCapturedCorePackage(ctx, job, captured)
				if err != nil {
					if err := a.finishCorePackage(job, stage, err, false); err != nil {
						return err
					}
				}
				_ = a.removeCorePackageJobRoot(job.OperationID)
				continue
			}
		}
		code, stage := "PI_PACKAGE_INTERRUPTED", job.Phase
		if packageSafeFailureCode(prior.Code) && prior.Code != "PI_PACKAGE_CLEANUP_PENDING" {
			code = prior.Code
			stage = prior.Stage
		}
		if err := a.finishCorePackage(job, stage, &pipackage.InputError{Code: code}, false); err != nil {
			return err
		}
		if err := a.removeCorePackageJobRoot(job.OperationID); err != nil && !errors.Is(err, corestore.ErrNotFound) {
			log.Print("piwork: package staging cleanup remains pending")
		}
	}
	if err := a.collectPackageJobGarbage(ctx, time.Now()); err != nil {
		return err
	}
	if err := a.collectPackageArtifactGarbage(ctx, time.Now()); err != nil {
		return err
	}
	return nil
}

func (a *Application) recoverCapturedPackage(ctx context.Context, job corestore.PackageJob) (packageprepare.Result, error) {
	spool := filepath.Join(a.options.DataDirectory, "pi-packages", "jobs", job.OperationID, "spool")
	root, err := os.OpenRoot(spool)
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer root.Close()
	f, err := root.OpenFile("result.json", os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return packageprepare.Result{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 64<<10 {
		return packageprepare.Result{}, packageprepare.ErrResult
	}
	raw, err := io.ReadAll(io.LimitReader(f, (64<<10)+1))
	if err != nil {
		return packageprepare.Result{}, err
	}
	if _, err := contracts.ParseJSON(bytes.NewReader(raw), 64<<10); err != nil {
		return packageprepare.Result{}, err
	}
	var captured packagehelper.Captured
	if json.Unmarshal(raw, &captured) != nil {
		return packageprepare.Result{}, packageprepare.ErrResult
	}
	environment, err := pipackage.ValidateEnvironment([]byte(job.PreparedEnvironmentJSON))
	if err != nil {
		return packageprepare.Result{}, err
	}
	name := "validation-" + job.OperationID
	if info, err := root.Lstat(name); err == nil {
		if !info.IsDir() {
			return packageprepare.Result{}, pipackage.ErrUnsafe
		}
		if err := root.RemoveAll(name); err != nil {
			return packageprepare.Result{}, err
		}
	}
	return packageprepare.ValidateCapture(ctx, spool, job.OperationID, environment, captured)
}
