package corestore

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"piwork/internal/safefs"
)

func TestShutdownBoundsInternalTransactions(t *testing.T) {
	for _, write := range []bool{false, true} {
		for _, twoPhase := range []bool{false, true} {
			for _, canceled := range []bool{false, true} {
				t.Run(fmt.Sprintf("write=%t/two-phase=%t/cancel=%t", write, twoPhase, canceled), func(t *testing.T) {
					directory := t.TempDir()
					store := openTestStore(t, directory)
					entered, gate := make(chan struct{}), make(chan struct{})
					var once sync.Once
					unblock := func() { once.Do(func() { close(gate) }) }
					defer unblock()
					transaction := store.Read
					if write {
						transaction = store.Write
					}
					transactionDone := make(chan error, 1)
					go func() {
						transactionDone <- transaction(context.Background(), func(tx *sql.Tx) error {
							if write {
								if _, err := tx.Exec("INSERT INTO control_metadata VALUES('held-write','1','synthetic')"); err != nil {
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
								_, err = tx.Exec("INSERT INTO control_metadata VALUES('late-write','2','synthetic')")
							}
							return err
						})
					}()
					select {
					case <-entered:
					case <-time.After(time.Second):
						t.Fatal("transaction did not start")
					}
					ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
					defer cancel()
					if canceled {
						cancel()
					}
					closeDone := make(chan error, 1)
					go func() {
						if twoPhase {
							closeDone <- store.CloseDatabase(ctx)
						} else {
							closeDone <- store.CloseContext(ctx)
						}
					}()
					select {
					case err := <-closeDone:
						if err == nil {
							t.Fatal("active transaction shutdown reported success")
						}
					case <-time.After(400 * time.Millisecond):
						t.Fatal("shutdown ignored context while an internal transaction callback was blocked")
					}
					if !errors.Is(store.Read(context.Background(), nil), ErrClosed) || !errors.Is(store.Write(context.Background(), nil), ErrClosed) {
						t.Fatal("closing store admitted a new transaction")
					}
					if twoPhase {
						root, err := safefs.OpenExistingRoot(directory)
						if err != nil {
							t.Fatal(err)
						}
						err = root.Lock()
						root.Close()
						if !errors.Is(err, safefs.ErrLocked) {
							t.Fatal("database phase released installation ownership", err)
						}
					}
					go func() { closeDone <- store.Close() }()
					select {
					case err := <-closeDone:
						if err == nil {
							t.Fatal("repeated close erased the unconfirmed outcome")
						}
					case <-time.After(400 * time.Millisecond):
						t.Fatal("canceled SQL transaction still waited for its callback")
					}
					next := openTestStore(t, directory)
					defer next.Close()
					unblock()
					if err := <-transactionDone; err == nil {
						t.Fatal("old transaction retained SQL access after shutdown")
					}
					if err := next.Read(context.Background(), func(tx *sql.Tx) error {
						var n int
						if err := tx.QueryRow("SELECT count(*) FROM control_metadata WHERE key IN ('held-write','late-write')").Scan(&n); err != nil {
							return err
						}
						if n != 0 {
							return errors.New("uncommitted or late old transaction write was published")
						}
						return nil
					}); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
}

func TestShutdownDrainsTransactionWithinBudget(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	entered, gate := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(gate) }) }
	defer unblock()
	transactionDone := make(chan error, 1)
	go func() {
		transactionDone <- store.Write(context.Background(), func(tx *sql.Tx) error {
			close(entered)
			<-gate
			_, err := tx.Exec("INSERT INTO control_metadata VALUES('drained-write','1','synthetic')")
			return err
		})
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	closed := make(chan error, 1)
	go func() { closed <- store.CloseContext(ctx) }()
	select {
	case err := <-closed:
		t.Fatal("shutdown did not drain the active transaction", err)
	case <-time.After(20 * time.Millisecond):
	}
	unblock()
	if err := <-transactionDone; err != nil {
		t.Fatal("graceful drain canceled a transaction", err)
	}
	if err := <-closed; err != nil {
		t.Fatal(err)
	}
	next := openTestStore(t, directory)
	defer next.Close()
	if err := next.Read(context.Background(), func(tx *sql.Tx) error {
		var value string
		return tx.QueryRow("SELECT value_json FROM control_metadata WHERE key='drained-write' AND value_json='1'").Scan(&value)
	}); err != nil {
		t.Fatal("gracefully drained commit was lost", err)
	}
}

type blockingCloseConnector struct{ entered, gate chan struct{} }
type blockingCloseConnection struct {
	failingCloseConnection
	entered, gate chan struct{}
}

func (c blockingCloseConnector) Driver() driver.Driver { return failingCloseDriver{} }
func (c blockingCloseConnector) Connect(context.Context) (driver.Conn, error) {
	return &blockingCloseConnection{entered: c.entered, gate: c.gate}, nil
}
func (c *blockingCloseConnection) Close() error { close(c.entered); <-c.gate; return nil }

func TestShutdownRetainsOwnershipUntilDriverCleanupEnds(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	if err := store.writer.Close(); err != nil {
		t.Fatal(err)
	}
	entered, gate := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(gate) }) }
	defer unblock()
	store.writer = sql.OpenDB(blockingCloseConnector{entered, gate})
	if err := store.writer.Ping(); err != nil {
		t.Fatal(err)
	}
	closed := make(chan error, 1)
	go func() { closed <- store.Close() }()
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("driver close did not start")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	repeated := make(chan error, 1)
	go func() { repeated <- store.CloseContext(ctx) }()
	select {
	case err := <-repeated:
		if err == nil {
			t.Fatal("concurrent close claimed success during driver cleanup")
		}
	case <-time.After(400 * time.Millisecond):
		t.Fatal("concurrent close ignored its own deadline")
	}
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	err = root.Lock()
	root.Close()
	if !errors.Is(err, safefs.ErrLocked) {
		t.Fatal("lock released before driver cleanup ended", err)
	}
	unblock()
	if err := <-closed; err == nil {
		t.Fatal("first close lost the timeout/checkpoint failure")
	}
	next := openTestStore(t, directory)
	if err := next.Close(); err != nil {
		t.Fatal(err)
	}
}

type blockingRollbackConnector struct{ entered, gate chan struct{} }
type blockingRollbackConnection struct {
	failingCloseConnection
	entered, gate chan struct{}
}
type blockingRollbackTransaction struct{ entered, gate chan struct{} }

func (c blockingRollbackConnector) Driver() driver.Driver { return failingCloseDriver{} }
func (c blockingRollbackConnector) Connect(context.Context) (driver.Conn, error) {
	return &blockingRollbackConnection{entered: c.entered, gate: c.gate}, nil
}
func (*blockingRollbackConnection) Close() error                       { return nil }
func (*blockingRollbackConnection) ResetSession(context.Context) error { return nil }
func (*blockingRollbackConnection) IsValid() bool                      { return true }
func (c *blockingRollbackConnection) Begin() (driver.Tx, error) {
	return blockingRollbackTransaction{c.entered, c.gate}, nil
}
func (c *blockingRollbackConnection) BeginTx(context.Context, driver.TxOptions) (driver.Tx, error) {
	return c.Begin()
}
func (blockingRollbackTransaction) Commit() error      { return nil }
func (tx blockingRollbackTransaction) Rollback() error { close(tx.entered); <-tx.gate; return nil }

func TestShutdownWaitsForActualRollbackBeforeReleasingOwnership(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	if err := store.reader.Close(); err != nil {
		t.Fatal(err)
	}
	rollingBack, finishRollback := make(chan struct{}), make(chan struct{})
	var rollbackOnce sync.Once
	releaseRollback := func() { rollbackOnce.Do(func() { close(finishRollback) }) }
	defer releaseRollback()
	store.reader = sql.OpenDB(blockingRollbackConnector{rollingBack, finishRollback})
	entered, gate := make(chan struct{}), make(chan struct{})
	var callbackOnce sync.Once
	releaseCallback := func() { callbackOnce.Do(func() { close(gate) }) }
	defer releaseCallback()
	transactionDone := make(chan error, 1)
	go func() {
		transactionDone <- store.Read(context.Background(), func(*sql.Tx) error { close(entered); <-gate; return nil })
	}()
	select {
	case <-entered:
	case err := <-transactionDone:
		t.Fatal("rollback fixture could not start transaction", err)
	case <-time.After(time.Second):
		t.Fatal("rollback fixture transaction did not start")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	closed := make(chan error, 1)
	go func() { closed <- store.CloseContext(ctx) }()
	select {
	case err := <-closed:
		if err == nil {
			t.Fatal("blocked rollback reported success")
		}
	case <-time.After(400 * time.Millisecond):
		t.Fatal("blocked rollback exceeded caller budget")
	}
	select {
	case <-rollingBack:
	case <-time.After(time.Second):
		t.Fatal("shutdown did not cancel the transaction")
	}
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	err = root.Lock()
	root.Close()
	if !errors.Is(err, safefs.ErrLocked) {
		t.Fatal("ownership released while actual rollback was still running", err)
	}
	releaseRollback()
	select {
	case <-store.databaseCloseDone:
	case <-time.After(400 * time.Millisecond):
		t.Fatal("finished rollback still waited for its caller")
	}
	next := openTestStore(t, directory)
	defer next.Close()
	releaseCallback()
	if err := <-transactionDone; err == nil {
		t.Fatal("canceled old transaction committed")
	}
}

func TestWriterAdmissionHonorsCancellation(t *testing.T) {
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	entered, gate := make(chan struct{}), make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(gate) }) }
	defer unblock()
	first := make(chan error, 1)
	go func() {
		first <- store.Write(context.Background(), func(*sql.Tx) error { close(entered); <-gate; return nil })
	}()
	<-entered
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	second := make(chan error, 1)
	go func() {
		second <- store.Write(ctx, func(*sql.Tx) error { return errors.New("canceled writer acquired the connection") })
	}()
	select {
	case err := <-second:
		if !errors.Is(err, ErrStorage) {
			t.Fatal("canceled writer reached the callback", err)
		}
	case <-time.After(400 * time.Millisecond):
		t.Fatal("writer admission ignored cancellation")
	}
	unblock()
	if err := <-first; err != nil {
		t.Fatal(err)
	}
}
