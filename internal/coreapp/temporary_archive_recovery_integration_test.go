//go:build integration

package coreapp

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
)

func TestNativeTemporaryArchiveResultSurvivesRemovalAndDiagnosticFailure(t *testing.T) {
	a, _, _, workID, ctx := nativeApplyFixture(t)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	for _, scenario := range []struct {
		name, expected string
		reader         fakeFullLogReader
	}{
		{"archived", "archived", fakeFullLogReader{stdout: [][]byte{[]byte("2026-01-01T00:00:01Z safe-fixture-output\n")}}},
		{"partial", "partial", fakeFullLogReader{stdout: [][]byte{[]byte("2026-01-01T00:00:01Z safe-fixture-output\n")}, err: dockerengine.ErrStreamLimit}},
		{"missing", "unavailable", fakeFullLogReader{err: dockerengine.ErrResourceMissing}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-archive-" + scenario.name, Generation: generation, InstanceID: instance}
			lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
			if err != nil {
				t.Fatal(err)
			}
			definition, _ := json.Marshal(map[string]any{"name": "archive-" + scenario.name, "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", "setInterval(()=>{},1000)"}, "workingDirectory": "/"})
			admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
			created, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, definition, "archive-"+scenario.name, &admission)
			if err != nil {
				t.Fatal(err)
			}
			op, err := a.Store.Operation(ctx, created.OperationID)
			if err != nil {
				t.Fatal(err)
			}
			if err := a.processServiceOperation(ctx, op); err != nil {
				t.Fatal(err)
			}
			value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
			lock := value.(*sync.Mutex)
			lock.Lock()
			defer lock.Unlock()
			a.fullLogReaderForTest = &scenario.reader
			defer func() { a.fullLogReaderForTest = nil }()
			if err := a.closeTemporaryRunAndRequestCleanup(ctx, owner, "run-cancelled"); err != nil {
				t.Fatal(err)
			}
			var record corestore.TemporaryServiceRecord
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var found bool
				var err error
				record, found, err = corestore.ReadTemporaryServiceTx(tx, workID, created.ServiceID)
				if err != nil || !found || record.ContainerID == "" {
					return fmt.Errorf("original identity unavailable: %v", err)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`CREATE TRIGGER fail_remove_result BEFORE UPDATE ON control_metadata WHEN NEW.key LIKE 'run-temporary-service:cleanup:%' AND instr(NEW.value_json, '"stage":"remove","outcome":"succeeded"') > 0 BEGIN SELECT RAISE(ABORT, 'injected result failure'); END`)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if err := a.cleanupTemporaryService(ctx, record); err == nil {
				t.Fatal("injected diagnostic failure was ignored")
			}
			view, _, err := a.inspectServiceRuntime(ctx, workID, created.ServiceID)
			if err != nil || view != nil {
				t.Fatal("fault did not occur after exact container removal", err)
			}
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`DROP TRIGGER fail_remove_result`)
				return err
			}); err != nil {
				t.Fatal(err)
			}
			if err := a.cleanupTemporaryService(ctx, record); err != nil {
				t.Fatal("cleanup did not resume", err)
			}
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				cleanup, found, err := corestore.ReadTemporaryCleanupTx(tx, workID, created.ServiceID)
				if err != nil || !found || cleanup.State != "completed" || cleanup.LogState != scenario.expected {
					return fmt.Errorf("archive outcome lost on retry: %+v: %v", cleanup, err)
				}
				raw, _ := json.Marshal(cleanup)
				if strings.Contains(string(raw), "safe-fixture-output") || strings.Contains(string(raw), lease.LeaseID) {
					return fmt.Errorf("cleanup diagnostics leaked private output or lease")
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
