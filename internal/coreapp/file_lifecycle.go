package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/fileprotocol"
)

// Close admission before waiting. Already granted commits get at most ten
// seconds; other requests are cancelled. A retained journal blocks only its Work.
func (a *Application) closeWorkFiles(ctx context.Context, workID string) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		gate, err := corestore.ReadFileGate(tx, workID)
		if err == nil && gate.Closed {
			return nil
		}
		if err != nil && !errors.Is(err, corestore.ErrNotFound) {
			return err
		}
		_, err = corestore.CloseFileGate(tx, workID, packageNow())
		return err
	})
}
func (a *Application) cancelWorkFiles(ctx context.Context, workID string, includeCommits bool) {
	a.fileJobs.Range(func(key, value any) bool {
		running := value.(*fileRunning)
		if running.Identity.WorkID != workID {
			return true
		}
		committing := false
		if !includeCommits {
			_ = a.Store.Read(ctx, func(tx *sql.Tx) error {
				job, err := corestore.ReadFileJob(tx, key.(string))
				if err == nil {
					committing = job.State == "committing"
				}
				return err
			})
		}
		if !committing {
			running.Cancel(fileprotocol.Failure("WORK_FILES_UNAVAILABLE"))
		}
		return true
	})
}
func (a *Application) settleWorkFiles(parent context.Context, workID string, explicit bool) error {
	if err := a.closeWorkFiles(parent, workID); err != nil {
		return err
	}
	a.cancelWorkFiles(parent, workID, false)
	grace, stop := context.WithTimeout(parent, 10*time.Second)
	var waiting []*fileRunning
	a.fileJobs.Range(func(_, value any) bool {
		running := value.(*fileRunning)
		if running.Identity.WorkID == workID {
			waiting = append(waiting, running)
		}
		return true
	})
	for _, running := range waiting {
		select {
		case <-running.Done:
		case <-grace.Done():
		}
	}
	stop()
	a.cancelWorkFiles(parent, workID, true)
	cleanup, finish := context.WithTimeout(parent, 15*time.Second)
	defer finish()
	for _, running := range waiting {
		select {
		case <-running.Done:
		case <-cleanup.Done():
			return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
		}
	}
	var jobs []corestore.FileJob
	if err := a.Store.Read(cleanup, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PendingFileJobs(tx, &workID); return err }); err != nil {
		return err
	}
	var failures []error
	for _, job := range jobs {
		if err := a.recoverFileJob(cleanup, job.ID, explicit); err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}

// The new Core epoch is already durable. Close old gates and retire attempts
// before admitting restored Agents. Cleanup never replays the original action.
func (a *Application) recoverCoreFiles(ctx context.Context) (map[string]bool, error) {
	var jobs []corestore.FileJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PendingFileJobs(tx, nil); return err }); err != nil {
		return nil, err
	}
	works := map[string]bool{}
	for _, job := range jobs {
		works[job.WorkID] = true
	}
	blocked := map[string]bool{}
	if len(works) > 0 {
		if _, err := a.requireFileImage(); err != nil {
			// Preserve the journal and Work until this process can recover its
			// helper. Other Works can still complete startup recovery.
			return works, nil
		}
	}
	for id := range works {
		if err := a.settleWorkFiles(ctx, id, false); err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			blocked[id] = true
		}
	}
	return blocked, nil
}

func (a *Application) scheduleFileRecovery(ctx context.Context) {
	if _, err := a.requireFileImage(); err != nil {
		return
	}
	var jobs []corestore.FileJob
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { var err error; jobs, err = corestore.PendingFileJobs(tx, nil); return err }); err != nil {
		return
	}
	for _, job := range jobs {
		if job.CoreEpoch == a.fileEpoch && job.State != "cleanup-pending" {
			continue
		}
		if _, live := a.fileJobs.Load(job.ID); live {
			continue
		}
		if _, active := a.fileRecoveryActive.LoadOrStore(job.ID, true); active {
			continue
		}
		a.mu.Lock()
		if a.closed {
			a.mu.Unlock()
			a.fileRecoveryActive.Delete(job.ID)
			return
		}
		a.fileWG.Add(1)
		a.mu.Unlock()
		go func(job corestore.FileJob) {
			defer a.fileWG.Done()
			defer a.fileRecoveryActive.Delete(job.ID)
			budget, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			if err := a.recoverFileJob(budget, job.ID, false); err != nil {
				return
			}
			// A pending user Operation keeps its original identity and resumes.
			a.enqueueWork(job.WorkID)
			a.restoreAfterFileCleanup(budget, job.WorkID)
		}(job)
	}
}

func (a *Application) restoreAfterFileCleanup(ctx context.Context, workID string) {
	var work corestore.WorkRecord
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		work, err = corestore.ReadWork(tx, workID, false)
		if err != nil {
			return err
		}
		if work.DesiredState != "running" {
			return errWorkSuperseded
		}
		var busy bool
		if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM operations WHERE work_id=? AND state IN ('pending','running'))`, workID).Scan(&busy); err != nil {
			return err
		}
		if busy {
			return errWorkSuperseded
		}
		pending, err := corestore.PendingFileJobs(tx, &workID)
		if err != nil {
			return err
		}
		if len(pending) != 0 {
			return errWorkSuperseded
		}
		return nil
	}); err != nil {
		return
	}
	if work.ObservedState != "failed" {
		return
	}
	if err := a.ensureInitialWorkContext(ctx, workID); err != nil {
		return
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		return
	}
	if record, err := a.Store.RuntimeGeneration(ctx, workID, generation); err == nil && !runtimeRetryPermitted(record, time.Now().UTC()) {
		return
	}
	if _, err := a.startCapturedWork(ctx, workID, generation, instance); err != nil && ctx.Err() == nil && !errors.Is(err, errWorkSuperseded) {
		_ = a.recordRecoveryFailure(ctx, workID, generation)
	}
}
