package coreapp

import (
	"context"
	"database/sql"
	"io"
	"sync/atomic"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/fileprotocol"
)

type fileRunning struct {
	Identity fileAccessIdentity
	Cancel   context.CancelCauseFunc
	Done     chan struct{}
}
type fileProgressIO struct {
	io.ReadWriter
	last *atomic.Int64
}

func (stream fileProgressIO) Read(buffer []byte) (int, error) {
	n, err := stream.ReadWriter.Read(buffer)
	if n > 0 {
		stream.last.Store(time.Now().UnixNano())
	}
	return n, err
}
func (stream fileProgressIO) Write(buffer []byte) (int, error) {
	n, err := stream.ReadWriter.Write(buffer)
	if n > 0 {
		stream.last.Store(time.Now().UnixNano())
	}
	return n, err
}

func (a *Application) executeFileJob(parent context.Context, input fileExecutionInput) (result fileExecutionResult, returned error) {
	a.mu.Lock()
	if a.closed {
		a.mu.Unlock()
		return result, fileprotocol.Failure("FILE_RUNTIME_UNAVAILABLE")
	}
	a.fileWG.Add(1)
	a.mu.Unlock()
	defer a.fileWG.Done()
	budget, stopBudget := context.WithTimeout(parent, fileprotocol.RequestTimeout)
	defer stopBudget()
	ctx, cancel := context.WithCancelCause(budget)
	defer cancel(nil)
	if input.CancelIO != nil {
		stop := context.AfterFunc(ctx, input.CancelIO)
		defer stop()
	}
	stopLifetime := context.AfterFunc(a.ctx, func() { cancel(fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")) })
	defer stopLifetime()
	job, attempt, err := a.acceptFileJob(ctx, input)
	if err != nil {
		return result, err
	}
	running := &fileRunning{Identity: input.Identity, Cancel: cancel, Done: make(chan struct{})}
	a.fileJobs.Store(job.ID, running)
	defer func() { a.fileJobs.Delete(job.ID); close(running.Done) }()
	// Cancellation must also release a caller's blocked upload read. The HTTP
	// layer sets its connection deadlines when this request context is closed.
	if input.Body != nil {
		stop := context.AfterFunc(ctx, func() { input.Body.Close() })
		defer stop()
	}
	var last, firstFrameDeadline atomic.Int64
	last.Store(time.Now().UnixNano())
	firstFrameDeadline.Store(time.Now().Add(10 * time.Second).UnixNano())
	watchDone := make(chan struct{})
	watchContext, stopWatch := context.WithCancel(ctx)
	go func() {
		defer close(watchDone)
		a.watchFileTransfer(watchContext, cancel, job, &last, &firstFrameDeadline)
	}()
	defer func() { stopWatch(); <-watchDone }()
	var successfulResult *fileExecutionResult
	defer func() {
		if returned == nil {
			return
		}
		stopWatch()
		<-watchDone
		if ctx.Err() != nil {
			returned = fileFailure(context.Cause(ctx))
		}
		cleanup, stop := context.WithTimeout(context.Background(), 15*time.Second)
		defer stop()
		if err := a.markFileCleanupPending(cleanup, job.ID, returned); err != nil {
			returned = fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
			return
		}
		if err := a.recoverFileJob(cleanup, job.ID, false); err != nil {
			if successfulResult != nil {
				returned = fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
			}
			return
		}
		if successfulResult != nil && ctx.Err() == nil {
			result = *successfulResult
			returned = nil
		}
	}()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.UpdateFileJobState(tx, job.ID, "accepted", "starting", packageNow(), nil); err != nil {
			return err
		}
		return corestore.UpdateFileAttempt(tx, attempt.ID, "planned", "creating", packageNow(), nil)
	}); err != nil {
		return result, fileFailure(err)
	}
	attempt.State = "creating"
	spec := fileAttemptSpec(job, attempt)
	creation, stopCreate := context.WithTimeout(ctx, 10*time.Second)
	created, err := a.dockerRuntime.EnsureFileHelper(creation, spec)
	stopCreate()
	if err != nil {
		return result, fileFailure(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateFileAttempt(tx, attempt.ID, "creating", "created", packageNow(), &created.ID)
	}); err != nil {
		return result, fileFailure(err)
	}
	attempt.State = "created"
	attempt.ContainerID = &created.ID
	if _, _, err := a.validateFileAccess(ctx, input.Identity); err != nil {
		return result, err
	}
	firstFrameDeadline.Store(time.Now().Add(10 * time.Second).UnixNano())
	stream, err := a.dockerRuntime.AttachFileHelper(ctx, spec)
	if err != nil {
		return result, fileFailure(err)
	}
	defer stream.Close()
	if _, err := a.dockerRuntime.StartContainer(ctx, dockerengine.FileHelperIdentity(spec)); err != nil {
		return result, fileFailure(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.UpdateFileAttempt(tx, attempt.ID, "created", "running", packageNow(), nil); err != nil {
			return err
		}
		return corestore.UpdateFileJobState(tx, job.ID, "starting", "running", packageNow(), nil)
	}); err != nil {
		return result, fileFailure(err)
	}
	attempt.State = "running"
	result, err = a.exchangeFileFrames(ctx, fileProgressIO{stream, &last}, job, input, func() { firstFrameDeadline.Store(0) })
	if err != nil {
		return result, err
	}
	if err := stream.CloseWrite(); err != nil {
		return result, fileFailure(err)
	}
	// No extra frame or stray stdout is accepted after RESULT.
	var extra [1]byte
	if n, err := stream.Read(extra[:]); n != 0 || err != io.EOF {
		return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	exit, stopExit := context.WithTimeout(ctx, 10*time.Second)
	code, err := a.dockerRuntime.WaitFileHelperExit(exit, spec)
	stopExit()
	if err != nil || code != 0 {
		return result, fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	// From here the request process has exited. Recovery may temporarily mark
	// its own job cleanup-pending, so stop the live-transfer qualification loop.
	stopWatch()
	<-watchDone
	successfulResult = &result
	if err := a.retireFileAttempt(ctx, job, attempt); err != nil {
		return result, err
	}
	if result.Status == 207 && len(result.Failures) > 0 {
		if err := a.markFileCleanupPending(ctx, job.ID, fileprotocol.Failure("FILE_CLEANUP_REQUIRED")); err != nil {
			return result, fileFailure(err)
		}
		if err := a.recoverFileJob(ctx, job.ID, false); err != nil {
			return result, err
		}
	} else {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			items, err := corestore.FileTemporaries(tx, job.ID)
			if err != nil {
				return err
			}
			for _, item := range items {
				if err := corestore.MarkFileTemporary(tx, item.ID, job.ID, "published", packageNow()); err != nil {
					return err
				}
			}
			current, err := corestore.ReadFileJob(tx, job.ID)
			if err != nil {
				return err
			}
			if err := corestore.UpdateFileJobState(tx, job.ID, current.State, "finished", packageNow(), nil); err != nil {
				return err
			}
			return corestore.MarkFileCleaned(tx, job.ID, packageNow())
		}); err != nil {
			return result, fileFailure(err)
		}
	}
	if ctx.Err() != nil {
		return result, fileFailure(context.Cause(ctx))
	}
	return result, nil
}
func (a *Application) watchFileTransfer(ctx context.Context, cancel context.CancelCauseFunc, job corestore.FileJob, last, startup *atomic.Int64) {
	timer := time.NewTicker(200 * time.Millisecond)
	defer timer.Stop()
	nextFull := time.Now().Add(time.Second)
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-timer.C:
			if now.Sub(time.Unix(0, last.Load())) >= fileprotocol.IdleTimeout || startup.Load() != 0 && now.UnixNano() >= startup.Load() {
				cancel(fileprotocol.Failure("FILE_TRANSFER_TIMEOUT"))
				return
			}
			check, stop := context.WithTimeout(ctx, 750*time.Millisecond)
			err := a.Store.Read(check, func(tx *sql.Tx) error {
				current, err := corestore.ReadFileJob(tx, job.ID)
				if err != nil {
					return err
				}
				gate, err := corestore.ReadFileGate(tx, job.WorkID)
				if err != nil {
					return err
				}
				if current.State == "committing" && gate.Closed {
					grantedAt, err := time.Parse(time.RFC3339Nano, current.UpdatedAt)
					if err != nil || now.Sub(grantedAt) > 10*time.Second {
						return fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
					}
					var valid bool
					if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM login_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.user_id=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.enabled=1)`, job.SessionID, job.OwnerUserID, packageNow()).Scan(&valid); err != nil {
						return err
					}
					if !valid {
						return fileprotocol.Failure("AUTH_REQUIRED")
					}
					nextFull = now.Add(time.Second)
					return nil
				}
				return corestore.AssertFileAccess(tx, job.WorkID, job.OwnerUserID, job.SessionID, packageNow())
			})
			if err == nil && !now.Before(nextFull) {
				_, _, err = a.validateFileAccess(check, fileAccessIdentity{WorkID: job.WorkID, OwnerUserID: job.OwnerUserID, SessionID: job.SessionID, RuntimeGeneration: job.RuntimeGeneration})
				nextFull = now.Add(time.Second)
			}
			stop()
			if err != nil {
				if ctx.Err() != nil {
					return
				}
				cancel(fileFailure(err))
				return
			}
		}
	}
}
