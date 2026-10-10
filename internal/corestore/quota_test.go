package corestore

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
)

func writeQuota(t *testing.T, s *Store, effect func(*sql.Tx) error, want error) {
	t.Helper()
	err := s.Write(context.Background(), effect)
	if !errors.Is(err, want) {
		t.Fatalf("want %v; got %v", want, err)
	}
}
func insertQuotaService(tx *sql.Tx, id string) error {
	_, err := tx.Exec(`INSERT INTO service_heads(work_id,service_id,name,desired_revision,enabled,observed_state) VALUES(?,?,?,1,1,'stopped')`, mutationWorkID, id, id)
	return err
}
func TestConcurrentQuotaAcceptanceRollsBackLosingService(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	seedMutationWork(t, s)
	limit := QuotaLimits{CPUMillis: 1000, MemoryBytes: 1000, MaxServices: pointer(int64(2))}
	writeQuota(t, s, func(tx *sql.Tx) error {
		return ReserveQuota(tx, QuotaReservation{WorkID: mutationWorkID, SubjectKind: "agent", SubjectID: "agent", DesiredCPUMillis: 300, DesiredMemoryBytes: 300}, limit, limit)
	}, nil)
	var group sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		group.Add(1)
		go func(i int) {
			defer group.Done()
			id := fmt.Sprintf("service-%d", i)
			results <- s.Write(context.Background(), func(tx *sql.Tx) error {
				if err := insertQuotaService(tx, id); err != nil {
					return err
				}
				return ReserveQuota(tx, QuotaReservation{WorkID: mutationWorkID, SubjectKind: "service", SubjectID: id, DesiredCPUMillis: 500, DesiredMemoryBytes: 500, ServiceSlots: 1}, limit, limit)
			})
		}(i)
	}
	group.Wait()
	close(results)
	accepted, rejected := 0, 0
	for err := range results {
		if err == nil {
			accepted++
		} else if errors.Is(err, ErrQuotaExceeded) {
			rejected++
		} else {
			t.Fatal(err)
		}
	}
	if accepted != 1 || rejected != 1 {
		t.Fatal(accepted, rejected)
	}
	if err := s.Read(context.Background(), func(tx *sql.Tx) error {
		var count int
		if err := tx.QueryRow(`SELECT count(*) FROM service_heads`).Scan(&count); err != nil {
			return err
		}
		if count != 1 {
			t.Fatalf("losing head persisted: %d", count)
		}
		use, err := quotaUsage(tx, nil)
		if err != nil {
			return err
		}
		if use != (QuotaUsage{800, 300}) {
			t.Fatal(use)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestQuotaOccupationRequiresConfirmedReleaseAndSurvivesRestart(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	limit := QuotaLimits{CPUMillis: 1000, MemoryBytes: 1000}
	q := QuotaReservation{WorkID: mutationWorkID, SubjectKind: "service", SubjectID: "counter", DesiredCPUMillis: 700, DesiredMemoryBytes: 700, OccupiedCPUMillis: 700, OccupiedMemoryBytes: 700, ServiceSlots: 1}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, q, limit, limit) }, nil)
	q.DesiredCPUMillis = 100
	q.DesiredMemoryBytes = 100
	q.OccupiedCPUMillis = 0
	q.OccupiedMemoryBytes = 0
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, q, limit, limit) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return ConfirmQuotaOccupation(tx, mutationWorkID, "service", "counter", 0, 0, false)
	}, ErrReleaseUnconfirmed)
	other := QuotaReservation{WorkID: mutationWorkID, SubjectKind: "service", SubjectID: "other", DesiredCPUMillis: 400, DesiredMemoryBytes: 400}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, other, limit, limit) }, ErrQuotaExceeded)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	actual, err := s.QuotaReservation(context.Background(), mutationWorkID, "service", "counter")
	if err != nil || actual.OccupiedCPUMillis != 700 || actual.DesiredCPUMillis != 100 {
		t.Fatal(actual, err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseQuota(tx, mutationWorkID, "service", "counter", true) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return ConfirmQuotaOccupation(tx, mutationWorkID, "service", "counter", 0, 0, true)
	}, nil)
	// Stopping releases observed use, but keeps the enabled service's definition budget.
	actual, err = s.QuotaReservation(context.Background(), mutationWorkID, "service", "counter")
	if err != nil || actual.DesiredCPUMillis != 100 {
		t.Fatal(actual, err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, other, limit, limit) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseQuota(tx, mutationWorkID, "service", "counter", false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error { return ReleaseQuota(tx, mutationWorkID, "service", "counter", true) }, nil)
	actual, err = s.QuotaReservation(context.Background(), mutationWorkID, "service", "counter")
	if err != nil || actual.DesiredCPUMillis != 0 || actual.ServiceSlots != 1 {
		t.Fatal(actual, err)
	}
	writeQuota(t, s, func(tx *sql.Tx) error {
		return ConfirmQuotaOccupation(tx, mutationWorkID, "service", "other", 600, 600, true)
	}, ErrQuotaExceeded)
}
func TestWorkAndHostQuotaAreBothEnforced(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	seedMutationWork(t, s)
	writeQuota(t, s, func(tx *sql.Tx) error {
		return InsertWork(tx, WorkRecord{ID: "second-work", OwnerUserID: "user-mutation-00000001", Name: "second", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1})
	}, nil)
	work, host := QuotaLimits{CPUMillis: 600, MemoryBytes: 600}, QuotaLimits{CPUMillis: 900, MemoryBytes: 900}
	first := QuotaReservation{WorkID: mutationWorkID, SubjectKind: "agent", SubjectID: "agent", DesiredCPUMillis: 500, DesiredMemoryBytes: 500}
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, first, work, host) }, nil)
	second := first
	second.WorkID = "second-work"
	writeQuota(t, s, func(tx *sql.Tx) error { return ReserveQuota(tx, second, work, host) }, ErrQuotaExceeded)
	first.SubjectID = "other"
	first.DesiredCPUMillis = 200
	first.DesiredMemoryBytes = 200
	writeQuota(t, s, func(tx *sql.Tx) error {
		return ReserveQuota(tx, first, work, QuotaLimits{CPUMillis: 10000, MemoryBytes: 10000})
	}, ErrQuotaExceeded)
	writeQuota(t, s, func(tx *sql.Tx) error { return CheckWorkQuota(tx, pointer(int64(2)), 1) }, ErrQuotaExceeded)
	writeQuota(t, s, func(tx *sql.Tx) error { return CheckWorkQuota(tx, pointer(int64(3)), 1) }, nil)
}
func TestServiceSlotsCountDisabledButExcludeTombstones(t *testing.T) {
	s := openTestStore(t, t.TempDir())
	defer s.Close()
	seedMutationWork(t, s)
	limit := QuotaLimits{CPUMillis: 1000, MemoryBytes: 1000, MaxServices: pointer(int64(1))}
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := insertQuotaService(tx, "disabled"); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET enabled=0`)
		return err
	}, nil)
	next := QuotaReservation{WorkID: mutationWorkID, SubjectKind: "service", SubjectID: "new", ServiceSlots: 1}
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := insertQuotaService(tx, "new"); err != nil {
			return err
		}
		return ReserveQuota(tx, next, limit, limit)
	}, ErrQuotaExceeded)
	writeQuota(t, s, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET tombstoned_at='2026-09-30T00:00:00Z'`)
		return err
	}, nil)
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := insertQuotaService(tx, "new"); err != nil {
			return err
		}
		return ReserveQuota(tx, next, limit, limit)
	}, nil)
}
func TestSharedVolumeReferencesRetentionAndPurgeAccounting(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	seedMutationWork(t, s)
	max := pointer(int64(1))
	v := VolumeRecord{ID: "workspace", InstallationID: s.InstallationID(), WorkID: mutationWorkID, Role: "workspace", RuntimeName: "test-workspace"}
	writeQuota(t, s, func(tx *sql.Tx) error {
		for _, id := range []string{"notes", "counter"} {
			if err := insertQuotaService(tx, id); err != nil {
				return err
			}
		}
		if err := RegisterVolume(tx, v, max, max); err != nil {
			return err
		}
		for _, consumer := range []struct{ kind, id string }{{"work", mutationWorkID}, {"service", "notes"}, {"service", "counter"}, {"service", "counter"}} {
			if err := AttachVolumeReference(tx, v.ID, consumer.kind, consumer.id); err != nil {
				return err
			}
		}
		return CheckVolumeQuota(tx, mutationWorkID, max, max, 0)
	}, nil)
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	writeQuota(t, s, func(tx *sql.Tx) error {
		actual, err := ReadVolume(tx, v.ID)
		if err != nil {
			return err
		}
		if actual.ReferenceCount != 3 || actual.State != "active" {
			t.Fatal(actual)
		}
		return RegisterVolume(tx, v, max, max)
	}, nil)
	collision := v
	collision.RuntimeName = "different"
	writeQuota(t, s, func(tx *sql.Tx) error { return RegisterVolume(tx, collision, max, max) }, ErrVolumeState)
	writeQuota(t, s, func(tx *sql.Tx) error { return AttachVolumeReference(tx, v.ID, "work", "foreign") }, ErrVolumeState)
	writeQuota(t, s, func(tx *sql.Tx) error { return AttachVolumeReference(tx, v.ID, "service", "foreign") }, ErrNotFound)
	writeQuota(t, s, func(tx *sql.Tx) error { return DetachVolumeReference(tx, v.ID, "service", "notes") }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return RequestVolumePurge(tx, v.ID) }, ErrVolumeReferenced)
	writeQuota(t, s, func(tx *sql.Tx) error { return RetainWorkVolumes(tx, mutationWorkID) }, nil)
	second := v
	second.ID = "second-volume"
	second.RuntimeName = "second-runtime"
	writeQuota(t, s, func(tx *sql.Tx) error { return RegisterVolume(tx, second, max, max) }, ErrQuotaExceeded)
	writeQuota(t, s, func(tx *sql.Tx) error { return RequestVolumePurge(tx, v.ID) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return CompleteVolumePurge(tx, v.ID, false) }, ErrReleaseUnconfirmed)
	writeQuota(t, s, func(tx *sql.Tx) error { return RegisterVolume(tx, second, max, max) }, ErrQuotaExceeded)
	writeQuota(t, s, func(tx *sql.Tx) error { return AttachVolumeReference(tx, v.ID, "work", mutationWorkID) }, ErrVolumeState)
	writeQuota(t, s, func(tx *sql.Tx) error { return CompleteVolumePurge(tx, v.ID, true) }, nil)
	writeQuota(t, s, func(tx *sql.Tx) error { return RegisterVolume(tx, second, max, max) }, nil)
	private := VolumeRecord{ID: "private", InstallationID: s.InstallationID(), WorkID: mutationWorkID, Role: "agent-private", RuntimeName: "private"}
	writeQuota(t, s, func(tx *sql.Tx) error {
		if err := RegisterVolume(tx, private, nil, nil); err != nil {
			return err
		}
		return AttachVolumeReference(tx, private.ID, "service", "counter")
	}, ErrVolumeState)
}
