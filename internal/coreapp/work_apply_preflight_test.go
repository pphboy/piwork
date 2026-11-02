package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
)

func TestApplyPermanentPriorContextFailureTerminatesWithoutRuntimeEffects(t *testing.T) {
	for _, tc := range []struct {
		name     string
		cause    error
		terminal bool
	}{
		{"captured", errCapturedWork, true}, {"wrapped", fmt.Errorf("private context: %w", errCapturedWork), true},
		{"storage", corestore.ErrStorage, false}, {"dependency", dockerengine.ErrUnavailable, false}, {"cancelled", context.Canceled, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a, actor, workID := serviceAcceptFixture(t)
			ctx := context.Background()
			before, err := a.Store.Work(ctx, workID, false)
			if err != nil {
				t.Fatal(err)
			}
			accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.User.UserID, WorkScope: workID, Kind: applyOperationKind, IdempotencyKey: "preflight-" + tc.name, RequestJSON: `{}`, TargetVersion: before.ControlVersion, WorkID: &workID, FenceScope: "work"}, func(*sql.Tx, string) (corestore.MutationEffect, error) {
				return corestore.MutationEffect{ResourceID: workID}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			operation, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			// No fake runtime can consume a launch: the preflight terminal owner must
			// operate with both real effect interfaces absent.
			a.workRuntime = nil
			a.dockerRuntime = nil
			result := a.finishApplyPriorContextFailure(ctx, operation, tc.cause)
			after, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			if tc.terminal {
				if result != nil || after.State != "failed" {
					t.Fatalf("permanent preflight did not terminate: state=%s returnedError=%t", after.State, result != nil)
				}
				if after.ErrorJSON == nil || !strings.Contains(*after.ErrorJSON, `"code":"CONTEXT_NOT_FOUND"`) {
					t.Fatal("specific context diagnostic missing")
				}
			} else if !errors.Is(result, tc.cause) || after.State != operation.State {
				t.Fatal("retryable failure was reclassified")
			}
			current, err := a.Store.Work(ctx, workID, false)
			if err != nil {
				t.Fatal(err)
			}
			if current.ObservedState != before.ObservedState || current.DesiredState != before.DesiredState || current.ControlVersion != before.ControlVersion {
				t.Fatal("preflight failure changed Work truth")
			}
		})
	}
}

func TestApplyPriorContextFailureHonorsCancellationAndWorkFence(t *testing.T) {
	for _, changed := range []string{"cancelled-context", "new-work-version"} {
		t.Run(changed, func(t *testing.T) {
			a, actor, id := serviceAcceptFixture(t)
			ctx := context.Background()
			work, err := a.Store.Work(ctx, id, false)
			if err != nil {
				t.Fatal(err)
			}
			accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.User.UserID, WorkScope: id, Kind: applyOperationKind, IdempotencyKey: changed, RequestJSON: `{}`, TargetVersion: work.ControlVersion, WorkID: &id, FenceScope: "work"}, func(*sql.Tx, string) (corestore.MutationEffect, error) {
				return corestore.MutationEffect{ResourceID: id}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			original, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			attempt, cancel := context.WithCancel(ctx)
			defer cancel()
			if changed == "cancelled-context" {
				cancel()
			} else {
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec(`UPDATE works SET control_version=control_version+1,observed_state='stopped' WHERE id=?`, id)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			before, err := a.Store.Work(ctx, id, false)
			if err != nil {
				t.Fatal(err)
			}
			a.workRuntime = nil
			a.dockerRuntime = nil
			result := a.finishApplyPriorContextFailure(attempt, original, errCapturedWork)
			operation, err := a.Store.Operation(ctx, original.ID)
			if err != nil {
				t.Fatal(err)
			}
			if changed == "cancelled-context" {
				if !errors.Is(result, context.Canceled) || operation.State != original.State {
					t.Fatal("cancelled preflight published")
				}
			} else if !errors.Is(result, errWorkSuperseded) || operation.State != "superseded" {
				t.Fatalf("old owner published: state=%s error=%v", operation.State, result)
			}
			after, err := a.Store.Work(ctx, id, false)
			if err != nil {
				t.Fatal(err)
			}
			if after.ControlVersion != before.ControlVersion || after.ObservedState != before.ObservedState || after.DesiredState != before.DesiredState {
				t.Fatal("new Work facts changed")
			}
		})
	}
}
