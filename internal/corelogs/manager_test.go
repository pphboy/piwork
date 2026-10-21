package corelogs

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/safefs"
)

func openManagerAt(t *testing.T, directory string, options Options) (*Manager, *safefs.Root) {
	t.Helper()
	root, err := safefs.OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	if err := root.Lock(); err != nil {
		t.Fatal(err)
	}
	manager, err := Open(root, options)
	if err != nil {
		root.Close()
		t.Fatal(err)
	}
	return manager, root
}

func openTestManager(t *testing.T, directory string, options Options) (*Manager, *safefs.Root) {
	t.Helper()
	manager, root := openManagerAt(t, directory, options)
	t.Cleanup(func() {
		_ = manager.Close()
		_ = root.Close()
	})
	return manager, root
}

func readTestRecords(t *testing.T, directory string) []Record {
	t.Helper()
	names, err := filepath.Glob(filepath.Join(directory, "core-*.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(names)
	var records []Record
	for _, name := range names {
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		for _, line := range bytes.Split(raw, []byte{'\n'}) {
			if len(line) == 0 {
				continue
			}
			var record Record
			if err := json.Unmarshal(line, &record); err != nil {
				t.Fatalf("invalid JSONL line in %s: %v", name, err)
			}
			records = append(records, record)
		}
	}
	return records
}

func TestConcurrentRecordsStayCompleteAndOrdered(t *testing.T) {
	directory := t.TempDir()
	var console bytes.Buffer
	manager, _ := openTestManager(t, directory, Options{Stdout: io.Discard, Stderr: &console, SyncInterval: -1})
	const writers, perWriter = 16, 64
	var wait sync.WaitGroup
	for writer := 0; writer < writers; writer++ {
		wait.Add(1)
		go func(writer int) {
			defer wait.Done()
			for index := 0; index < perWriter; index++ {
				if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: "concurrent line"}); err != nil {
					t.Error(err)
					return
				}
			}
		}(writer)
	}
	wait.Wait()
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	records := readTestRecords(t, directory)
	if len(records) != writers*perWriter {
		t.Fatalf("expected %d records, got %d", writers*perWriter, len(records))
	}
	seen := make(map[int64]bool, len(records))
	for _, record := range records {
		if seen[record.Seq] {
			t.Fatalf("duplicate sequence %d", record.Seq)
		}
		seen[record.Seq] = true
		if record.BootID != manager.BootID() || record.Message != "concurrent line" {
			t.Fatalf("unexpected record: %#v", record)
		}
	}
	if console.Len() == 0 {
		t.Fatal("console output was not preserved")
	}
}

func TestRotationRetentionAndRestartKeepOldShards(t *testing.T) {
	directory := t.TempDir()
	manager, root := openManagerAt(t, directory, Options{
		Stdout: io.Discard, Stderr: io.Discard, MaxSegmentBytes: 4 << 10, MaxTotalBytes: 64 << 10,
		MaxAge: time.Hour, SyncInterval: -1,
	})
	for index := 0; index < 200; index++ {
		if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: strings.Repeat("x", 200)}); err != nil {
			t.Fatal(err)
		}
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	names, err := filepath.Glob(filepath.Join(directory, "core-*.jsonl"))
	if err != nil || len(names) < 2 {
		t.Fatalf("expected rotated shards: %v %v", names, err)
	}
	for _, name := range names {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		if info.Size() > 4<<10 {
			t.Fatalf("segment %s exceeded its byte bound: %d", name, info.Size())
		}
	}
	before := map[string][]byte{}
	for _, name := range names {
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		before[filepath.Base(name)] = raw
	}
	firstBoot := manager.BootID()
	manager, root = openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1})
	defer func() { _ = manager.Close(); _ = root.Close() }()
	if manager.BootID() == firstBoot {
		t.Fatal("restart reused the previous boot identity")
	}
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.restart", Message: "after restart"}); err != nil {
		t.Fatal(err)
	}
	for name, want := range before {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil || !bytes.Equal(raw, want) {
			t.Fatalf("previous shard %s was modified", name)
		}
	}
}

func TestRetentionRemovesExpiredClosedShards(t *testing.T) {
	directory := t.TempDir()
	manager, root := openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, MaxAge: time.Hour, SyncInterval: -1})
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: "old"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	names, _ := filepath.Glob(filepath.Join(directory, "core-*.jsonl"))
	old := time.Now().Add(-2 * time.Hour)
	for _, name := range names {
		if err := os.Chtimes(name, old, old); err != nil {
			t.Fatal(err)
		}
	}
	manager, root = openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, MaxAge: time.Hour, SyncInterval: -1})
	defer func() { _ = manager.Close(); _ = root.Close() }()
	segments, err := manager.Segments()
	if err != nil {
		t.Fatal(err)
	}
	if len(segments) != 1 || !segments[0].Active {
		t.Fatalf("expired shards were retained: %#v", segments)
	}
}

func TestFileFailureKeepsConsoleAndRecordsKnownGap(t *testing.T) {
	directory := t.TempDir()
	var stdout, stderr bytes.Buffer
	var faulty atomic.Bool
	manager, _ := openTestManager(t, directory, Options{
		Stdout: &stdout, Stderr: &stderr, SyncInterval: -1,
		Fault: func(stage string) error {
			if stage == "write" && faulty.Load() {
				return errors.New("injected write failure")
			}
			return nil
		},
	})
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.before", Message: "before"}); err != nil {
		t.Fatal(err)
	}
	faulty.Store(true)
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.failed", Message: "during fault"}); err == nil {
		t.Fatal("write failure was not reported")
	}
	if !strings.Contains(stderr.String(), "during fault") {
		t.Fatal("console output stopped during a file failure")
	}
	if !manager.Status().FileFault {
		t.Fatal("file fault not observable")
	}
	faulty.Store(false)
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.after", Message: "after"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	records := readTestRecords(t, directory)
	events := make([]string, 0, len(records))
	gapFound := false
	for _, record := range records {
		events = append(events, record.Event)
		if record.Event == "log.gap" {
			gapFound = record.Fields["known"] == "true" && record.Fields["from"] != "" && record.Fields["to"] != ""
		}
	}
	if !gapFound {
		t.Fatalf("known gap not recorded: %v", events)
	}
	for _, record := range records {
		if record.Event == "test.failed" {
			t.Fatal("failed record was written to the file")
		}
	}
	if events[len(events)-1] != "test.after" {
		t.Fatalf("unexpected final record: %v", events)
	}
}

type failingWriter struct{}

func (failingWriter) Write(data []byte) (int, error) { return 0, errors.New("console unavailable") }

func TestConsoleFailureDoesNotStopFileOutput(t *testing.T) {
	directory := t.TempDir()
	manager, _ := openTestManager(t, directory, Options{Stdout: failingWriter{}, Stderr: failingWriter{}, SyncInterval: -1})
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: "file only"}); err == nil {
		t.Fatal("console failure was not reported")
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	records := readTestRecords(t, directory)
	if len(records) != 1 || records[0].Message != "file only" {
		t.Fatalf("file output missing after console failure: %#v", records)
	}
}

func TestPartialTailIsPreservedAndReported(t *testing.T) {
	directory := t.TempDir()
	manager, root := openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1})
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: "complete"}); err != nil {
		t.Fatal(err)
	}
	segments, err := manager.Segments()
	if err != nil || len(segments) != 1 {
		t.Fatalf("segments: %#v %v", segments, err)
	}
	active := segments[0].Name
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	file, err := os.OpenFile(filepath.Join(directory, active), os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.WriteString(`{"time":"2026-10-21T00:00:00Z","bootId":"partial"`); err != nil {
		t.Fatal(err)
	}
	file.Close()
	before, err := os.ReadFile(filepath.Join(directory, active))
	if err != nil {
		t.Fatal(err)
	}
	manager, root = openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1})
	defer func() { _ = manager.Close(); _ = root.Close() }()
	segments, err = manager.Segments()
	if err != nil {
		t.Fatal(err)
	}
	partial := false
	for _, segment := range segments {
		if segment.Name == active {
			partial = segment.Partial
		}
	}
	if !partial {
		t.Fatalf("partial tail not marked: %#v", segments)
	}
	after, err := os.ReadFile(filepath.Join(directory, active))
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("recovery modified the incomplete shard")
	}
}

func TestSyncRunsAtRotationAndCloseBoundaries(t *testing.T) {
	var syncs atomic.Int64
	manager, _ := openTestManager(t, t.TempDir(), Options{
		Stdout: io.Discard, Stderr: io.Discard, MaxSegmentBytes: 2 << 10, SyncInterval: -1,
		Fault: func(stage string) error {
			if stage == "sync" {
				syncs.Add(1)
			}
			return nil
		},
	})
	for index := 0; index < 40; index++ {
		if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: strings.Repeat("x", 200)}); err != nil {
			t.Fatal(err)
		}
	}
	rotated := syncs.Load()
	if rotated == 0 {
		t.Fatal("rotation did not sync the previous shard")
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if syncs.Load() <= rotated {
		t.Fatal("close did not sync the active shard")
	}
}

func TestSyncTickerAndCloseFlush(t *testing.T) {
	var syncs atomic.Int64
	manager, _ := openTestManager(t, t.TempDir(), Options{
		Stdout: io.Discard, Stderr: io.Discard, SyncInterval: 5 * time.Millisecond,
		Fault: func(stage string) error {
			if stage == "sync" {
				syncs.Add(1)
			}
			return nil
		},
	})
	deadline := time.Now().Add(2 * time.Second)
	for syncs.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if syncs.Load() == 0 {
		t.Fatal("periodic sync did not run")
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
}

func TestStreamWriterPreservesConsoleAndFlushesTail(t *testing.T) {
	directory := t.TempDir()
	var stderr bytes.Buffer
	manager, _ := openTestManager(t, directory, Options{Stdout: io.Discard, Stderr: &stderr, SyncInterval: -1})
	writer := manager.Writer("stderr", "app")
	if _, err := writer.Write([]byte("hello")); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write([]byte(" world\nnext")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if stderr.String() != "hello world\nnext\n" {
		t.Fatalf("console bytes changed: %q", stderr.String())
	}
	records := readTestRecords(t, directory)
	if len(records) != 2 || records[0].Message != "hello world" || records[1].Message != "next" || records[1].Component != "app" {
		t.Fatalf("unexpected records: %#v", records)
	}
}

func TestUnsafeFieldsAreDroppedAndMessagesAreBounded(t *testing.T) {
	directory := t.TempDir()
	manager, _ := openTestManager(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1})
	message := strings.Repeat("中", maxMessageBytes)
	if err := manager.Emit(Event{
		Stream: "dangerous", Level: "verbose", Component: "bad component", Event: "bad event",
		Message: message, WorkID: "../../escape",
		Fields: map[string]string{"good": "value", "bad key": "value", "password": strings.Repeat("x", maxFieldValueBytes+100)},
	}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	records := readTestRecords(t, directory)
	if len(records) != 1 {
		t.Fatalf("unexpected records: %#v", records)
	}
	record := records[0]
	if record.Stream != "stderr" || record.Level != "info" || record.WorkID != "" || !record.Truncated {
		t.Fatalf("unsafe fields were not normalized: %#v", record)
	}
	if len(record.Message) > maxMessageBytes {
		t.Fatalf("message not bounded: %d", len(record.Message))
	}
	if record.Fields["good"] != "value" || len(record.Fields["password"]) > maxFieldValueBytes {
		t.Fatalf("field bounds not applied: %#v", record.Fields)
	}
	if _, found := record.Fields["bad key"]; found {
		t.Fatal("invalid field key stored")
	}
}

func TestBoundaryFreezesBytesAndPinsRetention(t *testing.T) {
	directory := t.TempDir()
	manager, _ := openManagerAt(t, directory, Options{
		Stdout: io.Discard, Stderr: io.Discard, MaxSegmentBytes: 2 << 10, MaxTotalBytes: 4 << 10,
		MaxAge: time.Hour, SyncInterval: -1,
	})
	defer func() { _ = manager.Close() }()
	for index := 0; index < 12; index++ {
		if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: strings.Repeat("x", 180)}); err != nil {
			t.Fatal(err)
		}
	}
	boundary, err := manager.Boundary()
	if err != nil {
		t.Fatal(err)
	}
	entries := boundary.Entries()
	if len(entries) < 2 {
		t.Fatalf("expected multiple frozen shards: %#v", entries)
	}
	before := make(map[string][]byte, len(entries))
	for _, entry := range entries {
		reader, size, err := boundary.OpenSection(entry.Name)
		if err != nil {
			t.Fatal(err)
		}
		raw, err := io.ReadAll(reader)
		reader.Close()
		if err != nil || int64(len(raw)) != size || size != entry.Size {
			t.Fatalf("boundary read mismatch for %s: %d/%d %v", entry.Name, len(raw), size, err)
		}
		before[entry.Name] = raw
	}
	// Further writes rotate and would normally trigger retention. Pinned shards
	// must survive and keep the same bytes.
	for index := 0; index < 80; index++ {
		if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: strings.Repeat("y", 180)}); err != nil {
			t.Fatal(err)
		}
	}
	for name, raw := range before {
		reader, size, err := boundary.OpenSection(name)
		if err != nil {
			t.Fatalf("pinned shard %s disappeared: %v", name, err)
		}
		after, err := io.ReadAll(reader)
		reader.Close()
		if err != nil || int64(len(after)) != size || !bytes.Equal(after, raw) {
			t.Fatalf("pinned shard %s changed", name)
		}
	}
	boundary.Release()
	boundary.Release()
	for index := 0; index < 12; index++ {
		if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: strings.Repeat("z", 180)}); err != nil {
			t.Fatal(err)
		}
	}
	segments, err := manager.Segments()
	if err != nil {
		t.Fatal(err)
	}
	present := map[string]bool{}
	for _, segment := range segments {
		present[segment.Name] = true
	}
	removed := false
	for name := range before {
		if !present[name] {
			removed = true
		}
	}
	if !removed {
		t.Fatalf("released boundary did not allow retention to reclaim old shards: %#v", segments)
	}
}

func TestDefaultSixteenMiBShardsRotateWithoutOverwrite(t *testing.T) {
	directory := t.TempDir()
	manager, root := openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1})
	message := strings.Repeat("r", 60<<10)
	for index := 0; index < 1400; index++ {
		if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "rotation", Event: "rotation.record", Message: message}); err != nil {
			t.Fatal(err)
		}
	}
	if err := manager.Close(); err != nil {
		t.Fatal(err)
	}
	if err := root.Close(); err != nil {
		t.Fatal(err)
	}
	names, err := filepath.Glob(filepath.Join(directory, "core-*.jsonl"))
	if err != nil || len(names) < 2 {
		t.Fatalf("default 16 MiB rotation produced %v", names)
	}
	sort.Strings(names)
	before := map[string][]byte{}
	for _, name := range names {
		info, err := os.Stat(name)
		if err != nil {
			t.Fatal(err)
		}
		if info.Size() > DefaultMaxSegmentBytes {
			t.Fatalf("segment %s exceeds the 16 MiB default: %d", name, info.Size())
		}
		raw, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		before[filepath.Base(name)] = raw
	}
	first, err := os.Stat(names[0])
	if err != nil || first.Size() < (15<<20) {
		t.Fatalf("first shard did not rotate near the default bound: %v %v", first, err)
	}
	manager, _ = openManagerAt(t, directory, Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1})
	defer func() { _ = manager.Close() }()
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "rotation", Event: "rotation.restart", Message: "after restart"}); err != nil {
		t.Fatal(err)
	}
	for name, want := range before {
		raw, err := os.ReadFile(filepath.Join(directory, name))
		if err != nil || !bytes.Equal(raw, want) {
			t.Fatalf("rotation or restart overwrote %s", name)
		}
	}
}

func TestBoundarySyncsActiveShardBeforeFreezing(t *testing.T) {
	var syncs atomic.Int64
	manager, _ := openTestManager(t, t.TempDir(), Options{Stdout: io.Discard, Stderr: io.Discard, SyncInterval: -1,
		Fault: func(stage string) error {
			if stage == "sync" {
				syncs.Add(1)
			}
			return nil
		}})
	if err := manager.Emit(Event{Stream: "stderr", Level: "info", Component: "test", Event: "test.record", Message: "boundary"}); err != nil {
		t.Fatal(err)
	}
	before := syncs.Load()
	boundary, err := manager.Boundary()
	if err != nil {
		t.Fatal(err)
	}
	boundary.Release()
	if syncs.Load() <= before {
		t.Fatal("export boundary did not sync the active shard")
	}
}
