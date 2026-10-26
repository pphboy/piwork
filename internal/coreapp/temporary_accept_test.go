package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
)

func TestTemporaryAdmissionPersistsOwnershipAndFencesLateCreates(t *testing.T) {
	a, _, work := serviceAcceptFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, work); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-current','ready',0,?,?)`, work, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work, Generation: 1, InstanceID: "agent-current"}
	actor := serviceActor{Runtime: &scope}
	owner := corestore.TemporaryRunOwner{WorkID: work, RunID: "run-fixture", Generation: scope.Generation, InstanceID: scope.InstanceID}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	temporary := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "once"}
	foreignWork := temporary
	foreignWork.Owner.WorkID = "work-foreign"
	if _, err := a.acceptServiceDefinitionScoped(ctx, actor, work, "", 0, serviceRaw("foreign", 250), "foreign-key", &foreignWork); err == nil {
		t.Fatal("another Work's Run was accepted")
	}
	accepted, err := a.acceptServiceDefinitionScoped(ctx, actor, work, "", 0, serviceRaw("probe", 250), "temporary-key", &temporary)
	if err != nil {
		t.Fatal(err)
	}
	service, err := a.Store.Service(ctx, work, accepted.ServiceID, false)
	if err != nil {
		t.Fatal(err)
	}
	var definition contracts.ServiceDefinition
	if json.Unmarshal([]byte(service.DefinitionJSON), &definition) != nil || definition.RestartPolicy != "never" || definition.Required {
		t.Fatal("one-time definition can replay or degrade Work", service)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE service_heads SET observed_state='failed' WHERE work_id=? AND service_id=?`, work, accepted.ServiceID); err != nil {
			return err
		}
		return updateServiceWorkObservationTx(tx, work)
	}); err != nil {
		t.Fatal(err)
	}
	current, err := a.Store.Work(ctx, work, false)
	if err != nil || current.ObservedState != "ready" {
		t.Fatal("temporary failure degraded the Work", current.ObservedState, err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM control_metadata WHERE key=?`, "run-temporary-service:service:"+work+":"+accepted.ServiceID).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			t.Fatal("accepted Service has no durable Run association")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.CloseTemporaryRunLease(ctx, owner, packageNow()); err != nil {
		t.Fatal(err)
	}
	replay, err := a.acceptServiceDefinitionScoped(ctx, actor, work, "", 0, serviceRaw("probe", 250), "temporary-key", &temporary)
	if err != nil || !replay.Reused || replay.ServiceID != accepted.ServiceID || replay.OperationID != accepted.OperationID {
		t.Fatal("lost-response replay lost the original acceptance", replay, err)
	}
	if _, err := a.acceptServiceDefinitionScoped(ctx, actor, work, "", 0, serviceRaw("late", 250), "late-key", &temporary); !errors.Is(err, corestore.ErrTemporaryLeaseClosed) {
		t.Fatal("closed Run admitted a new Service", err)
	}
	forged := temporary
	forged.LeaseID = "lease-forged"
	if _, err := a.acceptServiceDefinitionScoped(ctx, actor, work, "", 0, serviceRaw("probe", 250), "temporary-key", &forged); !errors.Is(err, corestore.ErrTemporaryIdentity) {
		t.Fatal("forged lease retrieved an acceptance", err)
	}
	services, err := a.Store.Services(ctx, work, false)
	if err != nil || len(services) != 1 {
		t.Fatal("rejected request wrote an extra Service", services, err)
	}
}

func TestTemporaryAdmissionQuotaSerializesConcurrentCreates(t *testing.T) {
	a, _, work := serviceAcceptFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, work); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-quota','ready',0,?,?)`, work, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work, Generation: 1, InstanceID: "agent-quota"}
	owner := corestore.TemporaryRunOwner{WorkID: work, RunID: "run-quota", Generation: 1, InstanceID: "agent-quota"}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "once"}
	var group sync.WaitGroup
	var mutex sync.Mutex
	accepted, rejected := 0, 0
	for i := 0; i < 2; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			_, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, work, "", 0, serviceRaw(fmt.Sprintf("probe-%d", i), 750), fmt.Sprintf("key-%d", i), &admission)
			mutex.Lock()
			defer mutex.Unlock()
			if err == nil {
				accepted++
				return
			}
			_, view := contracts.ProjectError(err)
			if view.Code != "QUOTA_EXCEEDED" {
				t.Errorf("unexpected rejection: %s", view.Code)
			}
			rejected++
		}(i)
	}
	group.Wait()
	if accepted != 1 || rejected != 1 {
		t.Fatal("temporary quota was oversubscribed", accepted, rejected)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		records, err := corestore.ListTemporaryServicesTx(tx, work, owner.RunID)
		if err != nil {
			return err
		}
		if len(records) != 1 {
			t.Fatal("rejected admission wrote an ownership record", len(records))
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestTemporaryCleanupDiagnosticWriteFailureDoesNotReleaseQuota(t *testing.T) {
	a, _, work := serviceAcceptFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, work); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-diagnostic','ready',0,?,?)`, work, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work, Generation: 1, InstanceID: "agent-diagnostic"}
	owner := corestore.TemporaryRunOwner{WorkID: work, RunID: "run-diagnostic", Generation: 1, InstanceID: "agent-diagnostic"}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "once"}
	accepted, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, work, "", 0, serviceRaw("diagnostic", 250), "diagnostic-create", &admission)
	if err != nil {
		t.Fatal(err)
	}
	if err := a.closeTemporaryRunAndRequestCleanup(ctx, owner, "run-cancelled"); err != nil {
		t.Fatal(err)
	}
	var record corestore.TemporaryServiceRecord
	var cleanup corestore.TemporaryCleanupRecord
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var found bool
		var err error
		record, found, err = corestore.ReadTemporaryServiceTx(tx, work, accepted.ServiceID)
		if err != nil || !found {
			return fmt.Errorf("temporary record unavailable: %v", err)
		}
		cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, work, accepted.ServiceID)
		if err != nil || !found {
			return fmt.Errorf("cleanup record unavailable: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TRIGGER fail_temporary_diagnostic BEFORE UPDATE ON control_metadata BEGIN SELECT RAISE(ABORT, 'injected diagnostic failure'); END`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.cleanupTemporaryService(ctx, record); err == nil {
		t.Fatal("diagnostic write failure was reported as success")
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		current, found, err := corestore.ReadTemporaryCleanupTx(tx, work, accepted.ServiceID)
		if err != nil || !found || current.State == "completed" {
			return fmt.Errorf("cleanup incorrectly completed: %v", err)
		}
		quota, err := corestore.ReadQuotaReservation(tx, work, "service", accepted.ServiceID)
		if err != nil || quota.ServiceSlots != 1 {
			return fmt.Errorf("quota was released without a durable diagnostic: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	operation, err := a.Store.Operation(ctx, cleanup.OperationID)
	if err != nil || operation.State == "succeeded" {
		t.Fatal("cleanup operation falsely succeeded", operation.State, err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='stopped',observed_state='stopped' WHERE id=?`, work)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	_, exportErr := a.snapshotPreflight(ctx, work, "")
	_, public := contracts.ProjectError(exportErr)
	if public.Code != "TEMPORARY_CLEANUP_PENDING" {
		t.Fatal("cold export did not explain the unconfirmed cleanup", public.Code)
	}
}

func TestTemporaryRecoveryDoesNotGuessAnUnavailableRunIsInterrupted(t *testing.T) {
	a, _, workID := serviceAcceptFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, workID); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-unknown','ready',0,?,?)`, workID, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: 1, InstanceID: "agent-unknown"}
	owner := corestore.TemporaryRunOwner{WorkID: workID, RunID: "run-unknown", Generation: 1, InstanceID: "agent-unknown"}
	lease, err := a.Store.OpenTemporaryRunLease(ctx, owner, packageNow())
	if err != nil {
		t.Fatal(err)
	}
	admission := temporaryServiceAdmission{Owner: owner, LeaseID: lease.LeaseID, Mode: "listener"}
	created, err := a.acceptServiceDefinitionScoped(ctx, serviceActor{Runtime: &scope}, workID, "", 0, serviceRaw("unknown", 250), "unknown-run", &admission)
	if err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	contextID := "context-unknown"
	work.ActiveContextID = &contextID
	if trigger := a.confirmTemporaryRunEnd(ctx, work, owner); trigger != "" {
		t.Fatal("unavailable Agent and Engine were treated as confirmed interruption", trigger)
	}
	a.reconcileTemporaryServicesLocked(ctx, workID)
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		open, err := corestore.TemporaryRunOpenTx(tx, owner)
		if err != nil || !open {
			return fmt.Errorf("unknown Run lease was closed: %v", err)
		}
		_, found, err := corestore.ReadTemporaryCleanupTx(tx, workID, created.ServiceID)
		if err != nil || found {
			return fmt.Errorf("unknown Run received cleanup: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,2,'agent-replacement','ready',0,?,?)`, workID, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	a.reconcileTemporaryServicesLocked(ctx, workID)
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		open, err := corestore.TemporaryRunOpenTx(tx, owner)
		if err != nil || open {
			return fmt.Errorf("replaced Agent lease was not closed: %v", err)
		}
		cleanup, found, err := corestore.ReadTemporaryCleanupTx(tx, workID, created.ServiceID)
		if err != nil || !found || cleanup.Trigger != "agent-replaced" || cleanup.OperationID == "" {
			return fmt.Errorf("replacement cleanup was not durably requested: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
