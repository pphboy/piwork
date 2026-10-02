// Package workaccess enforces the Work boundary before any Docker or Agent RPC.
package workaccess

import (
	"context"
	"errors"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

type Action string

const (
	Metadata Action = "metadata"
	Control  Action = "control"
	Content  Action = "content"
	Interact Action = "interact"
)

// Work returns the same public absence for an unknown Work and a Work owned
// by another ordinary user. An administrator can control it, but cannot read
// its conversation/file/log content or interact with its Agent.
func Work(ctx context.Context, store *corestore.Store, actor identity.Principal, id string, action Action) (corestore.WorkRecord, error) {
	return work(ctx, store, actor, id, action, false)
}

// WorkOperation permits metadata reads of a tombstoned Work so the owner can
// observe the terminal delete Operation after the Work disappears from lists.
func WorkOperation(ctx context.Context, store *corestore.Store, actor identity.Principal, id string) (corestore.WorkRecord, error) {
	return work(ctx, store, actor, id, Metadata, true)
}

func work(ctx context.Context, store *corestore.Store, actor identity.Principal, id string, action Action, includeDeleted bool) (corestore.WorkRecord, error) {
	if store == nil || id == "" || actor.IsOperator() || actor.UserID == "" {
		return corestore.WorkRecord{}, contracts.NewError("NOT_FOUND", "")
	}
	work, err := store.Work(ctx, id, includeDeleted)
	if err != nil {
		if errors.Is(err, corestore.ErrNotFound) {
			return corestore.WorkRecord{}, contracts.NewError("NOT_FOUND", "")
		}
		return corestore.WorkRecord{}, err
	}
	if work.OwnerUserID == actor.UserID {
		return work, nil
	}
	if actor.Role != "admin" {
		return corestore.WorkRecord{}, contracts.NewError("NOT_FOUND", "")
	}
	if action == Content || action == Interact {
		return corestore.WorkRecord{}, contracts.NewError("PERMISSION_DENIED", "")
	}
	if action != Metadata && action != Control {
		return corestore.WorkRecord{}, contracts.NewError("NOT_FOUND", "")
	}
	return work, nil
}
