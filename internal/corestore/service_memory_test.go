package corestore

import (
	"context"
	"database/sql"
	"testing"
)

func TestHistoricalServiceMemoryIsPreservedButDoesNotConsumeQuota(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	seedMutationWork(t, s)
	limit := QuotaLimits{CPUMillis: 1000, MemoryBytes: 1000}
	old := QuotaReservation{WorkID: mutationWorkID, SubjectKind: "service", SubjectID: "legacy", DesiredCPUMillis: 100, DesiredMemoryBytes: 1 << 30, OccupiedMemoryBytes: 2 << 30}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, old, limit, limit) }, nil)
	agent := QuotaReservation{WorkID: mutationWorkID, SubjectKind: "agent", SubjectID: "agentd", DesiredCPUMillis: 100, DesiredMemoryBytes: 800}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, agent, limit, limit) }, nil)
	if err := s.Read(context.Background(), func(tx *sql.Tx) error {
		usage, err := ReadQuotaUsage(tx, nil)
		if err != nil {
			return err
		}
		if usage != (QuotaUsage{CPUMillis: 200, MemoryBytes: 800}) {
			t.Fatal(usage)
		}
		row, err := ReadQuotaReservation(tx, mutationWorkID, "service", "legacy")
		if err != nil {
			return err
		}
		if row.DesiredMemoryBytes != old.DesiredMemoryBytes || row.OccupiedMemoryBytes != old.OccupiedMemoryBytes {
			t.Fatal("historical bytes were rewritten", row)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	agent.SubjectID = "other"
	agent.DesiredMemoryBytes = 300
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, agent, limit, limit) }, ErrQuotaExceeded)
	old.SubjectID = "cpu-full"
	old.DesiredCPUMillis = 900
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, old, limit, limit) }, ErrQuotaExceeded)
}
