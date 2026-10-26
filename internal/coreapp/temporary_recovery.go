package coreapp

import (
	"context"
	"database/sql"
	"strconv"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
)

func (a *Application) reconcileTemporaryServicesLocked(ctx context.Context, workID string) {
	work, err := a.Store.Work(ctx, workID, true)
	if err != nil {
		return
	}
	var records []corestore.TemporaryServiceRecord
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		records, err = corestore.ListTemporaryServicesTx(tx, workID, "")
		return err
	}); err != nil {
		return
	}
	for _, record := range records {
		if ctx.Err() != nil {
			return
		}
		var cleanup corestore.TemporaryCleanupRecord
		var cleaning bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			cleanup, cleaning, err = corestore.ReadTemporaryCleanupTx(tx, workID, record.ServiceID)
			return err
		}); err != nil {
			continue
		}
		if cleaning {
			if cleanup.State != "completed" {
				if _, err := a.ensureTemporaryCleanupOperation(ctx, record, cleanup.Trigger); err == nil {
					_ = a.cleanupTemporaryService(ctx, record)
				}
			}
			continue
		}
		var open bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			open, err = corestore.TemporaryRunOpenTx(tx, record.Owner)
			return err
		}); err != nil {
			continue
		}
		if open {
			if trigger := a.confirmTemporaryRunEnd(ctx, work, record.Owner); trigger != "" {
				if err := a.closeTemporaryRunAndRequestCleanup(ctx, record.Owner, trigger); err != nil {
					continue
				}
				open = false
			}
		}
		if open {
			_ = a.observeTemporaryCommand(ctx, record)
			continue
		}
		// A closed lease without its atomic cleanup request is unconfirmed;
		// do not invent a trigger or claim cleanup completed.
	}
}

// A disconnected observation is not evidence of an interrupted Run.
func (a *Application) confirmTemporaryRunEnd(ctx context.Context, work corestore.WorkRecord, owner corestore.TemporaryRunOwner) string {
	if work.DesiredState == "deleted" {
		return "work-delete"
	}
	if work.DesiredState == "stopped" {
		return "work-stop"
	}
	var latest int64
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT COALESCE(MAX(generation),0) FROM runtime_generations WHERE work_id=?`, owner.WorkID).Scan(&latest)
	})
	if err != nil {
		return ""
	}
	if latest > owner.Generation {
		return "agent-replaced"
	}
	if latest != owner.Generation || work.ActiveContextID == nil {
		return ""
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: owner.WorkID, Generation: owner.Generation, InstanceID: owner.InstanceID}
	if agent, lifetime, err := a.agentRoutes.Admission(scope, *work.ActiveContextID); err == nil && lifetime.Err() == nil {
		check, cancel := context.WithTimeout(ctx, 2*time.Second)
		run, err := agent.GetRun(check, owner.RunID)
		cancel()
		if err == nil {
			return terminalTemporaryTrigger(run.GetState())
		}
	}
	if a.dockerRuntime == nil {
		return ""
	}
	probe, cancel := context.WithTimeout(ctx, 3*time.Second)
	view, err := a.dockerRuntime.InspectContainer(probe, dockerengine.ContainerIdentity{WorkID: owner.WorkID, Kind: "agent", LogicalID: "agentd", Labels: map[string]string{"piwork.generation": strconv.FormatInt(owner.Generation, 10), "piwork.instance_id": owner.InstanceID}})
	cancel()
	if err != nil || view != nil && (view.State == nil || view.State.Running) {
		return ""
	}
	return "run-interrupted"
}

func (a *Application) closeTemporaryRunAndRequestCleanup(ctx context.Context, owner corestore.TemporaryRunOwner, trigger string) error {
	var records []corestore.TemporaryServiceRecord
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.CloseTemporaryRunLeaseTx(tx, owner, packageNow()); err != nil {
			return err
		}
		var err error
		records, err = corestore.ListTemporaryServicesTx(tx, owner.WorkID, owner.RunID)
		if err != nil {
			return err
		}
		for _, record := range records {
			if record.Owner != owner {
				return corestore.ErrTemporaryIdentity
			}
			if err := corestore.BeginTemporaryCleanupTx(tx, record, trigger, packageNow()); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		for _, record := range records {
			a.cancelSpecificServiceEffect(owner.WorkID, record.ServiceID)
			if _, createErr := a.ensureTemporaryCleanupOperation(ctx, record, trigger); createErr != nil {
				err = createErr
			}
		}
	}
	return err
}
