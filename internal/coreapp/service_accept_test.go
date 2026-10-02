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
	"piwork/internal/identity"
	"piwork/internal/internaltls"
)

func serviceAcceptFixture(t *testing.T) (*Application, serviceActor, string) {
	t.Helper()
	ctx := context.Background()
	// This fixture exercises durable acceptance only and inserts synthetic Agent
	// generations. It has no Engine resources to drain during cleanup.
	a, _, _ := appFixture(t, Options{Shutdown: func(context.Context, *Application) error { return nil }, Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}, Runtime: &RuntimeInput{AgentImage: "fixture/native", Provider: "fixture", Model: "fixture", Credential: "acceptance-only"}}, DependencyCheck: func(context.Context, *Application, RuntimeProfile) error { return nil }})
	login, err := a.Identity.Login(ctx, "admin", "development-fixture-pass", "service-accept")
	if err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	principal := session.Principal()
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config := *defaults.Configuration
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	id := "work-service-fixture1"
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.InsertWork(tx, corestore.WorkRecord{ID: id, OwnerUserID: principal.UserID, Name: "计数服务", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()}); err != nil {
			return err
		}
		if err := corestore.InsertConfiguration(tx, corestore.ConfigurationRevision{WorkID: id, Revision: 1, ConfigJSON: string(raw), CreatedByUserID: principal.UserID, CreatedAt: packageNow()}); err != nil {
			return err
		}
		return corestore.ReserveQuota(tx, corestore.QuotaReservation{WorkID: id, SubjectKind: "agent", SubjectID: "agentd", DesiredCPUMillis: config.Resources.AgentCpuMillis, DesiredMemoryBytes: config.Resources.AgentMemoryBytes, UpdatedAt: packageNow()}, corestore.QuotaLimits{CPUMillis: config.Resources.CpuMillis, MemoryBytes: config.Resources.MemoryBytes}, corestore.QuotaLimits{CPUMillis: 128000, MemoryBytes: 256 << 30})
	}); err != nil {
		t.Fatal(err)
	}
	return a, serviceActor{User: &principal}, id
}
func serviceRaw(name string, cpu int64) json.RawMessage {
	return json.RawMessage(fmt.Sprintf(`{"name":%q,"image":{"reference":"python:3.13-slim"},"command":"python","workingDirectory":"/","cpuMillis":%d}`, name, cpu))
}
func TestServiceAcceptanceNormalizesReplaysAndRejectsStaleUpdate(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	ctx := context.Background()
	first, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, serviceRaw("counter", 250), "once")
	if err != nil {
		t.Fatal(err)
	}
	normalized, err := normalizeServiceDefinition(serviceRaw("counter", 250))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(normalized)
	replay, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, raw, "once")
	if err != nil || !replay.Reused || replay.ServiceID != first.ServiceID || replay.OperationID != first.OperationID {
		t.Fatal("explicit defaults changed accepted identity", replay, err)
	}
	if _, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, serviceRaw("counter", 300), "once"); err == nil {
		t.Fatal("idempotency conflict accepted")
	}
	updated, err := a.acceptServiceDefinition(ctx, actor, id, first.ServiceID, 1, serviceRaw("counter", 300), "update")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.acceptServiceDefinition(ctx, actor, id, first.ServiceID, 1, serviceRaw("counter", 350), "stale-update"); err == nil {
		t.Fatal("stale expectedRevision accepted")
	}
	record, err := a.Store.Service(ctx, id, first.ServiceID, false)
	if err != nil || record.DesiredRevision != 2 || record.AppliedRevision != nil {
		t.Fatal("incorrect immutable revision history", record, err)
	}
	original, err := a.Store.Operation(ctx, first.OperationID)
	if err != nil || original.State != "superseded" {
		t.Fatal("earlier accepted target not fenced", original, err)
	}
	if _, err := a.Store.CompleteOperation(ctx, updated.OperationID, "succeeded", nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var revisions, operations int
		if err := tx.QueryRow(`SELECT count(*) FROM service_revisions WHERE work_id=?`, id).Scan(&revisions); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM operations WHERE work_id=?`, id).Scan(&operations); err != nil {
			return err
		}
		if revisions != 2 || operations != 2 {
			t.Fatal("rejected request wrote durable state", revisions, operations)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestServiceQuotaAcceptanceSerializesConcurrentReservations(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	ctx := context.Background()
	var group sync.WaitGroup
	var mu sync.Mutex
	accepted, rejected := 0, 0
	for i := 0; i < 2; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			_, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, serviceRaw(fmt.Sprintf("service%d", i), 750), fmt.Sprintf("quota%d", i))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				accepted++
			} else {
				_, view := contracts.ProjectError(err)
				if view.Code != "QUOTA_EXCEEDED" {
					t.Errorf("unexpected error: %v", err)
				}
				rejected++
			}
		}(i)
	}
	group.Wait()
	if accepted != 1 || rejected != 1 {
		t.Fatal("concurrent reservations exceeded Work budget", accepted, rejected)
	}
	services, err := a.Store.Services(ctx, id, false)
	if err != nil || len(services) != 1 {
		t.Fatal("rejected quota left service head", services, err)
	}
}

func TestServiceConcurrentUpdatesAcceptOnlyOneExpectedRevision(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	ctx := context.Background()
	created, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, serviceRaw("counter", 250), "create")
	if err != nil {
		t.Fatal(err)
	}
	results := make(chan error, 2)
	start := make(chan struct{})
	for i := 0; i < 2; i++ {
		go func(i int) {
			<-start
			_, err := a.acceptServiceDefinition(ctx, actor, id, created.ServiceID, 1, serviceRaw("counter", int64(300+i*50)), fmt.Sprintf("update-%d", i))
			results <- err
		}(i)
	}
	close(start)
	accepted, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		if err := <-results; err == nil {
			accepted++
		} else {
			_, view := contracts.ProjectError(err)
			if view.Code != "REVISION_CONFLICT" {
				t.Fatal("unexpected concurrent result", err)
			}
			conflicts++
		}
	}
	if accepted != 1 || conflicts != 1 {
		t.Fatal(accepted, conflicts)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var revisions, operations int
		if err := tx.QueryRow(`SELECT count(*) FROM service_revisions WHERE work_id=?`, id).Scan(&revisions); err != nil {
			return err
		}
		if err := tx.QueryRow(`SELECT count(*) FROM operations WHERE work_id=?`, id).Scan(&operations); err != nil {
			return err
		}
		if revisions != 2 || operations != 2 {
			t.Fatal("conflict wrote durable state", revisions, operations)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestServiceSlotQuotaIncludesNewAndDisabledHeads(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE work_config_revisions SET config_json=json_set(config_json,'$.resources.maxServices',1) WHERE work_id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	first, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, serviceRaw("counter", 250), "create")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := a.acceptServiceAction(ctx, actor, id, first.ServiceID, "stop", "disable"); err != nil {
		t.Fatal(err)
	}
	_, err = a.acceptServiceDefinition(ctx, actor, id, "", 0, serviceRaw("other", 250), "overflow")
	_, view := contracts.ProjectError(err)
	if view.Code != "QUOTA_EXCEEDED" {
		t.Fatal("disabled head did not occupy slot", err)
	}
	services, err := a.Store.Services(ctx, id, false)
	if err != nil || len(services) != 1 {
		t.Fatal("rejected slot left head", services, err)
	}
}
func TestServiceAgentIdempotencySurvivesGenerationChangeButRejectsStaleActor(t *testing.T) {
	a, owner, id := serviceAcceptFixture(t)
	ctx := context.Background()
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, id)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,1,'agent-first','ready',0,?,?)`, id, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: id, Generation: 1, InstanceID: "agent-first"}
	first, err := a.acceptServiceDefinition(ctx, serviceActor{Runtime: &scope}, id, "", 0, serviceRaw("agent-created", 250), "stable-key")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE runtime_generations SET state='stopped' WHERE work_id=?`, id); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,2,'agent-next','ready',0,?,?)`, id, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := a.acceptServiceDefinition(ctx, serviceActor{Runtime: &scope}, id, "", 0, serviceRaw("agent-created", 250), "stable-key"); !errors.Is(err, internaltls.ErrStale) {
		t.Fatal("old Agent accepted after replacement", err)
	}
	scope.Generation = 2
	scope.InstanceID = "agent-next"
	replay, err := a.acceptServiceDefinition(ctx, serviceActor{Runtime: &scope}, id, "", 0, serviceRaw("agent-created", 250), "stable-key")
	if err != nil || !replay.Reused || replay.OperationID != first.OperationID || replay.ServiceID != first.ServiceID {
		t.Fatal("generation changed stable Work scope", replay, err)
	}
	for _, state := range []string{"initializing", "starting", "draining", "failed", "superseded"} {
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			_, err := tx.Exec(`UPDATE runtime_generations SET state=? WHERE work_id=? AND generation=2`, state, id)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if _, err := a.acceptServiceDefinition(ctx, serviceActor{Runtime: &scope}, id, "", 0, serviceRaw("agent-created", 250), "stable-key"); !errors.Is(err, internaltls.ErrStale) {
			t.Fatal("inactive generation replayed a mutation", state, err)
		}
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE runtime_generations SET state='ready' WHERE work_id=? AND generation=2`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	// An owner action has a distinct idempotency namespace from the Agent.
	action, err := a.acceptServiceAction(ctx, owner, id, first.ServiceID, "stop", "stable-key")
	if err != nil || action.Reused {
		t.Fatal(action, err)
	}
	record, err := a.Store.Service(ctx, id, first.ServiceID, false)
	if err != nil || record.Enabled {
		t.Fatal("service stop did not persist disabled", record, err)
	}
}
func TestServiceRejectedDefinitionsAndForeignOwnerHaveNoEffects(t *testing.T) {
	a, actor, id := serviceAcceptFixture(t)
	ctx := context.Background()
	other, err := a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "foreign", "development-fixture-pass", "user")
	if err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(ctx, "foreign", "development-fixture-pass", "service")
	if err != nil {
		t.Fatal(err)
	}
	session, err := a.Identity.Authenticate(ctx, login.Token)
	if err != nil {
		t.Fatal(err)
	}
	principal := session.Principal()
	if principal.UserID != string(other.Id) {
		t.Fatal("wrong fixture identity")
	}
	for _, target := range []string{id, "work-missing-fixture"} {
		_, err := a.acceptServiceDefinition(ctx, serviceActor{User: &principal}, target, "", 0, serviceRaw("foreign", 250), "foreign")
		_, view := contracts.ProjectError(err)
		if view.Code != "NOT_FOUND" {
			t.Fatal("foreign Work distinguishable", target, err)
		}
	}
	for _, raw := range []json.RawMessage{json.RawMessage(`{"name":"bad","command":"python","image":{"reference":"python"},"privileged":true}`), json.RawMessage(`{"name":"bad","command":"python","image":{"reference":"python"},"mounts":[{"source":"private","target":"/var/data/workspace","readOnly":false}]}`)} {
		if _, err := a.acceptServiceDefinition(ctx, actor, id, "", 0, raw, "invalid"); err == nil {
			t.Fatal("invalid definition accepted")
		}
	}
	services, err := a.Store.Services(ctx, id, true)
	if err != nil || len(services) != 0 {
		t.Fatal("rejected request left durable definition", services, err)
	}
}
