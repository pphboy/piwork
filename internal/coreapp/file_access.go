package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"strconv"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/fileprotocol"
	"piwork/internal/internaltls"
	"piwork/internal/workfiles"
)

type fileAccessIdentity struct {
	WorkID, OwnerUserID, SessionID string
	RuntimeGeneration              int64
}

func fileFailure(err error) error {
	if err == nil {
		return nil
	}
	var repository *corestore.RepositoryError
	if errors.As(err, &repository) {
		if _, known := workfiles.Status[repository.Code()]; known {
			return fileprotocol.Failure(repository.Code())
		}
	}
	if errors.Is(err, corestore.ErrNotFound) || errors.Is(err, sql.ErrNoRows) {
		return fileprotocol.Failure("NOT_FOUND")
	}
	if errors.Is(err, corestore.ErrSnapshotBusy) {
		return fileprotocol.Failure("WORK_SNAPSHOT_BUSY")
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
	}
	if fileprotocol.Code(err) != "FILE_RUNTIME_UNAVAILABLE" {
		return err
	}
	return fileprotocol.Failure("FILE_RUNTIME_UNAVAILABLE")
}

// Recheck DB authorization both before and after the actual Docker/Agent
// checks. A ready record cannot substitute for a currently bound instance.
func (a *Application) validateFileAccess(ctx context.Context, identity fileAccessIdentity) (corestore.WorkRecord, context.Context, error) {
	var work corestore.WorkRecord
	var generation int64
	var instance, state string
	read := func() error {
		return a.Store.Read(ctx, func(tx *sql.Tx) error {
			if err := corestore.AssertFileAccess(tx, identity.WorkID, identity.OwnerUserID, identity.SessionID, packageNow()); err != nil {
				return err
			}
			var err error
			work, err = corestore.ReadWork(tx, identity.WorkID, false)
			if err != nil {
				return err
			}
			return tx.QueryRowContext(ctx, `SELECT generation,instance_id,state FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, identity.WorkID).Scan(&generation, &instance, &state)
		})
	}
	if err := read(); err != nil {
		return work, nil, fileFailure(err)
	}
	if a.dockerRuntime == nil || generation < 1 || state != "ready" || instance == "" || work.ActiveContextID == nil || identity.RuntimeGeneration != 0 && generation != identity.RuntimeGeneration {
		return work, nil, fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work.ID, Generation: generation, InstanceID: instance}
	agent, lifetime, err := a.agentRoutes.Admission(scope, *work.ActiveContextID)
	if err != nil {
		return work, nil, fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	container, err := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: work.ID, Kind: "agent", LogicalID: "agentd", Labels: map[string]string{
		"piwork.generation": strconv.FormatInt(generation, 10), "piwork.instance_id": instance, "piwork.protocol_version": "v2", "piwork.context_identity": *work.ActiveContextID,
	}})
	if err != nil {
		return work, nil, fileprotocol.Failure("FILE_RUNTIME_UNAVAILABLE")
	}
	if container == nil || container.State == nil || !container.State.Running {
		return work, nil, fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	raw, err := a.Store.ControlMetadata(ctx, agentConfirmationKey(work.ID))
	var confirmed confirmedAgentInstance
	if err != nil || strictMetadata(raw, &confirmed) != nil || confirmed.ContainerID != container.ID {
		return work, nil, fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	query, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(lifetime, cancel)
	defer stop()
	if _, err := agent.Readiness(query, *work.ActiveContextID, false); err != nil {
		return work, nil, fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	oldGeneration, oldInstance, oldContext := generation, instance, *work.ActiveContextID
	if err := read(); err != nil {
		return work, nil, fileFailure(err)
	}
	if generation != oldGeneration || instance != oldInstance || state != "ready" || work.ActiveContextID == nil || *work.ActiveContextID != oldContext || lifetime.Err() != nil {
		return work, nil, fileprotocol.Failure("WORK_FILES_UNAVAILABLE")
	}
	return work, lifetime, nil
}
