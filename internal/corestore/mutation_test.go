package corestore

import (
	"bufio"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

const mutationWorkID = "work-mutation-00000001"

func pointer[T any](value T) *T { return &value }
func seedMutationWork(t *testing.T, store *Store) {
	t.Helper()
	if err := store.Write(context.Background(), func(tx *sql.Tx) error {
		user := UserRecord{ID: "user-mutation-00000001", Account: "owner", PasswordDigest: "digest-only", Role: "user", Enabled: true, CreatedAt: "2026-09-30T00:00:00Z", UpdatedAt: "2026-09-30T00:00:00Z"}
		if err := InsertUser(tx, user); err != nil {
			return err
		}
		return InsertWork(tx, WorkRecord{ID: mutationWorkID, OwnerUserID: user.ID, Name: "mutation fixture", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: user.CreatedAt, UpdatedAt: user.UpdatedAt})
	}); err != nil {
		t.Fatal(err)
	}
}
func startMutationRequest() MutationRequest {
	return MutationRequest{PrincipalID: "user-mutation-00000001", WorkScope: mutationWorkID, Kind: "start-work", IdempotencyKey: "start-once", RequestJSON: `{"workId":"work-mutation-00000001","action":"start"}`, TargetVersion: 2, WorkID: pointer(mutationWorkID), ExpectedWorkVersion: pointer(int64(1)), FenceScope: "work"}
}
func advanceEffect(request MutationRequest, desired string, calls *atomic.Int64) func(*sql.Tx, string) (MutationEffect, error) {
	return func(tx *sql.Tx, id string) (MutationEffect, error) {
		if calls != nil {
			calls.Add(1)
		}
		_, err := AdvanceWorkControl(tx, *request.WorkID, *request.ExpectedWorkVersion, desired, "")
		return MutationEffect{ResourceID: *request.WorkID}, err
	}
}
func TestConcurrentIdempotencyAndCanonicalRequest(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	seedMutationWork(t, store)
	request := startMutationRequest()
	var calls atomic.Int64
	var group sync.WaitGroup
	ids := make(chan string, 20)
	failures := make(chan error, 20)
	for i := 0; i < 20; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			copy := request
			if i%2 == 0 {
				copy.RequestJSON = `{"action":"start","workId":"work-mutation-00000001"}`
			}
			accepted, err := store.AcceptMutation(context.Background(), copy, advanceEffect(copy, "running", &calls))
			if err != nil {
				failures <- err
				return
			}
			ids <- accepted.OperationID
		}(i)
	}
	group.Wait()
	close(ids)
	close(failures)
	for err := range failures {
		t.Fatal(err)
	}
	unique := make(map[string]bool)
	for id := range ids {
		unique[id] = true
	}
	if len(unique) != 1 || calls.Load() != 1 {
		t.Fatalf("duplicate acceptance: %d ids, %d callbacks", len(unique), calls.Load())
	}
	if replay, found, err := store.FindAcceptedMutation(context.Background(), request.PrincipalID, request.WorkScope, request.Kind, request.IdempotencyKey, `{"action":"start","workId":"work-mutation-00000001"}`); err != nil || !found || !replay.Reused || !unique[replay.OperationID] || replay.ResourceID != mutationWorkID {
		t.Fatalf("committed mutation was not safely replayable: %+v found=%v err=%v", replay, found, err)
	}
	if _, _, err := store.FindAcceptedMutation(context.Background(), request.PrincipalID, request.WorkScope, request.Kind, request.IdempotencyKey, `{"action":"stop"}`); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("preflight replay accepted a changed request: %v", err)
	}
	request.RequestJSON = `{"workId":"work-mutation-00000001","action":"stop"}`
	if _, err := store.AcceptMutation(context.Background(), request, advanceEffect(request, "stopped", nil)); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("conflicting key accepted: %v", err)
	}
	work, err := store.Work(context.Background(), mutationWorkID, false)
	if err != nil || work.ControlVersion != 2 || work.DesiredState != "running" {
		t.Fatal(work, err)
	}
}

func TestWorkVersionFenceAndTerminalImmutability(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	seedMutationWork(t, store)
	ctx := context.Background()
	start := startMutationRequest()
	first, err := store.AcceptMutation(ctx, start, advanceEffect(start, "running", nil))
	if err != nil {
		t.Fatal(err)
	}
	stop := start
	stop.Kind = "stop-work"
	stop.IdempotencyKey = "stop-once"
	stop.RequestJSON = `{"action":"stop"}`
	stop.ExpectedWorkVersion = pointer(int64(2))
	stop.TargetVersion = 3
	second, err := store.AcceptMutation(ctx, stop, advanceEffect(stop, "stopped", nil))
	if err != nil {
		t.Fatal(err)
	}
	called := false
	old, err := store.CompleteOperation(ctx, first.OperationID, "succeeded", nil, nil, func(tx *sql.Tx) error {
		called = true
		_, err := tx.Exec("UPDATE works SET observed_state='ready' WHERE id=?", mutationWorkID)
		return err
	})
	if err != nil || old.State != "superseded" || called {
		t.Fatal("old result published", old, err)
	}
	current, err := store.CompleteOperation(ctx, second.OperationID, "succeeded", pointer(`{"stopped":true}`), nil, func(tx *sql.Tx) error {
		_, err := tx.Exec("UPDATE works SET observed_state='stopped' WHERE id=?", mutationWorkID)
		return err
	})
	if err != nil || current.State != "succeeded" {
		t.Fatal(current, err)
	}
	if _, err := store.CompleteOperation(ctx, second.OperationID, "failed", nil, pointer(`{"code":"changed"}`), nil); !errors.Is(err, ErrOperationFinal) {
		t.Fatal("terminal result replaced")
	}
	if err := store.MarkOperationRunning(ctx, second.OperationID); !errors.Is(err, ErrOperationFinal) {
		t.Fatal("terminal result became running")
	}
	request := startMutationRequest()
	request.IdempotencyKey = "stale-version"
	if _, err := store.AcceptMutation(ctx, request, advanceEffect(request, "running", nil)); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("stale acceptance succeeded")
	}
}

func TestServiceSameRevisionFenceAndWorkStop(t *testing.T) {
	for _, overtake := range []string{"new-action", "work-stop", "new-revision"} {
		t.Run(overtake, func(t *testing.T) {
			store := openTestStore(t, t.TempDir())
			defer store.Close()
			seedMutationWork(t, store)
			ctx := context.Background()
			serviceID := "service-mutation-000001"
			if err := store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,enabled,observed_state) VALUES(?,?,?,1,1,'starting')`, mutationWorkID, serviceID, "demo")
				return err
			}); err != nil {
				t.Fatal(err)
			}
			request := MutationRequest{PrincipalID: "user-mutation-00000001", WorkScope: mutationWorkID, Kind: "restart-service", IdempotencyKey: "restart-1", RequestJSON: `{"action":"restart"}`, TargetVersion: 1, WorkID: pointer(mutationWorkID), ServiceID: &serviceID, FenceScope: "service"}
			effect := func(tx *sql.Tx, id string) (MutationEffect, error) { return MutationEffect{ResourceID: serviceID}, nil }
			old, err := store.AcceptMutation(ctx, request, effect)
			if err != nil {
				t.Fatal(err)
			}
			switch overtake {
			case "new-action":
				request.IdempotencyKey = "restart-2"
				if _, err := store.AcceptMutation(ctx, request, effect); err != nil {
					t.Fatal(err)
				}
			case "work-stop":
				if err := store.Write(ctx, func(tx *sql.Tx) error { _, err := AdvanceWorkControl(tx, mutationWorkID, 1, "stopped", ""); return err }); err != nil {
					t.Fatal(err)
				}
			case "new-revision":
				if err := store.Write(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec("UPDATE service_heads SET desired_revision=2 WHERE work_id=? AND service_id=?", mutationWorkID, serviceID)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			}
			called := false
			terminal, err := store.CompleteOperation(ctx, old.OperationID, "succeeded", nil, nil, func(tx *sql.Tx) error { called = true; return nil })
			if err != nil || terminal.State != "superseded" || called {
				t.Fatal("service stale result published", terminal, err)
			}
		})
	}
}

func TestMutationCrashBeforeAndAfterCommit(t *testing.T) {
	for _, point := range []string{"before-accept-commit", "after-accept-commit"} {
		t.Run(point, func(t *testing.T) {
			directory := t.TempDir()
			store := openTestStore(t, directory)
			seedMutationWork(t, store)
			store.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestMutationCrashChild$")
			command.Env = append(os.Environ(), "PIWORK_MUTATION_CHILD_DIR="+directory, "PIWORK_MUTATION_CRASH_POINT="+point)
			stdout, err := command.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			defer func() {
				if command.ProcessState == nil {
					command.Process.Kill()
					command.Wait()
				}
			}()
			line, err := bufio.NewReader(stdout).ReadString('\n')
			if err != nil || strings.TrimSpace(line) != "crash-boundary" {
				t.Fatalf("crash point not reached: %q %v", line, err)
			}
			if err := command.Process.Kill(); err != nil {
				t.Fatal(err)
			}
			_ = command.Wait()
			store = openTestStore(t, directory)
			defer store.Close()
			var calls atomic.Int64
			request := startMutationRequest()
			accepted, err := store.AcceptMutation(context.Background(), request, advanceEffect(request, "running", &calls))
			if err != nil {
				t.Fatal(err)
			}
			if accepted.Reused != (point == "after-accept-commit") || calls.Load() != map[string]int64{"before-accept-commit": 1, "after-accept-commit": 0}[point] {
				t.Fatal("crash caused duplicate acceptance", accepted, calls.Load())
			}
			pending, err := store.PendingOperations(context.Background())
			if err != nil || len(pending) != 1 || pending[0].ID != accepted.OperationID {
				t.Fatal("accepted identity lost", pending, err)
			}
		})
	}
}
func TestMutationCrashChild(t *testing.T) {
	if directory := os.Getenv("PIWORK_MUTATION_CHILD_DIR"); directory != "" {
		store := openTestStore(t, directory)
		defer store.Close()
		request := startMutationRequest()
		request.fault = func(point string) error {
			if point == os.Getenv("PIWORK_MUTATION_CRASH_POINT") {
				fmt.Println("crash-boundary")
				for {
					time.Sleep(time.Second)
				}
			}
			return nil
		}
		if _, err := store.AcceptMutation(context.Background(), request, advanceEffect(request, "running", nil)); err != nil {
			t.Fatal(err)
		}
	}
}
