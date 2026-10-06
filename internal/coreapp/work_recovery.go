package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"strconv"
	"sync"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/safefs"
)

// recoverCapturedWorks adopts only known, exact-identity Agent generations.
// Pending package/file/snapshot jobs still need their own recoverers before
// this can serve as the complete Core startup gate.
func (a *Application) recoverCapturedWorks(ctx context.Context) error {
	if a.workRuntime == nil || a.dockerRuntime == nil {
		return errRecoveryRequired
	}
	var workIDs []string
	blockedFiles, err := a.recoverCoreFiles(ctx)
	if err != nil {
		return err
	}
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM works WHERE deleted_at IS NULL ORDER BY id`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			workIDs = append(workIDs, id)
		}
		if err := rows.Err(); err != nil {
			return err
		}
		var deleted int
		if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM works WHERE deleted_at IS NOT NULL AND observed_state!='deleted'`).Scan(&deleted); err != nil {
			return err
		}
		if deleted != 0 {
			return errRecoveryRequired
		}
		return nil
	})
	if err != nil {
		return err
	}
	pending, err := a.Store.PendingOperations(ctx)
	if err != nil {
		return err
	}
	for _, operation := range pending {
		if operation.Kind == "export-work" || operation.Kind == "import-work" || operation.Kind == "pi-package-install" || operation.Kind == "pi-package-update" || isServiceOperation(operation.Kind) {
			continue
		}
		if operation.Kind != "create-work" && operation.Kind != "start-work" && operation.Kind != "stop-work" && operation.Kind != "retry-work" && operation.Kind != "delete-work" && operation.Kind != applyOperationKind {
			return errRecoveryRequired
		}
	}
	known := make(map[string]bool, len(workIDs))
	blockedSnapshots := make(map[string]bool)
	for _, id := range workIDs {
		known[id] = true
		var locked bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM work_snapshot_locks WHERE work_id=?)`, id).Scan(&locked)
		}); err != nil {
			return err
		}
		blockedSnapshots[id] = locked
	}
	managed, err := a.dockerRuntime.ListContainers(ctx, "agent")
	if err != nil {
		return err
	}
	count := make(map[string]int)
	for _, item := range managed {
		if item.Config == nil {
			return errRecoveryRequired
		}
		id := item.Config.Labels[dockerengine.WorkLabel]
		if !known[id] {
			// Unknown instances are reported and retained for operator review.
			if safefs.ValidFileName(id) {
				log.Printf("piwork: orphaned managed Agent for Work %s", id)
			} else {
				log.Print("piwork: orphaned managed Agent with invalid Work identity")
			}
			continue
		}
		count[id]++
		if count[id] > 1 {
			return errRecoveryRequired
		}
	}
	for _, id := range workIDs {
		if blockedSnapshots[id] {
			continue
		}
		if blockedFiles[id] {
			if _, err := a.requireFileImage(); err != nil {
				continue
			}
			// Stop runtime resources even if a helper's absence remains unknown.
			_ = a.stopAcceptedWork(ctx, id)
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`UPDATE works SET observed_state='failed',updated_at=? WHERE id=?`, packageNow(), id)
				return err
			}); err != nil {
				return err
			}
			continue
		}
		for {
			processed, err := a.processOneWorkOperation(ctx, id)
			if err != nil {
				return err
			}
			if !processed {
				break
			}
		}
		work, err := a.Store.Work(ctx, id, false)
		if errors.Is(err, corestore.ErrNotFound) {
			// A recovered delete committed its terminal Operation and Work
			// tombstone together while processing the pending queue.
			continue
		}
		if err != nil {
			return err
		}
		if work.DesiredState == "running" {
			// A previous Core may have persisted ready before it crashed.
			// Recheck Docker and Agent readiness before exposing the route.
			if err := a.ensureInitialWorkContext(ctx, id); err != nil {
				return err
			}
			generation, instanceID, err := a.selectAgentGeneration(ctx, work)
			if err != nil {
				return err
			}
			if persisted, err := a.Store.RuntimeGeneration(ctx, id, generation); err == nil {
				if !runtimeRetryPermitted(persisted, time.Now().UTC()) {
					continue
				}
			} else if !errors.Is(err, corestore.ErrNotFound) {
				return err
			}
			if _, err := a.startCapturedWork(ctx, id, generation, instanceID); err != nil && !errors.Is(err, errWorkSuperseded) {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if err := a.recordRecoveryFailure(ctx, id, generation); err != nil {
					return err
				}
			}
		} else if work.DesiredState == "stopped" {
			if err := a.stopAcceptedWork(ctx, id); err != nil {
				return err
			}
		} else {
			return errRecoveryRequired
		}
	}
	return nil
}

func runtimeRetryPermitted(value corestore.RuntimeGeneration, at time.Time) bool {
	if value.State == "recovering" && value.NextRetryAt != nil {
		due, err := time.Parse(time.RFC3339Nano, *value.NextRetryAt)
		return err == nil && !at.Before(due)
	}
	if value.State == "failed" && value.RetryCount >= 3 {
		// Exhaustion is terminal until a user explicitly retries. Merely
		// restarting Core or waiting for the old window must not refill it.
		return false
	}
	return true
}

func (a *Application) recordRecoveryFailure(ctx context.Context, workID string, generation int64) error {
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.DesiredState != "running" {
		return err
	}
	_, err = a.Store.RuntimeGeneration(ctx, workID, generation)
	if err == nil {
		_, err = a.Store.RecordRuntimeFailure(ctx, workID, generation, time.Now().UTC())
	} else if errors.Is(err, corestore.ErrNotFound) {
		err = nil
	}
	if err != nil {
		return err
	}
	if safefs.ValidFileName(workID) {
		log.Printf("piwork: Work %s Agent recovery attempt failed", workID)
	} else {
		log.Print("piwork: Work Agent recovery attempt failed")
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `UPDATE works SET observed_state='failed',updated_at=? WHERE id=? AND desired_state='running'`, time.Now().UTC().Format(time.RFC3339Nano), workID)
		return err
	})
}

func (a *Application) runtimeRecoveryLoop() {
	defer a.recoveryWG.Done()
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()
	probe := time.NewTicker(2 * time.Second)
	defer probe.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-probe.C:
			a.scheduleFileRecovery(a.ctx)
			a.reconcileReadyAgents(a.ctx)
			a.reconcileServices(a.ctx)
			continue
		case <-ticker.C:
		}
		due, err := a.Store.DueRuntimeRetries(a.ctx, time.Now().UTC())
		if err != nil {
			continue
		}
		for _, generation := range due {
			if a.ctx.Err() != nil {
				return
			}
			a.recoverDueGeneration(a.ctx, generation)
		}
		_ = a.resetStableGenerations(a.ctx)
	}
}

// A ready route can outlive an Agent process. Probe the exact managed Docker
// identity; only a confirmed absent/stopped instance consumes recovery budget.
func (a *Application) reconcileReadyAgents(ctx context.Context) {
	if a.dockerRuntime == nil {
		return
	}
	var ready []struct {
		workID, instanceID, contextID string
		generation                    int64
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT g.work_id,g.generation,g.instance_id,COALESCE(w.active_context_id,w.desired_context_id,'')
			FROM runtime_generations g JOIN works w ON w.id=g.work_id
			WHERE g.state='ready' AND w.desired_state='running' AND w.deleted_at IS NULL
			AND g.generation=(SELECT MAX(newer.generation) FROM runtime_generations newer WHERE newer.work_id=g.work_id)`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item struct {
				workID, instanceID, contextID string
				generation                    int64
			}
			if err := rows.Scan(&item.workID, &item.generation, &item.instanceID, &item.contextID); err != nil {
				return err
			}
			ready = append(ready, item)
		}
		return rows.Err()
	}); err != nil {
		return
	}
	for _, item := range ready {
		if ctx.Err() != nil {
			return
		}
		value, _ := a.workLocks.LoadOrStore(item.workID, &sync.Mutex{})
		lock := value.(*sync.Mutex)
		if err := lockWorkContext(ctx, lock); err != nil {
			return
		}
		func() {
			defer lock.Unlock()
			current, err := a.Store.RuntimeGeneration(ctx, item.workID, item.generation)
			if err != nil || current.State != "ready" || current.InstanceID == nil || *current.InstanceID != item.instanceID {
				return
			}
			work, err := a.Store.Work(ctx, item.workID, false)
			if err != nil || work.DesiredState != "running" {
				return
			}
			probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			view, err := a.dockerRuntime.InspectContainer(probeCtx, dockerengine.ContainerIdentity{
				WorkID: item.workID, Kind: "agent", LogicalID: "agentd", Labels: map[string]string{
					"piwork.generation": strconv.FormatInt(item.generation, 10), "piwork.instance_id": item.instanceID,
					"piwork.protocol_version": "v2", "piwork.context_identity": item.contextID,
				},
			})
			cancel()
			if err != nil || view != nil && view.State != nil && view.State.Running {
				return
			}
			if view != nil && view.State == nil {
				return
			}
			if client := a.agentRoutes.Revoke(item.workID); client != nil {
				client.Close()
			}
			_ = a.recordRecoveryFailure(ctx, item.workID, item.generation)
		}()
	}
}

func (a *Application) recoverDueGeneration(ctx context.Context, generation corestore.RuntimeGeneration) {
	if generation.InstanceID == nil {
		return
	}
	work, err := a.Store.Work(ctx, generation.WorkID, false)
	if err != nil || work.DesiredState != "running" {
		return
	}
	if _, err := a.startCapturedWork(ctx, generation.WorkID, generation.Generation, *generation.InstanceID); err != nil {
		if errors.Is(err, errWorkSuperseded) || ctx.Err() != nil {
			return
		}
		_ = a.recordRecoveryFailure(ctx, generation.WorkID, generation.Generation)
	}
}

func (a *Application) resetStableGenerations(ctx context.Context) error {
	var items []struct {
		workID     string
		generation int64
	}
	cutoff := time.Now().UTC().Add(-10 * time.Minute).Format(time.RFC3339Nano)
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT work_id,generation FROM runtime_generations WHERE state='ready' AND retry_count>0 AND ready_since<=?`, cutoff)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var item struct {
				workID     string
				generation int64
			}
			if err := rows.Scan(&item.workID, &item.generation); err != nil {
				return err
			}
			items = append(items, item)
		}
		return rows.Err()
	})
	if err != nil {
		return err
	}
	for _, item := range items {
		if _, err := a.Store.ResetStableRuntimeRetryBudget(ctx, item.workID, item.generation, time.Now().UTC()); err != nil {
			return err
		}
	}
	return nil
}

// shutdownCapturedWorks stops each known Work independently. A failure in one
// Work does not prevent attempts on the others; Close reports nonzero status.
func (a *Application) shutdownCapturedWorks(ctx context.Context) error {
	var ids []string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT DISTINCT g.work_id FROM runtime_generations g JOIN works w ON w.id=g.work_id WHERE w.deleted_at IS NULL ORDER BY g.work_id`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	})
	if err != nil || len(ids) == 0 {
		return err
	}
	if a.workRuntime == nil {
		return errRecoveryRequired
	}
	var group sync.WaitGroup
	failures := make(chan error, len(ids))
	for _, id := range ids {
		group.Add(1)
		go func(id string) {
			defer group.Done()
			if err := a.stopCapturedWork(ctx, id, a.options.WorkDrainTimeout, a.options.WorkStopTimeout); err != nil {
				failures <- err
			}
		}(id)
	}
	group.Wait()
	close(failures)
	for err := range failures {
		if err != nil {
			return errors.New("one or more Work runtimes could not be stopped")
		}
	}
	return nil
}
