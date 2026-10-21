package coreapp

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"piwork/internal/safefs"
)

func snapshotLogShards(t *testing.T, directory string) map[string]int64 {
	t.Helper()
	names, err := filepath.Glob(filepath.Join(directory, "logs", "core", "core-*.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	result := map[string]int64{}
	for _, name := range names {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		result[filepath.Base(name)] = info.Size()
	}
	return result
}

func TestSecondCoreDoesNotModifyLogShards(t *testing.T) {
	directory := t.TempDir()
	first, err := New(context.Background(), Options{DataDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	first.RecordAppEvent("test.first", "info", nil)
	before := snapshotLogShards(t, directory)
	if len(before) == 0 {
		t.Fatal("first Core did not create log shards")
	}
	second, err := New(context.Background(), Options{DataDirectory: directory})
	if second != nil {
		t.Fatal("second Core unexpectedly acquired the installation")
	}
	if !errors.Is(err, safefs.ErrLocked) {
		t.Fatalf("unexpected second-instance error: %v", err)
	}
	after := snapshotLogShards(t, directory)
	if len(before) != len(after) {
		t.Fatalf("second Core changed shard count: %v -> %v", before, after)
	}
	for name, size := range before {
		if after[name] != size {
			t.Fatalf("second Core modified %s", name)
		}
	}
	if err := first.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
}
