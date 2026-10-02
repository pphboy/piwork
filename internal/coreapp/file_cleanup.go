package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"sync"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/fileprotocol"
)

func (a *Application) recoverFileJob(ctx context.Context, jobID string, explicit bool) error {
	value, _ := a.fileRecoveryLocks.LoadOrStore(jobID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return fileFailure(err)
	}
	defer lock.Unlock()
	var job corestore.FileJob
	var attempts []corestore.FileAttempt
	var temporaries []corestore.FileTemporary
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		job, err = corestore.ReadFileJob(tx, jobID)
		if err != nil {
			return err
		}
		attempts, err = corestore.FileAttempts(tx, jobID)
		if err != nil {
			return err
		}
		temporaries, err = corestore.FileTemporaries(tx, jobID)
		return err
	})
	if err != nil {
		return fileFailure(err)
	}
	if job.State == "cleaned" {
		return nil
	}
	if err := a.markFileCleanupPending(ctx, job.ID, fileprotocol.Failure("FILE_CLEANUP_REQUIRED")); err != nil {
		return fileFailure(err)
	}
	allRemoved := true
	for _, attempt := range attempts {
		allRemoved = allRemoved && attempt.State == "removed"
	}
	if allRemoved {
		for _, item := range temporaries {
			if item.State != "published" && item.State != "cleaned" && (item.Device == nil || item.Inode == nil) {
				return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
			}
		}
	}
	granted := false
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		var err error
		granted, err = corestore.ReserveFileCleanupRetry(tx, job.ID, packageNow(), explicit)
		return err
	}); err != nil {
		return fileFailure(err)
	}
	if !granted {
		return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
	}
	for _, attempt := range attempts {
		if err := a.retireFileAttempt(ctx, job, attempt); err != nil {
			return err
		}
	}
	items := []corestore.FileTemporary{}
	for _, item := range temporaries {
		if item.State == "published" || item.State == "cleaned" {
			continue
		}
		if item.Device == nil || item.Inode == nil {
			return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
		}
		items = append(items, item)
	}
	if len(items) > 0 {
		if err := a.cleanupFileTemporaries(ctx, job, items); err != nil {
			return err
		}
	}
	return fileFailure(a.Store.Write(ctx, func(tx *sql.Tx) error { return corestore.MarkFileCleaned(tx, job.ID, packageNow()) }))
}

// Cleanup is an independent journaled native helper attempt, with no business
// mutation replay. A failed/late cleanup create follows the same exit proof.
func (a *Application) cleanupFileTemporaries(ctx context.Context, job corestore.FileJob, items []corestore.FileTemporary) error {
	// Ten thousand temporary identities cannot fit into one 64 KiB control
	// frame. Each completed batch is durable; interrupted cleanup continues
	// with the remaining identities and never repeats the business request.
	for len(items) > 0 {
		bytes, count := 0, 0
		for count < len(items) {
			item := items[count]
			if item.Device == nil || item.Inode == nil {
				return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
			}
			size := len(jsonValue(map[string]any{"temporaryId": item.ID, "parentSegments": json.RawMessage(item.ParentSegmentsJSON), "name": item.Name, "device": *item.Device, "inode": *item.Inode})) + 1
			if size > fileprotocol.MaxControl-2048 {
				return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
			}
			if bytes+size > fileprotocol.MaxControl-2048 {
				break
			}
			bytes += size
			count++
		}
		if err := a.cleanupFileTemporaryBatch(ctx, job, items[:count]); err != nil {
			return err
		}
		items = items[count:]
	}
	return nil
}
func (a *Application) cleanupFileTemporaryBatch(ctx context.Context, job corestore.FileJob, items []corestore.FileTemporary) error {
	request, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if _, err := a.inspector.InspectNativeFileHelper(request, job.TrustedImageID); err != nil {
		return fileFailure(err)
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return fileFailure(err)
	}
	attempt := corestore.FileAttempt{ID: "attempt-" + id.String(), JobID: job.ID, Kind: "cleanup", Epoch: job.WorkEpoch, State: "planned", CreatedAt: packageNow(), UpdatedAt: packageNow()}
	attempt.ContainerName = dockerengine.FileHelperName(a.Store.InstallationID(), job.ID, attempt.ID)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertFileAttempt(tx, attempt); err != nil {
			return err
		}
		return corestore.UpdateFileAttempt(tx, attempt.ID, "planned", "creating", packageNow(), nil)
	}); err != nil {
		return fileFailure(err)
	}
	attempt.State = "creating"
	spec := fileAttemptSpec(job, attempt)
	created, err := a.dockerRuntime.EnsureFileHelper(request, spec)
	if err != nil {
		return fileFailure(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateFileAttempt(tx, attempt.ID, "creating", "created", packageNow(), &created.ID)
	}); err != nil {
		return fileFailure(err)
	}
	attempt.State = "created"
	attempt.ContainerID = &created.ID
	stream, err := a.dockerRuntime.AttachFileHelper(request, spec)
	if err != nil {
		return fileFailure(err)
	}
	defer stream.Close()
	if _, err := a.dockerRuntime.StartContainer(request, dockerengine.FileHelperIdentity(spec)); err != nil {
		return fileFailure(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		return corestore.UpdateFileAttempt(tx, attempt.ID, "created", "running", packageNow(), nil)
	}); err != nil {
		return fileFailure(err)
	}
	attempt.State = "running"
	temporaryPayload := []any{}
	for _, item := range items {
		var parent []string
		if json.Unmarshal([]byte(item.ParentSegmentsJSON), &parent) != nil {
			return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
		}
		temporaryPayload = append(temporaryPayload, map[string]any{"temporaryId": item.ID, "parentSegments": parent, "name": item.Name, "device": *item.Device, "inode": *item.Inode})
	}
	payload := map[string]any{"version": 1, "jobId": job.ID, "workId": job.WorkID, "epoch": job.WorkEpoch, "action": "CLEANUP", "pathSegments": []string{}, "destinationSegments": nil, "depth": nil, "overwrite": nil, "conditions": map[string]any{"ifMatch": nil, "ifNoneMatch": nil, "ifModifiedSince": nil, "ifUnmodifiedSince": nil}, "range": nil, "expectedLength": nil, "temporaries": temporaryPayload}
	if err := fileprotocol.Write(stream, fileprotocol.Request, payload, true); err != nil {
		return err
	}
	if err := stream.CloseWrite(); err != nil {
		return fileFailure(err)
	}
	frame, err := fileprotocol.Read(stream, false)
	if err != nil {
		return err
	}
	if frame.Kind == fileprotocol.Error {
		failure, err := fileprotocol.Decode[contracts.FileHelperError](frame, "FileHelperErrorSchema")
		if err != nil {
			return err
		}
		return fileprotocol.Failure(failure.Code)
	}
	if frame.Kind != fileprotocol.Result {
		return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	result, err := fileprotocol.Decode[contracts.FileHelperResult](frame, "FileHelperResultSchema")
	if err != nil {
		return err
	}
	if result.Status != 204 || result.Bytes != 0 || result.Entries > int64(len(items)) {
		return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	var extra [1]byte
	if n, err := stream.Read(extra[:]); n != 0 || err != io.EOF {
		return fileprotocol.Failure("FILE_BACKEND_PROTOCOL_ERROR")
	}
	code, err := a.dockerRuntime.WaitFileHelperExit(request, spec)
	if err != nil || code != 0 {
		return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
	}
	if err := a.retireFileAttempt(request, job, attempt); err != nil {
		return err
	}
	return fileFailure(a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, item := range items {
			if err := corestore.MarkFileTemporary(tx, item.ID, job.ID, "cleaned", packageNow()); err != nil {
				return err
			}
		}
		return nil
	}))
}
