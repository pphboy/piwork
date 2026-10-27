package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/workruntime"
)

func TestResumeRejectsUnknownOrMismatchedAgent(t *testing.T) {
	view := &container.InspectResponse{}
	if !errors.Is(checkResumeIdentity(view, 2, "agent-one", "context-one"), dockerengine.ErrStateUnknown) {
		t.Fatal("unknown container state was accepted")
	}
	view.Config = &container.Config{Labels: map[string]string{"piwork.generation": "2", "piwork.instance_id": "agent-other", "piwork.context_identity": "context-one", "piwork.protocol_version": "v2"}}
	view.State = &container.State{}
	if !errors.Is(checkResumeIdentity(view, 2, "agent-one", "context-one"), dockerengine.ErrIdentity) {
		t.Fatal("different container instance was accepted")
	}
}

func TestRuntimeLaunchRetainsCredentialAcrossModelRotation(t *testing.T) {
	a, _, workID, _ := runModelFixture(t)
	ctx := context.Background()
	actor := identity.OperatorPrincipal()
	provider, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "Launch fixture", Api: "openai-responses", BaseUrl: "https://fixture.invalid/v1", Credential: "synthetic-launch-old"})
	if err != nil {
		t.Fatal(err)
	}
	model, err := a.createManagedModel(ctx, actor, string(provider.Id), contracts.CreateManagedModel{Name: "Launch fixture", Model: "fixture-model"})
	if err != nil {
		t.Fatal(err)
	}
	var binding corestore.RuntimeLaunchBinding
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		metadata, _, version, err := a.catalogModelTx(tx, string(model.ModelRef), false)
		if err != nil {
			return err
		}
		binding = corestore.RuntimeLaunchBinding{Version: 1, WorkID: workID, Generation: 11, InstanceID: "agent-fixture", ControlVersion: 1, ContextID: "context-fixture", ImageID: "sha256:" + strings.Repeat("a", 64), ModelRef: string(model.ModelRef), CredentialRef: metadata.CredentialRef, CredentialVersion: version}
		return corestore.PutRuntimeLaunchTx(tx, binding)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.patchModelProvider(ctx, actor, string(provider.Id), contracts.PatchModelProvider{Credential: contracts.Supplied("synthetic-launch-new")}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		retained, found, err := corestore.ReadRuntimeLaunchTx(tx, workID, 11)
		if err != nil || !found || retained != binding {
			t.Fatal("launch binding changed after rotation", err)
		}
		metadata, _, _, err := a.catalogModelTx(tx, string(model.ModelRef), false)
		if err != nil || metadata.CredentialRef == retained.CredentialRef {
			t.Fatal("model did not publish a distinct current secret", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	old, err := a.files.ReadSecret(binding.CredentialRef)
	if err != nil || strings.TrimSpace(string(old)) != "synthetic-launch-old" {
		t.Fatal("accepted launch lost its original secret", err)
	}
}

func TestRuntimeReplacementFailureUsesCurrentTarget(t *testing.T) {
	a, _, workID, _ := runModelFixture(t)
	ctx := context.Background()
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil || work.ActiveContextID == nil {
		t.Fatal("fixture Work unavailable", err)
	}
	binding := corestore.RuntimeLaunchBinding{Version: 1, WorkID: workID, Generation: 2, InstanceID: "agent-next", ControlVersion: work.ControlVersion, ContextID: *work.ActiveContextID, ImageID: "sha256:" + strings.Repeat("a", 64), ModelRef: "model-ref-a", CredentialRef: "model-11111111-1111-4111-8111-111111111111.secret"}
	plan := corestore.RuntimeReplacement{Version: 1, WorkID: workID, ControlVersion: work.ControlVersion, SourceGeneration: 1, SourceInstanceID: "agent-first", Target: binding, Stage: "prepared"}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.PutRuntimeReplacementTx(tx, plan); err != nil {
			return err
		}
		if _, err := corestore.AdvanceRuntimeReplacementTx(tx, workID, 2, "old-removed", time.Now()); err != nil {
			return err
		}
		_, err := corestore.AdvanceRuntimeReplacementTx(tx, workID, 2, "starting", time.Now())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.recordRecoveryFailure(ctx, workID, 1, work.ControlVersion); err != nil {
		t.Fatal(err)
	}
	source, err := a.Store.RuntimeGeneration(ctx, workID, 1)
	if err != nil || source.State != "stopped" || source.RetryCount != 0 {
		t.Fatal("failure was charged to the old generation", source, err)
	}
	target, err := a.Store.RuntimeGeneration(ctx, workID, 2)
	if err != nil || target.State != "recovering" || target.RetryCount != 1 {
		t.Fatal("failure was not charged to the current target", target, err)
	}
}

func TestRecoveryFailureDoesNotOverwriteNewerControl(t *testing.T) {
	a, _, workID, _ := runModelFixture(t)
	ctx := context.Background()
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	before, err := a.Store.RuntimeGeneration(ctx, workID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET control_version=control_version+1,observed_state='ready' WHERE id=?`, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.recordRecoveryFailure(ctx, workID, 1, work.ControlVersion); err != nil {
		t.Fatal(err)
	}
	after, err := a.Store.RuntimeGeneration(ctx, workID, 1)
	if err != nil || after.State != before.State || after.RetryCount != before.RetryCount {
		t.Fatal("stale failure altered the generation", err)
	}
	current, err := a.Store.Work(ctx, workID, false)
	if err != nil || current.ObservedState != "ready" {
		t.Fatal("stale failure altered the new control state", err)
	}
}

func TestRecoveryFailureCannotOverwriteLaterReady(t *testing.T) {
	a, _, workID, _ := runModelFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	writerHeld, releaseWriter, writerDone := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		writerDone <- a.Store.Write(ctx, func(tx *sql.Tx) error {
			close(writerHeld)
			select {
			case <-releaseWriter:
				return nil
			case <-ctx.Done():
				return ctx.Err()
			}
		})
	}()
	<-writerHeld
	failed, firstDone, secondEntered, secondDone := make(chan struct{}), make(chan error, 1), make(chan struct{}), make(chan error, 1)
	failure := errors.New("synthetic recovery failure")
	go func() {
		_, attemptErr, writeErr := a.runWorkStartAttempt(ctx, workID, 1, &work.ControlVersion, func() (workruntime.Started, error) {
			close(failed)
			return workruntime.Started{}, failure
		})
		if !errors.Is(attemptErr, failure) {
			firstDone <- attemptErr
			return
		}
		firstDone <- writeErr
	}()
	<-failed
	go func() {
		_, err, _ := a.runWorkStartAttempt(ctx, workID, 1, nil, func() (workruntime.Started, error) {
			close(secondEntered)
			return workruntime.Started{}, a.Store.Write(ctx, func(tx *sql.Tx) error {
				var state string
				var retries int
				if err := tx.QueryRow(`SELECT state,retry_count FROM runtime_generations WHERE work_id=? AND generation=1`, workID).Scan(&state, &retries); err != nil {
					return err
				}
				if state != "recovering" || retries != 1 {
					return errors.New("failure was not recorded before the next attempt")
				}
				if _, err := tx.Exec(`UPDATE runtime_generations SET state='ready',ready_since=?,next_retry_at=NULL WHERE work_id=? AND generation=1`, packageNow(), workID); err != nil {
					return err
				}
				_, err := tx.Exec(`UPDATE works SET observed_state='ready' WHERE id=?`, workID)
				return err
			})
		})
		secondDone <- err
	}()
	select {
	case <-secondEntered:
		t.Fatal("next attempt entered while the earlier failure was being recorded")
	case <-time.After(100 * time.Millisecond):
	}
	close(releaseWriter)
	if err := <-writerDone; err != nil {
		t.Fatal(err)
	}
	if err := <-firstDone; err != nil {
		t.Fatal(err)
	}
	if err := <-secondDone; err != nil {
		t.Fatal(err)
	}
	got, err := a.Store.RuntimeGeneration(ctx, workID, 1)
	if err != nil || got.State != "ready" || got.RetryCount != 1 {
		t.Fatalf("late failure overwrote ready: state=%s retries=%d err=%v", got.State, got.RetryCount, err)
	}
	current, err := a.Store.Work(ctx, workID, false)
	if err != nil || current.ObservedState != "ready" {
		t.Fatal("later successful recovery was overwritten", err)
	}
}

func TestExplicitStartFailurePublishesBeforeConcurrentRecovery(t *testing.T) {
	for _, kind := range []string{"start-work", "retry-work"} {
		t.Run(kind, func(t *testing.T) {
			a, _, workID, _ := runModelFixture(t)
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			work, err := a.Store.Work(ctx, workID, false)
			if err != nil {
				t.Fatal(err)
			}
			accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: work.OwnerUserID, WorkScope: workID, Kind: kind, IdempotencyKey: "failure-ordering", RequestJSON: `{}`, TargetVersion: work.ControlVersion + 1, WorkID: &workID, ExpectedWorkVersion: &work.ControlVersion, FenceScope: "work"}, func(tx *sql.Tx, op string) (corestore.MutationEffect, error) {
				if _, err := corestore.AdvanceWorkControl(tx, workID, work.ControlVersion, "running", ""); err != nil {
					return corestore.MutationEffect{}, err
				}
				if err := putCapturedStart(tx, startCaptureKey(op), *work.ActiveContextID); err != nil {
					return corestore.MutationEffect{}, err
				}
				if _, err := tx.Exec(`UPDATE works SET observed_state='failed' WHERE id=?`, workID); err != nil {
					return corestore.MutationEffect{}, err
				}
				if _, err := tx.Exec(`UPDATE runtime_generations SET state='recovering',next_retry_at=? WHERE work_id=? AND generation=1`, time.Now().Add(-time.Second).UTC().Format(time.RFC3339Nano), workID); err != nil {
					return corestore.MutationEffect{}, err
				}
				return corestore.MutationEffect{ResourceID: workID}, nil
			})
			if err != nil {
				t.Fatal(err)
			}
			reached, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			t.Cleanup(unblock)
			a.workResumeFaultForTest = func(stage string) error {
				if stage == "operation-failure" {
					close(reached)
					select {
					case <-release:
					case <-ctx.Done():
						return ctx.Err()
					}
				}
				return nil
			}
			firstDone := make(chan error, 1)
			go func() { _, err := a.processOneWorkOperation(ctx, workID); firstDone <- err }()
			select {
			case <-reached:
			case <-ctx.Done():
				t.Fatal("operation failure did not reach publication")
			}
			secondEntered, secondDone := make(chan struct{}), make(chan error, 1)
			go func() {
				_, err, _ := a.runWorkStartAttempt(ctx, workID, 1, nil, func() (workruntime.Started, error) {
					close(secondEntered)
					return workruntime.Started{}, a.Store.Write(ctx, func(tx *sql.Tx) error {
						if _, err := tx.Exec(`UPDATE runtime_generations SET state='ready',ready_since=?,next_retry_at=NULL WHERE work_id=? AND generation=1`, packageNow(), workID); err != nil {
							return err
						}
						_, err := tx.Exec(`UPDATE works SET observed_state='ready' WHERE id=?`, workID)
						return err
					})
				})
				secondDone <- err
			}()
			enteredEarly := false
			select {
			case <-secondEntered:
				enteredEarly = true
				if err := <-secondDone; err != nil {
					t.Fatal(err)
				}
			case <-time.After(100 * time.Millisecond):
			}
			unblock()
			if err := <-firstDone; err != nil {
				t.Fatal(err)
			}
			if !enteredEarly {
				if err := <-secondDone; err != nil {
					t.Fatal(err)
				}
			}
			a.workResumeFaultForTest = nil
			work, err = a.Store.Work(ctx, workID, false)
			if err != nil || enteredEarly || work.ObservedState != "ready" {
				t.Fatalf("operation failure overlapped later recovery: early=%v state=%s err=%v", enteredEarly, work.ObservedState, err)
			}
			generation, err := a.Store.RuntimeGeneration(ctx, workID, 1)
			if err != nil || generation.State != "ready" || generation.RetryCount != 0 {
				t.Fatal("later recovery state or budget changed", err)
			}
			op, err := a.Store.Operation(ctx, accepted.OperationID)
			if err != nil || op.State != "failed" || op.ErrorJSON == nil {
				t.Fatal("original operation failure was not preserved", err)
			}
		})
	}
}
