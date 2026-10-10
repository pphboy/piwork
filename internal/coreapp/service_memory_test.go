package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func TestServiceHistoricalMemoryDefaultReplaysOriginalReceipt(t *testing.T) {
	a, actor, work := serviceAcceptFixture(t)
	ctx := context.Background()
	raw := serviceRaw("legacy", 250)
	var fields map[string]any
	if err := json.Unmarshal(raw, &fields); err != nil {
		t.Fatal(err)
	}
	fields["memoryBytes"] = 128 << 20
	explicit, _ := json.Marshal(fields)
	first, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, explicit, "legacy-default")
	if err != nil {
		t.Fatal(err)
	}
	// A synthetic pre-upgrade receipt: the old canonical request had no
	// normalizationVersion and captured 128 MiB even when memory was omitted.
	op, err := a.Store.Operation(ctx, first.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	var envelope map[string]any
	if err := json.Unmarshal([]byte(op.RequestJSON), &envelope); err != nil {
		t.Fatal(err)
	}
	request := envelope["request"].(map[string]any)
	delete(request, "normalizationVersion")
	digest, err := contracts.PrivateDigest("mutation/create-service", request)
	if err != nil {
		t.Fatal(err)
	}
	historical, _ := json.Marshal(envelope)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE idempotency_records SET request_digest=? WHERE operation_id=?`, digest, first.OperationID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE operations SET request_json=? WHERE id=?`, string(historical), first.OperationID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	replay, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, raw, "legacy-default")
	if err != nil || !replay.Reused || replay.OperationID != first.OperationID || replay.ServiceID != first.ServiceID {
		t.Fatal(replay, err)
	}
	if _, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, serviceRaw("legacy", 300), "legacy-default"); err == nil {
		t.Fatal("legacy fallback bypassed business fingerprint")
	}
	// New explicit legacy values cannot be replayed as a new omitted default.
	if _, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, explicit, "new-explicit"); err == nil {
		t.Fatal("duplicate service should not create another definition")
	}
	fields["name"] = "modern"
	explicit, _ = json.Marshal(fields)
	if _, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, explicit, "new-explicit"); err != nil {
		t.Fatal(err)
	}
	if _, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, serviceRaw("modern", 250), "new-explicit"); err == nil {
		t.Fatal("old fallback aliased a new explicit value")
	}
}

func TestServiceMemoryNotReservedAndProjectionIsExplicit(t *testing.T) {
	a, actor, work := serviceAcceptFixture(t)
	raw := strings.TrimSuffix(string(serviceRaw("large", 250)), "}") + `,"memoryBytes":9007199254740991}`
	accepted, err := a.acceptServiceDefinition(context.Background(), actor, work, "", 0, json.RawMessage(raw), "large")
	if err != nil {
		t.Fatal(err)
	}
	q, err := a.Store.QuotaReservation(context.Background(), work, "service", accepted.ServiceID)
	if err != nil || q.DesiredMemoryBytes != 0 {
		t.Fatal(q, err)
	}
	view, err := a.readService(context.Background(), actor, work, accepted.ServiceID)
	if err != nil || view.MemoryLimitMode != "unlimited" || view.Definition.MemoryBytes != contracts.MaxSafeInteger {
		t.Fatal(view, err)
	}
	rpc, err := rpcServiceView(view)
	if err != nil || rpc.MemoryLimitMode != "unlimited" {
		t.Fatal(rpc, err)
	}
}

func TestWorkCapacityIgnoresHistoricalServiceMemory(t *testing.T) {
	a, actor, work := serviceAcceptFixture(t)
	ctx := context.Background()
	created, err := a.acceptServiceDefinition(ctx, actor, work, "", 0, serviceRaw("old-budget", 250), "old-budget")
	if err != nil {
		t.Fatal(err)
	}
	defaults, err := a.Store.DefaultWork(ctx)
	if err != nil {
		t.Fatal(err)
	}
	config := *defaults.Configuration
	config.Resources.MemoryBytes = config.Resources.AgentMemoryBytes
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE quota_reservations SET desired_memory_bytes=?,occupied_memory_bytes=? WHERE work_id=? AND subject_id=?`, int64(2<<30), int64(3<<30), work, created.ServiceID); err != nil {
			return err
		}
		return validateWorkCapacityTx(tx, work, config)
	}); err != nil {
		t.Fatal("historical Service memory rejected compatible Work", err)
	}
	config.Resources.AgentMemoryBytes++
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return validateWorkCapacityTx(tx, work, config) }); err == nil {
		t.Fatal("Agent memory policy was removed")
	}
}
