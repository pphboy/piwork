package clientfs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestFileIdentityDetectsModificationAndReplacement(t *testing.T) {
	d, path := privateDirectory(t)
	f, err := d.CreateExclusive("input")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.Write([]byte("original")); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	f, err = d.OpenRegular("input")
	if err != nil {
		t.Fatal(err)
	}
	defer func() { f.Close() }()
	before, err := Identity(f)
	if err != nil {
		t.Fatal(err)
	}
	f = modifyIdentityInput(t, d, path, f)
	after, err := Identity(f)
	if err != nil || before == after {
		t.Fatalf("in-place change not detected: %v before=%+v after=%+v", err, before, after)
	}
	if err := d.AtomicWrite(context.Background(), "input", []byte("replacement")); err != nil {
		t.Fatal(err)
	}
	current, err := d.OpenRegular("input")
	if err != nil {
		t.Fatal(err)
	}
	defer current.Close()
	replaced, err := Identity(current)
	if err != nil || replaced.Volume == after.Volume && replaced.FileID == after.FileID {
		t.Fatal("replacement retained old identity", err)
	}
	if _, err := Identity(nil); err == nil {
		t.Fatal("unknown file got an identity")
	}
}

func writeIdentityInput(t *testing.T, path string) {
	t.Helper()
	writer, err := os.OpenFile(filepath.Join(path, "input"), os.O_WRONLY, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := writer.WriteAt([]byte("changed!"), 0); err != nil {
		t.Fatal(err)
	}
	if err := errors.Join(writer.Sync(), writer.Close()); err != nil {
		t.Fatal(err)
	}
}

func TestAvailableSpaceIsNativeBoundedAndUnknownFails(t *testing.T) {
	d, _ := privateDirectory(t)
	available, err := d.FreeBytes()
	if err != nil || available > uint64(^uint64(0)>>1) {
		t.Fatal("cannot verify native capacity bound", err)
	}
	if enough, err := d.HasSpace(int64(available), 1); err != nil || enough {
		t.Fatal("insufficient native capacity accepted", enough, err)
	}
	if available, err := d.FreeBytes(); err != nil || available == 0 {
		t.Fatal("native capacity unavailable", available, err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := d.FreeBytes(); err == nil {
		t.Fatal("unknown volume treated as usable capacity")
	}
	for _, values := range [][3]uint64{{1, 0, 512}, {1, 1, 0}, {^uint64(0), 2, 512}, {1, ^uint64(0), 2}} {
		if _, err := availableBytes(values[0], values[1], values[2]); err == nil {
			t.Fatal("invalid/overflowed capacity accepted", values)
		}
	}
	if available, err := availableBytes(0, 8, 512); err != nil || available != 0 {
		t.Fatal("known full disk misreported", available, err)
	}
}

func TestProcessLivenessOnlyConfirmsStaleAfterNativeExit(t *testing.T) {
	d, path := privateDirectory(t)
	_ = d
	if alive, err := ProcessAlive(os.Getpid()); err != nil || !alive {
		t.Fatal("current process considered stale", alive, err)
	}
	child := startHelper(t, "lock", path)
	if alive, err := ProcessAlive(child.Process.Pid); err != nil || !alive {
		t.Fatal("active child considered stale", alive, err)
	}
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	if alive, err := ProcessAlive(child.Process.Pid); err != nil || alive {
		t.Fatal("native exit not confirmed", alive, err)
	}
	for _, pid := range []int{0, -1} {
		if alive, err := ProcessAlive(pid); err == nil || !alive {
			t.Fatal("unknown process can be cleaned", pid, alive, err)
		}
	}
}
