package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/filehelper"
	"piwork/internal/fileprotocol"
)

type fileConditions struct {
	IfMatch           json.RawMessage `json:"ifMatch"`
	IfNoneMatch       json.RawMessage `json:"ifNoneMatch"`
	IfModifiedSince   json.RawMessage `json:"ifModifiedSince"`
	IfUnmodifiedSince json.RawMessage `json:"ifUnmodifiedSince"`
}
type fileExecutionInput struct {
	Identity                                fileAccessIdentity
	Action                                  string
	Path, Destination                       []string
	Depth, Overwrite, Range, ExpectedLength any
	Conditions                              fileConditions
	Body                                    io.ReadCloser
	OnMeta                                  func(contracts.FileHelperMeta) error
	OnData                                  func([]byte) error
	CancelIO                                func()
}
type fileExecutionResult struct {
	contracts.FileHelperResult
	Failures []contracts.FileHelperError
}

func jsonValue(value any) json.RawMessage { raw, _ := json.Marshal(value); return raw }

func (a *Application) acceptFileJob(ctx context.Context, input fileExecutionInput) (corestore.FileJob, corestore.FileAttempt, error) {
	var job corestore.FileJob
	var attempt corestore.FileAttempt
	if err := filehelper.ValidateSegments(input.Path); err != nil {
		return job, attempt, err
	}
	if input.Destination != nil {
		if err := filehelper.ValidateSegments(input.Destination); err != nil {
			return job, attempt, err
		}
	}
	image, err := a.requireFileImage()
	if err != nil {
		return job, attempt, err
	}
	if _, _, err := a.validateFileAccess(ctx, input.Identity); err != nil {
		return job, attempt, err
	}
	jobID, err := uuid.NewRandom()
	if err != nil {
		return job, attempt, fileFailure(err)
	}
	attemptID, err := uuid.NewRandom()
	if err != nil {
		return job, attempt, fileFailure(err)
	}
	accepted := time.Now().UTC()
	job = corestore.FileJob{ID: "filejob-" + jobID.String(), WorkID: input.Identity.WorkID, OwnerUserID: input.Identity.OwnerUserID, SessionID: input.Identity.SessionID, CoreEpoch: a.fileEpoch, RuntimeGeneration: input.Identity.RuntimeGeneration,
		Kind: input.Action, State: "accepted", TrustedImageID: image, PathSegmentsJSON: string(jsonValue(input.Path)), AcceptedAt: accepted.Format(time.RFC3339Nano), DeadlineAt: accepted.Add(fileprotocol.RequestTimeout).Format(time.RFC3339Nano), UpdatedAt: accepted.Format(time.RFC3339Nano)}
	if input.Destination != nil {
		raw := string(jsonValue(input.Destination))
		job.DestinationSegmentsJSON = &raw
	}
	attempt = corestore.FileAttempt{ID: "attempt-" + attemptID.String(), JobID: job.ID, Kind: "request", State: "planned", CreatedAt: job.AcceptedAt, UpdatedAt: job.AcceptedAt}
	attempt.ContainerName = dockerengine.FileHelperName(a.Store.InstallationID(), job.ID, attempt.ID)
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT runtime_name FROM volume_records WHERE work_id=? AND installation_id=? AND volume_role='workspace' AND state='active'`, job.WorkID, a.Store.InstallationID())
		if err != nil {
			return err
		}
		count := 0
		for rows.Next() {
			count++
			if err := rows.Scan(&job.VolumeName); err != nil {
				rows.Close()
				return err
			}
		}
		rowErr := rows.Err()
		rows.Close()
		if rowErr != nil {
			return rowErr
		}
		if count != 1 {
			return fileprotocol.Failure("FILE_RUNTIME_UNAVAILABLE")
		}
		accepted, err := corestore.AcceptFileJob(tx, job, &attempt)
		if err != nil {
			return err
		}
		job = accepted
		attempt.Epoch = job.WorkEpoch
		return nil
	})
	return job, attempt, fileFailure(err)
}
func fileAttemptSpec(job corestore.FileJob, attempt corestore.FileAttempt) dockerengine.FileHelperSpec {
	return dockerengine.FileHelperSpec{WorkID: job.WorkID, JobID: job.ID, AttemptID: attempt.ID, Epoch: attempt.Epoch, ImageID: job.TrustedImageID, VolumeName: job.VolumeName, ReadOnly: attempt.Kind == "request" && !fileprotocol.Mutation(job.Kind)}
}
