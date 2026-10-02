package coreapp

import (
	"database/sql"
	"errors"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/workaccess"
)

type serviceActor struct {
	User    *identity.Principal
	Runtime *internaltls.Scope
}

func (v serviceActor) key() string {
	if v.Runtime != nil {
		return "work-agent:" + v.Runtime.WorkID
	}
	if v.User != nil {
		return v.User.UserID
	}
	return ""
}
func (a *Application) authorizeServiceTx(tx *sql.Tx, actor serviceActor, workID string, action workaccess.Action) (corestore.WorkRecord, error) {
	work, err := corestore.ReadWork(tx, workID, false)
	if errors.Is(err, corestore.ErrNotFound) {
		return work, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return work, err
	}
	if actor.User != nil && actor.Runtime == nil {
		if err := a.Identity.AuthorizePrincipalTx(tx, *actor.User); err != nil {
			return work, err
		}
		if actor.User.IsOperator() || actor.User.UserID == "" {
			return work, contracts.NewError("NOT_FOUND", "")
		}
		if actor.User.UserID == work.OwnerUserID {
			return work, nil
		}
		if actor.User.Role != "admin" {
			return work, contracts.NewError("NOT_FOUND", "")
		}
		if action == workaccess.Content || action == workaccess.Interact {
			return work, contracts.NewError("PERMISSION_DENIED", "")
		}
		return work, nil
	}
	if actor.Runtime != nil && actor.User == nil {
		scope := *actor.Runtime
		if scope.InstallationID != a.Store.InstallationID() || scope.WorkID != workID || scope.Generation < 1 || scope.InstanceID == "" {
			return work, internaltls.ErrIdentity
		}
		var active bool
		err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM runtime_generations g WHERE g.work_id=? AND g.generation=? AND g.instance_id=? AND g.state='ready' AND g.generation=(SELECT MAX(newer.generation) FROM runtime_generations newer WHERE newer.work_id=g.work_id))`, workID, scope.Generation, scope.InstanceID).Scan(&active)
		if err != nil {
			return work, err
		}
		if !active || work.DesiredState != "running" || work.ObservedState != "ready" && work.ObservedState != "degraded" {
			return work, internaltls.ErrStale
		}
		return work, nil
	}
	return work, contracts.NewError("AUTHENTICATION_REQUIRED", "")
}
