package corestore

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/safefs"
	"piwork/internal/testsupport/sqlitefixture"
)

type failingCloseConnector struct{ closed *int }
type failingCloseDriver struct{}
type failingCloseConnection struct{ closed *int }

func (failingCloseDriver) Open(string) (driver.Conn, error) {
	return nil, errors.New("unused fixture entry")
}
func (c failingCloseConnector) Driver() driver.Driver { return failingCloseDriver{} }
func (c failingCloseConnector) Connect(context.Context) (driver.Conn, error) {
	return &failingCloseConnection{c.closed}, nil
}
func (c *failingCloseConnection) Close() error {
	*c.closed++
	return errors.New("private-sqlite-close-detail")
}
func (*failingCloseConnection) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("private-sqlite-query-detail")
}
func (*failingCloseConnection) Begin() (driver.Tx, error) {
	return nil, errors.New("unused fixture transaction")
}

func TestDatabaseCloseFailuresStillCloseOtherHandlesAndReleaseLock(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	store.reader.Close()
	store.writer.Close()
	var readersClosed, writersClosed int
	store.reader = sql.OpenDB(failingCloseConnector{&readersClosed})
	store.writer = sql.OpenDB(failingCloseConnector{&writersClosed})
	if err := store.reader.Ping(); err != nil {
		t.Fatal(err)
	}
	if err := store.writer.Ping(); err != nil {
		t.Fatal(err)
	}
	err := store.Close()
	if !errors.Is(err, ErrShutdown) || readersClosed != 1 || writersClosed != 1 || strings.Contains(err.Error(), "private-sqlite") {
		t.Fatal("failed handle close leaked resources or details", err, readersClosed, writersClosed)
	}
	store = openTestStore(t, directory)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestCheckpointAndTwoPhaseClosePreserveWALAndOwnership(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	id := store.InstallationID()
	release := sqlitefixture.PartialWAL(t, filepath.Join(directory, DatabaseName))
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	started := time.Now()
	err := store.CloseDatabase(ctx)
	if !errors.Is(err, ErrCheckpoint) || time.Since(started) > 500*time.Millisecond {
		t.Fatal("busy checkpoint was accepted or exceeded budget", err, time.Since(started))
	}
	if !errors.Is(store.Read(context.Background(), nil), ErrClosed) || !errors.Is(store.Write(context.Background(), nil), ErrClosed) {
		t.Fatal("database still admits transactions after close")
	}
	command := exec.Command(os.Args[0], "-test.run=^TestClosingStoreOwnershipChild$")
	command.Env = append(os.Environ(), "PIWORK_CLOSING_STORE_CHILD="+directory)
	if out, err := command.CombinedOutput(); err != nil {
		t.Fatalf("closing store lost ownership: %s %v", out, err)
	}
	if err := store.CloseContext(ctx); !errors.Is(err, ErrCheckpoint) {
		t.Fatal("final phase lost checkpoint failure", err)
	}
	if err := store.Close(); !errors.Is(err, ErrCheckpoint) {
		t.Fatal("repeated close erased failure", err)
	}
	release()
	store = openTestStore(t, directory)
	assertWALValue(t, store, id)
	if err := store.Close(); err != nil {
		t.Fatal("recovered store cannot close", err)
	}
}

func TestClosingStoreOwnershipChild(t *testing.T) {
	directory := os.Getenv("PIWORK_CLOSING_STORE_CHILD")
	if directory == "" {
		return
	}
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err := root.Lock(); !errors.Is(err, safefs.ErrLocked) {
		t.Fatal("closing owner released its lock", err)
	}
}

func TestCheckpointSQLFailureStillReleasesStore(t *testing.T) {
	directory := t.TempDir()
	store := openTestStore(t, directory)
	if err := checkpointDatabase(context.Background(), store.writer); err != nil {
		t.Fatal("normal checkpoint", err)
	}
	if err := store.writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); !errors.Is(err, ErrCheckpoint) {
		t.Fatal("SQL execution failure swallowed", err)
	}
	store = openTestStore(t, directory)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestInitializationBlockedCheckpointDoesNotPublish(t *testing.T) {
	directory := t.TempDir()
	id := "installation-wal-initialize-00000001"
	var release func()
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	_, err := Open(ctx, Options{Directory: directory, InstallationID: id, fault: func(stage string) error {
		if stage == "after-database-commit" {
			release = sqlitefixture.HoldReader(t, filepath.Join(directory, databaseTemp(id)))
		}
		return nil
	}})
	if !errors.Is(err, ErrStorage) || release == nil {
		t.Fatal("unconfirmed initialization published", err)
	}
	if _, err := os.Stat(filepath.Join(directory, DatabaseName)); !os.IsNotExist(err) {
		t.Fatal("database published before checkpoint", err)
	}
	root, err := safefs.OpenExistingRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	marker, err := readMarker(root, MarkerName)
	root.Close()
	if err != nil || marker.Phase != "initializing" {
		t.Fatal("unconfirmed ready marker", marker, err)
	}
	release()
	store := openTestStore(t, directory)
	if store.InstallationID() != id {
		t.Fatal("retry changed installation identity")
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
}
