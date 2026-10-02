package workaccess

import (
	"context"
	"database/sql"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestWorkOwnerAndNonOwnerAdministratorBoundary(t *testing.T) {
	ctx := context.Background()
	store, err := corestore.Open(ctx, corestore.Options{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	stamp := "2026-09-30T00:00:00Z"
	err = store.Write(ctx, func(tx *sql.Tx) error {
		for _, user := range []corestore.UserRecord{
			{ID: "owner-1", Account: "owner", Role: "user", Enabled: true, PasswordDigest: "digest", CreatedAt: stamp, UpdatedAt: stamp},
			{ID: "other-1", Account: "other", Role: "user", Enabled: true, PasswordDigest: "digest", CreatedAt: stamp, UpdatedAt: stamp},
			{ID: "admin-1", Account: "admin", Role: "admin", Enabled: true, PasswordDigest: "digest", CreatedAt: stamp, UpdatedAt: stamp},
		} {
			if err := corestore.InsertUser(tx, user); err != nil {
				return err
			}
		}
		return corestore.InsertWork(tx, corestore.WorkRecord{ID: "work-owner-1", OwnerUserID: "owner-1", Name: "owner work", DesiredState: "running", ObservedState: "ready", DesiredRevision: 1, ControlVersion: 1, CreatedAt: stamp, UpdatedAt: stamp})
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []Action{Metadata, Control, Content, Interact} {
		if _, err := Work(ctx, store, identity.Principal{UserID: "owner-1", Role: "user"}, "work-owner-1", action); err != nil {
			t.Fatal("owner denied", action, err)
		}
		_, foreign := Work(ctx, store, identity.Principal{UserID: "other-1", Role: "user"}, "work-owner-1", action)
		_, missing := Work(ctx, store, identity.Principal{UserID: "other-1", Role: "user"}, "work-missing", action)
		foreignStatus, foreignView := contracts.ProjectError(foreign)
		missingStatus, missingView := contracts.ProjectError(missing)
		if foreignStatus != 404 || foreignView != missingView || missingStatus != 404 {
			t.Fatal("foreign Work leaked differently from absent Work", foreignView, missingView)
		}
		_, err := Work(ctx, store, identity.Principal{UserID: "admin-1", Role: "admin"}, "work-owner-1", action)
		status, _ := contracts.ProjectError(err)
		if action == Content || action == Interact {
			if status != 403 {
				t.Fatal("administrator gained Work content", action, err)
			}
		} else if err != nil {
			t.Fatal("administrator could not control Work", action, err)
		}
	}
}
