package corestore

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func preparationFixtureKey(n int) PreparationKey {
	return PreparationKey{strings.Repeat("a", 64), fmt.Sprintf("sha256:%064x", n), "agent", "linux/amd64", 1}
}

func TestPreparationFenceWaitsForWriterAndCoversCommit(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	held, release := make(chan struct{}), make(chan struct{})
	writerDone := make(chan error, 1)
	go func() {
		writerDone <- s.Write(ctx, func(*sql.Tx) error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	fenced := make(chan struct{})
	done := make(chan error, 1)
	key := preparationFixtureKey(400)
	waiters := s.writer.Stats().WaitCount
	go func() {
		_, err := s.WritePreparationFenced(ctx, key, json.RawMessage(`{"complete":true}`), nil, func(publish func() error) error {
			close(fenced)
			if err := publish(); err != nil {
				return err
			}
			// A separate reader must see the committed row before the fence exits.
			if _, hit, err := s.ReadPreparation(ctx, key); err != nil || !hit {
				return fmt.Errorf("fence released before durable commit: hit=%t err=%v", hit, err)
			}
			return nil
		})
		done <- err
	}()
	deadline := time.After(time.Second)
	for s.writer.Stats().WaitCount == waiters {
		select {
		case <-deadline:
			close(release)
			t.Fatal("publication did not wait for the writer")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	select {
	case <-fenced:
		close(release)
		t.Fatal("publication held its external fence while waiting for the writer")
	default:
	}
	close(release)
	if err := <-writerDone; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	rejected := preparationFixtureKey(401)
	failure := errors.New("stale Engine generation")
	if saved, err := s.WritePreparationFenced(ctx, rejected, json.RawMessage(`{}`), nil, func(func() error) error { return failure }); saved || !errors.Is(err, failure) {
		t.Fatal("stale identity published", saved, err)
	}
	if _, hit, err := s.ReadPreparation(ctx, rejected); err != nil || hit {
		t.Fatal("stale identity left a durable result", hit, err)
	}
}

func TestPreparationTouchesMergeWithoutWriterAndRollbackTogether(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	ctx := context.Background()
	keys := []PreparationKey{preparationFixtureKey(0), preparationFixtureKey(1)}
	for _, key := range keys {
		if _, err := s.WritePreparation(ctx, key, json.RawMessage(`{}`), nil); err != nil {
			t.Fatal(err)
		}
	}
	const old = "2000-01-01T00:00:00Z"
	if _, err := s.writer.Exec("UPDATE control_metadata SET updated_at=? WHERE key GLOB ?", old, preparationNamespace+"*"); err != nil {
		t.Fatal(err)
	}
	held, release := make(chan struct{}), make(chan struct{})
	writerDone := make(chan error, 1)
	go func() {
		writerDone <- s.Write(ctx, func(*sql.Tx) error { close(held); <-release; return nil })
	}()
	<-held
	touched := make(chan error, 1)
	go func() { touched <- s.TouchPreparations(ctx, append(keys, keys...)) }()
	select {
	case err := <-touched:
		if err != nil {
			close(release)
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("cache hit waited for an unrelated writer")
	}
	s.preparationTouchMu.Lock()
	n := len(s.preparationTouches)
	s.preparationTouchMu.Unlock()
	if n != 2 {
		close(release)
		t.Fatal("duplicate access timestamps were not merged", n)
	}
	close(release)
	if err := <-writerDone; err != nil {
		t.Fatal(err)
	}
	if _, err := s.writer.Exec("CREATE TEMP TRIGGER touch_fail BEFORE UPDATE ON control_metadata BEGIN SELECT RAISE(ABORT,'fixture'); END"); err != nil {
		t.Fatal(err)
	}
	if err := s.Write(ctx, func(*sql.Tx) error { return nil }); err == nil {
		t.Fatal("touch failure was silently committed")
	}
	for _, key := range keys {
		var at string
		if err := s.reader.QueryRow("SELECT updated_at FROM control_metadata WHERE key=?", key.storageKey()).Scan(&at); err != nil || at != old {
			t.Fatal("failed batch partially updated timestamps", at, err)
		}
	}
	if _, err := s.writer.Exec("DROP TRIGGER touch_fail"); err != nil {
		t.Fatal(err)
	}
	if err := s.Write(ctx, func(*sql.Tx) error { return nil }); err != nil {
		t.Fatal(err)
	}
	for _, key := range keys {
		var at string
		if err := s.reader.QueryRow("SELECT updated_at FROM control_metadata WHERE key=?", key.storageKey()).Scan(&at); err != nil || at == old {
			t.Fatal("failed batch was not retained for the next mutation", at, err)
		}
	}
}

func TestPreparationTouchesBoundedAndFlushedOnClose(t *testing.T) {
	dir := t.TempDir()
	s := openTestStore(t, dir)
	ctx := context.Background()
	key := preparationFixtureKey(999)
	if _, err := s.WritePreparation(ctx, key, json.RawMessage(`{}`), nil); err != nil {
		t.Fatal(err)
	}
	if _, err := s.writer.Exec("UPDATE control_metadata SET updated_at='2000-01-01T00:00:00Z' WHERE key=?", key.storageKey()); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 300; n++ {
		if err := s.TouchPreparations(ctx, []PreparationKey{preparationFixtureKey(n)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.TouchPreparations(ctx, []PreparationKey{key}); err != nil {
		t.Fatal(err)
	}
	if len(s.preparationTouches) != PreparationResultCapacity*4 {
		t.Fatal("pending access timestamps exceeded their bound", len(s.preparationTouches))
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	if err := s.TouchPreparations(ctx, []PreparationKey{key}); !errors.Is(err, ErrClosed) {
		t.Fatal("closed Store accepted access timestamps", err)
	}
	s = openTestStore(t, dir)
	defer s.Close()
	var at string
	if err := s.reader.QueryRow("SELECT updated_at FROM control_metadata WHERE key=?", key.storageKey()).Scan(&at); err != nil || at == "2000-01-01T00:00:00Z" {
		t.Fatal("normal close lost the latest access timestamp", at, err)
	}
	var count int
	if err := s.reader.QueryRow("SELECT count(*) FROM control_metadata WHERE key GLOB ?", preparationNamespace+"*").Scan(&count); err != nil || count != 1 {
		t.Fatal("access timestamps created unverified records", count, err)
	}
}

func TestPreparationTouchesDoNotExtendShutdownBudget(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	held, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	writerDone := make(chan error, 1)
	go func() {
		writerDone <- s.Write(context.Background(), func(*sql.Tx) error {
			close(held)
			<-release
			return nil
		})
	}()
	<-held
	if err := s.TouchPreparations(context.Background(), []PreparationKey{preparationFixtureKey(0)}); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	started := time.Now()
	if err := s.CloseContext(ctx); err == nil || time.Since(started) > 400*time.Millisecond {
		t.Fatal("pending access timestamps changed bounded shutdown", err, time.Since(started))
	}
}
func TestPreparationPersistenceIsolationAndCorruption(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	s := openTestStore(t, dir)
	k := preparationFixtureKey(1)
	if _, hit, err := s.ReadPreparation(ctx, k); err != nil || hit {
		t.Fatal(hit, err)
	}
	if saved, err := s.WritePreparation(ctx, k, json.RawMessage(`{"capability":1}`), nil); err != nil || !saved {
		t.Fatal(saved, err)
	}
	s.Close()
	s = openTestStore(t, dir)
	defer s.Close()
	if value, hit, err := s.ReadPreparation(ctx, k); err != nil || !hit || string(value) != `{"capability":1}` {
		t.Fatal(hit, err)
	}
	if err := s.BeginImageInspection(ctx, strings.Repeat("b", 32), k.Image); err != nil {
		t.Fatal(err)
	}
	if err := s.RecoverImageInspections(ctx); err != nil {
		t.Fatal(err)
	}
	if _, hit, err := s.ReadPreparation(ctx, k); err != nil || !hit {
		t.Fatal("cleanup removed success", err)
	}
	for _, raw := range []string{`{`, `{"format":99}`, `{"format":1,"format":1}`, strings.Repeat("x", PreparationResultLimit+1)} {
		if err := s.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec("UPDATE control_metadata SET value_json=? WHERE key=?", raw, k.storageKey())
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if _, hit, err := s.ReadPreparation(ctx, k); err != nil || hit {
			t.Fatal("malformed record accepted", err)
		}
	}
	if _, err := s.WritePreparation(ctx, k, json.RawMessage(`null`), nil); err == nil {
		t.Fatal("null accepted")
	}
	other := openTestStore(t, t.TempDir())
	defer other.Close()
	// Even a copied private row must not be trusted by another installation.
	if _, err := s.WritePreparation(ctx, k, json.RawMessage(`{}`), nil); err != nil {
		t.Fatal(err)
	}
	var copied string
	if err := s.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", k.storageKey()).Scan(&copied)
	}); err != nil {
		t.Fatal(err)
	}
	if err := other.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", k.storageKey(), copied, "fixture")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, hit, err := other.ReadPreparation(ctx, k); err != nil || hit {
		t.Fatal("cross-install hit", err)
	}
	for _, mutate := range []func(*preparationRecord){
		func(r *preparationRecord) { r.Format = 2 },
		func(r *preparationRecord) { r.Key.Version++ },
		func(r *preparationRecord) { r.Key.Engine = strings.Repeat("b", 64) },
	} {
		var record preparationRecord
		if err := json.Unmarshal([]byte(copied), &record); err != nil {
			t.Fatal(err)
		}
		mutate(&record)
		raw, _ := json.Marshal(record)
		if err := s.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec("UPDATE control_metadata SET value_json=? WHERE key=?", string(raw), k.storageKey())
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if _, hit, err := s.ReadPreparation(ctx, k); err != nil || hit {
			t.Fatal("mismatched record accepted", err)
		}
	}
}
func TestPreparationCapacityPinsAndFailedCommit(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	var pins []PreparationKey
	for n := 0; n < PreparationResultCapacity; n++ {
		k := preparationFixtureKey(n)
		pins = append(pins, k)
		if saved, err := s.WritePreparation(ctx, k, json.RawMessage(`{}`), nil); err != nil || !saved {
			t.Fatal(saved, err)
		}
	}
	k := preparationFixtureKey(100)
	if saved, err := s.WritePreparation(ctx, k, json.RawMessage(`{}`), pins); err != nil || saved {
		t.Fatal("evicted protected record", saved, err)
	}
	if saved, err := s.WritePreparation(ctx, k, json.RawMessage(`{}`), pins[1:]); err != nil || !saved {
		t.Fatal(saved, err)
	}
	if _, hit, err := s.ReadPreparation(ctx, pins[0]); err != nil || hit {
		t.Fatal("oldest unprotected record retained", err)
	}
	if saved, err := s.WritePreparation(ctx, pins[0], json.RawMessage(`{"rebuilt":true}`), pins[1:]); err != nil || !saved {
		t.Fatal("evicted record could not be rebuilt", saved, err)
	}
	if value, hit, err := s.ReadPreparation(ctx, pins[0]); err != nil || !hit || string(value) != `{"rebuilt":true}` {
		t.Fatal("rebuilt result was not reusable", hit, err)
	}
	oversized, err := json.Marshal(strings.Repeat("x", PreparationResultLimit))
	if err != nil {
		t.Fatal(err)
	}
	if saved, err := s.WritePreparation(ctx, pins[0], oversized, nil); err == nil || saved {
		t.Fatal("oversized result was accepted", saved, err)
	}
	if value, hit, err := s.ReadPreparation(ctx, pins[0]); err != nil || !hit || string(value) != `{"rebuilt":true}` {
		t.Fatal("oversized write changed an existing result", hit, err)
	}
	// Failure after eviction must roll back the deletion and the new publication.
	if err := s.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("CREATE TEMP TRIGGER preparation_fail BEFORE INSERT ON control_metadata BEGIN SELECT RAISE(ABORT,'fixture'); END")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if saved, err := s.WritePreparation(ctx, preparationFixtureKey(101), json.RawMessage(`{}`), nil); err == nil || saved {
		t.Fatal("failed insertion reported success")
	}
	if _, hit, err := s.ReadPreparation(ctx, pins[1]); err != nil || !hit {
		t.Fatal("failed transaction lost victim", err)
	}
}

func TestPreparationTouchProtectsRecentResult(t *testing.T) {
	ctx := context.Background()
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	for n := 0; n < PreparationResultCapacity; n++ {
		if saved, err := s.WritePreparation(ctx, preparationFixtureKey(n), json.RawMessage(`{}`), nil); err != nil || !saved {
			t.Fatal(saved, err)
		}
	}
	if err := s.TouchPreparations(ctx, []PreparationKey{preparationFixtureKey(0)}); err != nil {
		t.Fatal(err)
	}
	if saved, err := s.WritePreparation(ctx, preparationFixtureKey(100), json.RawMessage(`{}`), nil); err != nil || !saved {
		t.Fatal(saved, err)
	}
	if _, hit, err := s.ReadPreparation(ctx, preparationFixtureKey(0)); err != nil || !hit {
		t.Fatal("recent record evicted", err)
	}
	if _, hit, err := s.ReadPreparation(ctx, preparationFixtureKey(1)); err != nil || hit {
		t.Fatal("old record retained", err)
	}
}

func TestPreparationCancellationWhileWaitingToPublish(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	entered, release := make(chan struct{}), make(chan struct{})
	writerDone := make(chan error, 1)
	go func() {
		writerDone <- store.Write(context.Background(), func(*sql.Tx) error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	ctx, cancel := context.WithCancel(context.Background())
	published := make(chan error, 1)
	key := preparationFixtureKey(99)
	go func() {
		_, err := store.WritePreparation(ctx, key, json.RawMessage(`{"complete":true}`), nil)
		published <- err
	}()
	cancel()
	select {
	case err := <-published:
		if err == nil {
			t.Fatal("cancelled publication reported success")
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("cancelled publication waited for another writer")
	}
	close(release)
	if err := <-writerDone; err != nil {
		t.Fatal(err)
	}
	if _, hit, err := store.ReadPreparation(context.Background(), key); err != nil || hit {
		t.Fatal("cancelled publication created a reusable record", hit, err)
	}
}
