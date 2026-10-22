package coreapp

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"piwork/internal/corelogs"
	"piwork/internal/corestore"
	"piwork/internal/safefs"
	"piwork/internal/testsupport/sqlitefixture"
)

func TestSQLiteReaderChild(t *testing.T) { sqlitefixture.ReaderChild(t) }

func newStorageShutdownApp(t *testing.T, options Options) *Application {
	t.Helper()
	if options.DataDirectory == "" {
		options.DataDirectory = t.TempDir()
	}
	a, err := New(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = a.Close(context.Background()) })
	return a
}

func shutdownOutcomes(t *testing.T, directory string) []string {
	t.Helper()
	var result []string
	for _, record := range readCoreLogRecords(t, directory) {
		if record["event"] == "app.shutdown" {
			fields, _ := record["fields"].(map[string]any)
			result = append(result, fields["outcome"].(string))
		}
	}
	return result
}

// An expired in-process Close may return just before its SQL cleanup owner
// finishes. Verify ownership is automatically released without another Close.
// The real Core process also releases its fds when its supervisor exits.
func waitForShutdownStoreRelease(t *testing.T, directory string) {
	t.Helper()
	deadline := time.NewTimer(500 * time.Millisecond)
	defer deadline.Stop()
	tick := time.NewTicker(time.Millisecond)
	defer tick.Stop()
	for {
		root, err := safefs.OpenExistingRoot(directory)
		if err != nil {
			t.Fatal("shutdown store directory became unsafe", err)
		}
		err = root.Lock()
		_ = root.Close()
		if err == nil {
			return
		}
		if !errors.Is(err, safefs.ErrLocked) {
			t.Fatal("cannot inspect shutdown store ownership", err)
		}
		select {
		case <-deadline.C:
			t.Fatal("shutdown retained store lock after SQL cleanup")
		case <-tick.C:
		}
	}
}

func TestShutdownStorageBusyIsUnconfirmedAndReopensWAL(t *testing.T) {
	for _, exhausted := range []bool{false, true} {
		t.Run(map[bool]string{false: "remaining-budget", true: "exhausted-budget"}[exhausted], func(t *testing.T) {
			options := Options{ShutdownTimeout: 80 * time.Millisecond}
			if exhausted {
				options.Shutdown = func(ctx context.Context, _ *Application) error { <-ctx.Done(); return ctx.Err() }
			}
			a := newStorageShutdownApp(t, options)
			id := a.Store.InstallationID()
			release := sqlitefixture.PartialWAL(t, filepath.Join(a.options.DataDirectory, corestore.DatabaseName))
			started := time.Now()
			err := a.Close(context.Background())
			if err == nil || time.Since(started) > 500*time.Millisecond {
				t.Fatal("storage shutdown was accepted or exceeded remaining budget", err, time.Since(started))
			}
			if strings.Contains(err.Error(), a.options.DataDirectory) || strings.Contains(err.Error(), "sqlite_") {
				t.Fatal("unsafe storage diagnostic", err)
			}
			outcomes := shutdownOutcomes(t, a.options.DataDirectory)
			if len(outcomes) != 1 || outcomes[0] != "unconfirmed" {
				t.Fatal("storage failure recorded as successful shutdown", outcomes)
			}
			_ = a.Close(context.Background())
			if len(shutdownOutcomes(t, a.options.DataDirectory)) != 1 {
				t.Fatal("repeated cleanup wrote a second conclusion")
			}
			release()
			next := newStorageShutdownApp(t, Options{DataDirectory: a.options.DataDirectory})
			if next.Store.InstallationID() != id {
				t.Fatal("reopen changed identity")
			}
			if err := next.Store.Read(context.Background(), func(tx *sql.Tx) error {
				var value string
				if err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key='wal-fixture-00999'").Scan(&value); err != nil {
					return err
				}
				if value != sqlitefixture.Value(999) {
					t.Fatal("WAL commit lost")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := next.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestShutdownBoundsInternalTransactionCallbacks(t *testing.T) {
	for _, write := range []bool{false, true} {
		t.Run(map[bool]string{false: "read", true: "write"}[write], func(t *testing.T) {
			a := newStorageShutdownApp(t, Options{ShutdownTimeout: 50 * time.Millisecond})
			entered, gate := make(chan struct{}), make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(gate) }) }
			defer unblock()
			transaction := a.Store.Read
			if write {
				transaction = a.Store.Write
			}
			transactionDone := make(chan error, 1)
			go func() {
				transactionDone <- transaction(context.Background(), func(tx *sql.Tx) error {
					if write {
						if _, err := tx.Exec("INSERT INTO control_metadata VALUES('held-shutdown-write','1','synthetic')"); err != nil {
							return err
						}
					} else {
						var n int
						if err := tx.QueryRow("SELECT count(*) FROM control_metadata").Scan(&n); err != nil {
							return err
						}
					}
					close(entered)
					<-gate
					_, err := tx.Exec("SELECT 1")
					if write {
						_, err = tx.Exec("INSERT INTO control_metadata VALUES('late-shutdown-write','2','synthetic')")
					}
					return err
				})
			}()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("internal transaction did not start")
			}
			closeDone := make(chan error, 1)
			go func() { closeDone <- a.Close(context.Background()) }()
			select {
			case err := <-closeDone:
				if err == nil || strings.Contains(err.Error(), a.options.DataDirectory) {
					t.Fatal("shutdown did not return a safe failure", err)
				}
			case <-time.After(500 * time.Millisecond):
				t.Fatal("application shutdown waited for a blocked transaction callback")
			}
			outcomes := shutdownOutcomes(t, a.options.DataDirectory)
			if len(outcomes) != 1 || outcomes[0] != "unconfirmed" {
				t.Fatal("blocked transaction was recorded as successful shutdown", outcomes)
			}
			waitForShutdownStoreRelease(t, a.options.DataDirectory)
			next := newStorageShutdownApp(t, Options{DataDirectory: a.options.DataDirectory})
			unblock()
			if err := <-transactionDone; err == nil {
				t.Fatal("old transaction retained database access")
			}
			if err := next.Store.Read(context.Background(), func(tx *sql.Tx) error {
				var n int
				if err := tx.QueryRow("SELECT count(*) FROM control_metadata WHERE key IN ('held-shutdown-write','late-shutdown-write')").Scan(&n); err != nil {
					return err
				}
				if n != 0 {
					return errors.New("old transaction published data after shutdown")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func replaceStorageTestLogs(t *testing.T, a *Application, fault func(string) error) {
	t.Helper()
	a.detachStandardLog()
	if err := a.logs.Close(); err != nil {
		t.Fatal(err)
	}
	manager, err := corelogs.Open(a.logsRoot, corelogs.Options{SyncInterval: -1, Fault: fault})
	if err != nil {
		t.Fatal(err)
	}
	a.logs = manager
	a.attachStandardLog()
}

func TestShutdownLogFailuresPropagateAndReleaseStore(t *testing.T) {
	for _, stage := range []string{"write", "sync"} {
		t.Run(stage, func(t *testing.T) {
			a := newStorageShutdownApp(t, Options{})
			replaceStorageTestLogs(t, a, func(at string) error {
				if at == stage {
					return errors.New("private-sqlite-path-and-credential")
				}
				return nil
			})
			err := a.Close(context.Background())
			if err == nil || strings.Contains(err.Error(), "private-") {
				t.Fatal("log failure swallowed or exposed", err)
			}
			next := newStorageShutdownApp(t, Options{DataDirectory: a.options.DataDirectory})
			if err := next.Close(context.Background()); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestClosingCoreOwnershipChild(t *testing.T) {
	directory := os.Getenv("PIWORK_CLOSING_CORE_CHILD")
	if directory == "" {
		return
	}
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.Lock(); !errors.Is(err, safefs.ErrLocked) {
		t.Fatal("closing owner released installation lock", err)
	}
}

func TestShutdownHoldsOwnershipUntilFinalLogCloses(t *testing.T) {
	a := newStorageShutdownApp(t, Options{})
	entered, gate := make(chan struct{}), make(chan struct{})
	var enter, release sync.Once
	unblock := func() { release.Do(func() { close(gate) }) }
	defer unblock()
	replaceStorageTestLogs(t, a, func(stage string) error {
		if stage == "write" {
			enter.Do(func() { close(entered); <-gate })
		}
		return nil
	})
	done := make(chan error, 1)
	go func() { done <- a.Close(context.Background()) }()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("final log did not start")
	}
	if !errors.Is(a.Store.Read(context.Background(), nil), corestore.ErrClosed) {
		t.Fatal("final log preceded database close")
	}
	before := snapshotLogShards(t, a.options.DataDirectory)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestClosingCoreOwnershipChild$")
	command.Env = append(os.Environ(), "PIWORK_CLOSING_CORE_CHILD="+a.options.DataDirectory)
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("installation owner lost during logs: %s %v", out, err)
	}
	after := snapshotLogShards(t, a.options.DataDirectory)
	if len(before) != len(after) {
		t.Fatal("second process changed logs")
	}
	for name, size := range before {
		if after[name] != size {
			t.Fatal("second process changed log shard", name)
		}
	}
	unblock()
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	outcomes := shutdownOutcomes(t, a.options.DataDirectory)
	if len(outcomes) != 1 || outcomes[0] != "succeeded" {
		t.Fatal("normal shutdown missing final conclusion", outcomes)
	}
	next := newStorageShutdownApp(t, Options{DataDirectory: a.options.DataDirectory})
	if err := next.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}
