package clientfs

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func privateDirectory(t *testing.T) (*Directory, string) {
	t.Helper()
	name := filepath.Join(t.TempDir(), "state")
	d, err := OpenPrivateDirectory(name, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := d.Close(); err != nil {
			t.Error(err)
		}
	})
	return d, name
}

func TestReadMissingDoesNotCreateStateAndNamesCannotEscape(t *testing.T) {
	name := filepath.Join(t.TempDir(), "missing", "state")
	if d, err := OpenPrivateDirectory(name, false); !errors.Is(err, os.ErrNotExist) {
		if d != nil {
			d.Close()
		}
		t.Fatalf("missing: %v", err)
	}
	if _, err := os.Stat(filepath.Dir(name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("read created state", err)
	}
	d, _ := privateDirectory(t)
	for _, name := range []string{"", ".", "..", "../outside", "a/b", "a\\b", "a\x00b"} {
		if f, err := d.OpenRegular(name); err == nil {
			f.Close()
			t.Fatalf("opened unsafe name %q", name)
		}
		if f, err := d.CreateExclusive(name); err == nil {
			f.Close()
			t.Fatalf("created unsafe name %q", name)
		}
		if err := d.AtomicWrite(context.Background(), name, []byte("unsafe")); err == nil {
			t.Fatalf("published unsafe name %q", name)
		}
	}
}

func TestPrivateWriteBoundedReadAndIdempotentRemove(t *testing.T) {
	d, _ := privateDirectory(t)
	ctx := context.Background()
	if err := d.AtomicWrite(ctx, "preferences.json", []byte("old")); err != nil {
		t.Fatal(err)
	}
	if err := d.AtomicWrite(ctx, "preferences.json", []byte("new complete record")); err != nil {
		t.Fatal(err)
	}
	if raw, err := d.ReadFile("preferences.json", 100); err != nil || string(raw) != "new complete record" {
		t.Fatal(string(raw), err)
	}
	if _, err := d.ReadFile("preferences.json", 3); err == nil {
		t.Fatal("bounded read accepted oversized content")
	}
	for range 2 {
		if err := d.Remove("preferences.json"); err != nil {
			t.Fatal(err)
		}
	}
}

func TestAtomicWriteFailureAndCancellationPreserveCommittedState(t *testing.T) {
	d, _ := privateDirectory(t)
	ctx := context.Background()
	if err := d.AtomicWrite(ctx, "record", []byte("old")); err != nil {
		t.Fatal(err)
	}
	failure := errors.New("injected failure")
	for _, hooks := range []writeHooks{
		{random: func([]byte) (int, error) { return 0, failure }},
		{random: func([]byte) (int, error) { return 1, nil }},
		{write: func(f *os.File, b []byte) (int, error) { _, _ = f.Write(b[:1]); return 1, failure }},
		{write: func(f *os.File, b []byte) (int, error) { return f.Write(b[:1]) }},
		{syncFile: func(*os.File) error { return failure }},
		{beforeCommit: func() error { return failure }},
	} {
		if err := d.atomicWrite(ctx, "record", []byte("replacement"), hooks); err == nil || errors.Is(err, ErrOutcomeUnknown) {
			t.Fatal("precommit failure misreported", err)
		}
		if raw, err := d.ReadFile("record", 100); err != nil || string(raw) != "old" {
			t.Fatal("old state changed", string(raw), err)
		}
	}
	canceled, cancel := context.WithCancel(ctx)
	if err := d.atomicWrite(canceled, "record", []byte("replacement"), writeHooks{beforeCommit: func() error { cancel(); return nil }}); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if raw, err := d.ReadFile("record", 100); err != nil || string(raw) != "old" {
		t.Fatal("cancellation published state", string(raw), err)
	}
	items, err := d.Entries()
	if err != nil || len(items) != 1 || items[0].Name() != "record" {
		t.Fatal("temporary leaked", items, err)
	}
	if err := d.atomicWrite(ctx, "record", []byte("new"), writeHooks{syncDirectory: func() error { return failure }}); !errors.Is(err, ErrOutcomeUnknown) {
		t.Fatal("postcommit failure lacks unknown outcome", err)
	}
	if raw, err := d.ReadFile("record", 100); err != nil || string(raw) != "new" {
		t.Fatal("committed state not readable", string(raw), err)
	}
}

func TestPublishNoReplaceRefusesConcurrentTargetAndCancel(t *testing.T) {
	d, _ := privateDirectory(t)
	ctx := context.Background()
	f, err := d.CreateExclusive("pending")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("candidate")); err != nil {
		t.Fatal(err)
	}
	if err := errors.Join(f.Sync(), f.Close()); err != nil {
		t.Fatal(err)
	}
	// Another writer commits after the download has already begun.
	if err := d.AtomicWrite(ctx, "download.work", []byte("existing")); err != nil {
		t.Fatal(err)
	}
	if err := d.PublishNoReplace(ctx, "pending", "download.work"); !errors.Is(err, os.ErrExist) {
		t.Fatal("target overwritten", err)
	}
	if raw, err := d.ReadFile("download.work", 100); err != nil || string(raw) != "existing" {
		t.Fatal(string(raw), err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err := d.PublishNoReplace(canceled, "pending", "other.work"); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if _, err := d.OpenRegular("other.work"); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("canceled publish appeared", err)
	}
	if err := d.PublishNoReplace(ctx, "pending", "other.work"); err != nil {
		t.Fatal(err)
	}
	if raw, err := d.ReadFile("other.work", 100); err != nil || string(raw) != "candidate" {
		t.Fatal(string(raw), err)
	}
}

func TestConcurrentReadersObserveOnlyCompletePublishedRecords(t *testing.T) {
	d, _ := privateDirectory(t)
	ctx := context.Background()
	a, b := bytes.Repeat([]byte("A"), 128<<10), bytes.Repeat([]byte("B"), 128<<10)
	if err := d.AtomicWrite(ctx, "record", a); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for range 40 {
			f, err := d.OpenRegular("record")
			if err != nil {
				t.Error(err)
				return
			}
			raw, err := io.ReadAll(f)
			f.Close()
			if err != nil || !bytes.Equal(raw, a) && !bytes.Equal(raw, b) {
				t.Errorf("partial published record: length=%d err=%v", len(raw), err)
				return
			}
		}
	}()
	for i := range 40 {
		value := a
		if i%2 == 1 {
			value = b
		}
		if err := d.AtomicWrite(ctx, "record", value); err != nil {
			t.Fatal(err)
		}
	}
	wg.Wait()
}

func TestConcurrentPublishersCannotOverwriteWinner(t *testing.T) {
	d, path := privateDirectory(t)
	other, err := OpenPrivateDirectory(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	for _, name := range []string{"first", "second"} {
		f, err := d.CreateExclusive(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write([]byte(name)); err != nil {
			t.Fatal(err)
		}
		if err := errors.Join(f.Sync(), f.Close()); err != nil {
			t.Fatal(err)
		}
	}
	type result struct {
		name string
		err  error
	}
	start, results := make(chan struct{}), make(chan result, 2)
	go func() {
		<-start
		results <- result{"first", d.PublishNoReplace(context.Background(), "first", "winner")}
	}()
	go func() {
		<-start
		results <- result{"second", other.PublishNoReplace(context.Background(), "second", "winner")}
	}()
	close(start)
	var winner string
	for range 2 {
		r := <-results
		if r.err == nil {
			if winner != "" {
				t.Fatal("both publishers succeeded")
			}
			winner = r.name
		} else if !errors.Is(r.err, os.ErrExist) {
			t.Fatal(r.err)
		}
	}
	if winner == "" {
		t.Fatal("no publisher succeeded")
	}
	if raw, err := d.ReadFile("winner", 100); err != nil || string(raw) != winner {
		t.Fatal("winner overwritten", string(raw), winner, err)
	}
}

func TestNonblockingFileLockUsesSameLockAcrossDirectoryHandles(t *testing.T) {
	d, path := privateDirectory(t)
	other, err := OpenPrivateDirectory(path, false)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	lock, err := d.TryLock(".lock")
	if err != nil {
		t.Fatal(err)
	}
	if competing, err := other.TryLock(".lock"); !errors.Is(err, ErrBusy) {
		if competing != nil {
			competing.Close()
		}
		t.Fatal("lock not exclusive", err)
	}
	if err := lock.Close(); err != nil {
		t.Fatal(err)
	}
	next, err := other.TryLock(".lock")
	if err != nil {
		t.Fatal("lock not released", err)
	}
	defer next.Close()
}
