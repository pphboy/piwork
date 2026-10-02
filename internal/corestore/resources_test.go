package corestore

import (
	"context"
	"database/sql"
	"errors"
	"testing"
)

func TestResourceCreationIntentSurvivesRestartAndRequiresConfirmedRelease(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	ctx := context.Background()
	intent := ResourceIntent{WorkID: "work-first", Kind: "volume", LogicalID: "work-workspace", Name: "owned-first", Labels: map[string]string{"piwork.installation_id": s.InstallationID(), "piwork.managed": "true", "piwork.work_id": "work-first", "piwork.logical_id": "work-workspace"}}
	if err := s.RecordResourceIntent(ctx, intent); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordResourceIntent(ctx, intent); !errors.Is(err, ErrIntentUnconfirmed) {
		t.Fatal(err)
	}
	other := intent
	other.WorkID = "work-second"
	other.Name = "owned-second"
	other.Labels = map[string]string{"piwork.installation_id": s.InstallationID(), "piwork.managed": "true", "piwork.work_id": "work-second", "piwork.logical_id": "work-workspace"}
	if err := s.RecordResourceIntent(ctx, other); err != nil {
		t.Fatal("same volume role in another Work conflicts", err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	if err := s.RecordResourceIntent(ctx, intent); !errors.Is(err, ErrIntentUnconfirmed) {
		t.Fatal(err)
	}
	if err := s.ReleaseResourceIntent(ctx, intent.WorkID, intent.Kind, intent.LogicalID, false); !errors.Is(err, ErrReleaseUnconfirmed) {
		t.Fatal(err)
	}
	if err := s.ReleaseResourceIntent(ctx, intent.WorkID, intent.Kind, intent.LogicalID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordResourceIntent(ctx, intent); err != nil {
		t.Fatal(err)
	}
	if err := s.Read(ctx, func(tx *sql.Tx) error {
		first, err := ReadResourceBinding(tx, s.InstallationID(), intent.WorkID, intent.Kind, intent.LogicalID)
		if err != nil {
			return err
		}
		second, err := ReadResourceBinding(tx, s.InstallationID(), other.WorkID, other.Kind, other.LogicalID)
		if first.RuntimeID == second.RuntimeID {
			t.Fatal(first, second)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestPackageUnansweredCreationSurvivesRuntimeRestart(t *testing.T) {
	directory := t.TempDir()
	s := openTestStore(t, directory)
	ctx := context.Background()
	intent := ResourceIntent{WorkID: "core", Kind: "package-helper", LogicalID: "probe-fixture-1-environment", Name: "owned-probe", Labels: map[string]string{"piwork.installation_id": s.InstallationID(), "piwork.managed": "true", "piwork.work_id": "core"}}
	if err := s.RecordResourceIntent(ctx, intent); err != nil {
		t.Fatal(err)
	}
	if unknown, err := s.PackageCreationUnsettled(ctx, intent.WorkID, intent.Kind, intent.LogicalID, intent.Name); err != nil || !unknown {
		t.Fatal(unknown, err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}
	s = openTestStore(t, directory)
	defer s.Close()
	if unknown, err := s.PackageCreationUnsettled(ctx, intent.WorkID, intent.Kind, intent.LogicalID, intent.Name); err != nil || !unknown {
		t.Fatal("restart forgot unanswered create", unknown, err)
	}
	if err := s.SettlePackageCreation(ctx, intent.WorkID, intent.Kind, intent.LogicalID, "wrong-name"); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("foreign resource settled an attempt", err)
	}
	if err := s.SettlePackageCreation(ctx, intent.WorkID, intent.Kind, intent.LogicalID, intent.Name); err != nil {
		t.Fatal(err)
	}
	if unknown, err := s.PackageCreationUnsettled(ctx, intent.WorkID, intent.Kind, intent.LogicalID, intent.Name); err != nil || unknown {
		t.Fatal(unknown, err)
	}
	if err := s.ReleaseResourceIntent(ctx, intent.WorkID, intent.Kind, intent.LogicalID, false); !errors.Is(err, ErrReleaseUnconfirmed) {
		t.Fatal(err)
	}
	if err := s.ReleaseResourceIntent(ctx, intent.WorkID, intent.Kind, intent.LogicalID, true); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordResourceIntent(ctx, intent); err != nil {
		t.Fatal("confirmed release left stale attempt", err)
	}
}
