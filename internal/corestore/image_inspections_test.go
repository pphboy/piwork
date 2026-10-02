package corestore

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"
)

func TestImageInspectionIntentPersistsAndRecoversWithoutReplay(t *testing.T) {
	ctx := context.Background()
	directory := t.TempDir()
	store := openTestStore(t, directory)
	id := strings.Repeat("a", 32)
	image := "sha256:" + strings.Repeat("b", 64)
	if err := store.BeginImageInspection(ctx, id, image); err != nil {
		t.Fatal(err)
	}
	if err := store.BeginImageInspection(ctx, id, image); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal(err)
	}
	installation := store.InstallationID()
	store.Close()
	store = openTestStore(t, directory)
	defer store.Close()
	jobs, err := store.ActiveImageInspections(ctx)
	if err != nil || len(jobs) != 1 || jobs[0].InstallationID != installation || jobs[0].ImageID != image {
		t.Fatal(jobs, err)
	}
	if err := store.RecoverImageInspections(ctx); err != nil {
		t.Fatal(err)
	}
	jobs, err = store.ActiveImageInspections(ctx)
	if err != nil || len(jobs) != 0 {
		t.Fatal(jobs, err)
	}
	if err := store.CompleteImageInspection(ctx, id); err != nil {
		t.Fatal(err)
	}
}
func TestImageInspectionForeignOrMalformedIntentIsRetained(t *testing.T) {
	ctx := context.Background()
	store := openTestStore(t, t.TempDir())
	defer store.Close()
	id := strings.Repeat("a", 32)
	if err := store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)", inspectionNamespace+id, `{"id":"`+id+`","installationId":"foreign","imageId":"sha256:`+strings.Repeat("b", 64)+`","kind":"anonymous-image-archive"}`, "fixture")
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.RecoverImageInspections(ctx); !errors.Is(err, ErrStorage) {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx *sql.Tx) error {
		var n int
		if err := tx.QueryRow("SELECT count(*) FROM control_metadata WHERE key=?", inspectionNamespace+id).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			t.Fatal("foreign intent deleted")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
