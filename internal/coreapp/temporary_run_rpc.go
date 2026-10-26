package coreapp

import (
	"context"
	"database/sql"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/agentclient"
	"piwork/internal/corestore"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/workaccess"
)

func (server *serviceRPC) temporaryRunAgent(ctx context.Context, actor serviceActor, workID string) (*agentclient.Client, corestore.WorkRecord, error) {
	var work corestore.WorkRecord
	err := server.App.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		work, err = server.App.authorizeServiceTx(tx, actor, workID, workaccess.Control)
		return err
	})
	if err != nil {
		return nil, work, rpcServiceError(err)
	}
	if actor.Runtime == nil || work.ActiveContextID == nil {
		return nil, work, status.Error(codes.FailedPrecondition, "current Run context is unavailable")
	}
	agent, lifetime, err := server.App.agentRoutes.Admission(*actor.Runtime, *work.ActiveContextID)
	if err != nil || lifetime.Err() != nil {
		return nil, work, status.Error(codes.Unavailable, "current Agent is unavailable")
	}
	return agent, work, nil
}

func (server *serviceRPC) OpenTemporaryRunLease(ctx context.Context, request *servicesv1.TemporaryRunRequest) (*servicesv1.TemporaryRunLease, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	agent, prior, err := server.temporaryRunAgent(ctx, actor, workID)
	if err != nil {
		return nil, err
	}
	check, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	run, err := agent.GetRun(check, request.GetRunId())
	if err != nil {
		return nil, status.Error(codes.Unavailable, "Run state is unavailable")
	}
	if run.GetState() != agentv1.RunState_RUN_STATE_RUNNING {
		return nil, status.Error(codes.FailedPrecondition, "Run is not accepting temporary work")
	}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: run.GetRunId(), Generation: actor.Runtime.Generation, InstanceID: actor.Runtime.InstanceID}
	if err := server.App.Store.EnableTemporaryServiceStorage(); err != nil {
		return nil, rpcServiceError(err)
	}
	var lease corestore.TemporaryRunLease
	err = server.App.Store.Write(ctx, func(tx *sql.Tx) error {
		work, err := server.App.authorizeServiceTx(tx, actor, workID, workaccess.Control)
		if err != nil {
			return err
		}
		if work.ControlVersion != prior.ControlVersion || work.ActiveContextID == nil || prior.ActiveContextID == nil || *work.ActiveContextID != *prior.ActiveContextID {
			return corestore.ErrTemporaryLeaseClosed
		}
		lease, err = corestore.OpenTemporaryRunLeaseTx(tx, owner, packageNow())
		return err
	})
	if err != nil {
		return nil, rpcServiceError(err)
	}
	return &servicesv1.TemporaryRunLease{LeaseId: lease.LeaseID}, nil
}

func (server *serviceRPC) CloseTemporaryRunLease(ctx context.Context, request *servicesv1.TemporaryRunRequest) (*servicesv1.Empty, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	agent, _, err := server.temporaryRunAgent(ctx, actor, workID)
	if err != nil {
		return nil, err
	}
	check, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	run, err := agent.GetRun(check, request.GetRunId())
	if err != nil {
		return nil, status.Error(codes.Unavailable, "Run state is unavailable")
	}
	if run.GetState() < agentv1.RunState_RUN_STATE_SUCCEEDED || run.GetState() > agentv1.RunState_RUN_STATE_INTERRUPTED {
		return nil, status.Error(codes.FailedPrecondition, "Run has not reached a terminal state")
	}
	trigger := map[agentv1.RunState]string{agentv1.RunState_RUN_STATE_SUCCEEDED: "run-succeeded", agentv1.RunState_RUN_STATE_FAILED: "run-failed", agentv1.RunState_RUN_STATE_CANCELLED: "run-cancelled", agentv1.RunState_RUN_STATE_INTERRUPTED: "run-interrupted"}[run.GetState()]
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: run.GetRunId(), Generation: actor.Runtime.Generation, InstanceID: actor.Runtime.InstanceID}
	if err := server.App.Store.EnableTemporaryServiceStorage(); err != nil {
		return nil, rpcServiceError(err)
	}
	var services []corestore.TemporaryServiceRecord
	err = server.App.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := server.App.authorizeServiceTx(tx, actor, workID, workaccess.Control); err != nil {
			return err
		}
		if err := corestore.CloseTemporaryRunLeaseTx(tx, owner, packageNow()); err != nil {
			return err
		}
		var err error
		services, err = corestore.ListTemporaryServicesTx(tx, workID, owner.RunID)
		if err != nil {
			return err
		}
		for _, service := range services {
			if service.Owner != owner {
				return corestore.ErrTemporaryIdentity
			}
			if err := corestore.BeginTemporaryCleanupTx(tx, service, trigger, packageNow()); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, rpcServiceError(err)
	}
	for _, service := range services {
		server.App.cancelSpecificServiceEffect(workID, service.ServiceID)
		if _, err := server.App.ensureTemporaryCleanupOperation(ctx, service, trigger); err != nil {
			return nil, rpcServiceError(err)
		}
	}
	return &servicesv1.Empty{}, nil
}
