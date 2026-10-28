package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"piwork/internal/corestore"
	"piwork/internal/identity"
)

func TestWorkStartupInvalidatesPriorObservations(t *testing.T) {
	ctx := context.Background()
	// Synthetic generations have no Docker resources to shut down.
	opts := Options{DataDirectory: t.TempDir(), Shutdown: func(context.Context, *Application) error { return nil }}
	first, err := New(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	owner, err := first.Identity.Bootstrap(ctx, "owner", "development-fixture-pass")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	cases := []struct{ id, desired, observed, want string }{
		{"running-ready", "running", "ready", "unknown"},
		{"running-stopped", "running", "stopped", "unknown"},
		{"running-starting", "running", "starting", "unknown"},
		{"running-degraded", "running", "degraded", "unknown"},
		{"stopped", "stopped", "stopped", "unknown"},
		{"failed-retry", "running", "failed", "unknown"},
		{"failed-no-generation", "running", "failed", "unknown"},
		{"failed-exhausted", "running", "failed", "failed"},
		{"failed-new-generation", "running", "failed", "unknown"},
		{"failed-stop", "stopped", "failed", "failed"},
	}
	if err = first.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, c := range cases {
			if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: c.id, OwnerUserID: string(owner.Id), Name: c.id, DesiredState: c.desired, ObservedState: c.observed, DesiredRevision: 1, ControlVersion: 1, CreatedAt: now, UpdatedAt: now}); err != nil {
				return err
			}
		}
		for _, generation := range []struct {
			id, state         string
			generation, count int
		}{
			{"failed-retry", "recovering", 1, 3},
			{"failed-exhausted", "failed", 1, 3},
			{"failed-new-generation", "failed", 1, 3},
			{"failed-new-generation", "recovering", 2, 1},
		} {
			var nextRetry any
			if generation.state == "recovering" {
				nextRetry = now
			}
			if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,next_retry_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`, generation.id, generation.generation, "agent-fixture", generation.state, generation.count, nextRetry, now, now); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err = first.Close(ctx); err != nil {
		t.Fatal(err)
	}
	second, err := New(ctx, opts)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close(ctx)
	for _, c := range cases {
		work, err := second.Store.Work(ctx, c.id, false)
		if err != nil {
			t.Fatal(err)
		}
		if work.DesiredState != c.desired || work.ObservedState != c.want || work.ControlVersion != 1 {
			t.Fatalf("%s: %+v", c.id, work)
		}
	}
	for _, tc := range []struct {
		id         string
		generation int64
		state      string
		count      int
	}{{"failed-retry", 1, "recovering", 3}, {"failed-exhausted", 1, "failed", 3}, {"failed-new-generation", 2, "recovering", 1}} {
		generation, err := second.Store.RuntimeGeneration(ctx, tc.id, tc.generation)
		if err != nil || generation.State != tc.state || generation.RetryCount != tc.count || (tc.state == "recovering" && (generation.NextRetryAt == nil || *generation.NextRetryAt != now)) {
			t.Fatalf("retry budget changed: %+v %v", generation, err)
		}
	}
	actor := identity.Principal{UserID: string(owner.Id), Role: "user"}
	for _, path := range []string{"/api/v1/works", "/api/v1/works/running-ready"} {
		response := httptest.NewRecorder()
		handled, err := second.workRead(response, httptest.NewRequest("GET", path, nil), actor)
		if !handled || err != nil || response.Code != 200 {
			t.Fatalf("read %s: %v %d", path, err, response.Code)
		}
		var body map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if path != "/api/v1/works" && body["observedState"] != "unknown" {
			t.Fatalf("stale detail: %#v", body)
		}
		if path == "/api/v1/works" {
			for _, item := range body["works"].([]any) {
				w := item.(map[string]any)
				if w["id"] == "running-ready" && w["observedState"] != "unknown" {
					t.Fatalf("stale list: %#v", w)
				}
			}
		}
	}
	// Concurrent readers see an observation and its control version from the
	// same committed transaction, including when recovery advances the Work.
	finished := make(chan error, 1)
	go func() {
		for _, step := range []struct {
			state   string
			version int
		}{{"starting", 2}, {"ready", 3}} {
			if err := second.Store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`UPDATE works SET observed_state=?,control_version=? WHERE id='running-ready'`, step.state, step.version)
				return err
			}); err != nil {
				finished <- err
				return
			}
		}
		finished <- nil
	}()
	for i := 0; i < 100; i++ {
		work, err := second.Store.Work(ctx, "running-ready", false)
		if err != nil {
			t.Fatal(err)
		}
		if !(work.ObservedState == "unknown" && work.ControlVersion == 1 || work.ObservedState == "starting" && work.ControlVersion == 2 || work.ObservedState == "ready" && work.ControlVersion == 3) {
			t.Fatalf("mixed observation: %+v", work)
		}
	}
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
}
