//go:build linux

package safefs

import (
	"bytes"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func privateTestRoot(t *testing.T) (*Root, string) {
	t.Helper()
	directory := t.TempDir()
	if err := os.Chmod(directory, 0700); err != nil {
		t.Fatal(err)
	}
	r, err := OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	if err := r.Lock(); err != nil {
		t.Fatal(err)
	}
	return r, directory
}
func TestAnonymousAndFallbackFilesRemainUnlinked(t *testing.T) {
	for _, prefer := range []bool{true, false} {
		r, _ := privateTestRoot(t)
		f, err := r.anonymousFile("inspection-test", prefer)
		if err != nil {
			t.Fatal(err)
		}
		data := bytes.Repeat([]byte{0, 255, 17}, 4096)
		if _, err := f.Write(data); err != nil {
			t.Fatal(err)
		}
		if _, err := f.Seek(0, 0); err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(f)
		if err != nil || !bytes.Equal(data, got) {
			t.Fatal(err)
		}
		info, err := f.Stat()
		if err != nil {
			t.Fatal(err)
		}
		stat := info.Sys().(*syscall.Stat_t)
		if stat.Nlink != 0 || info.Mode().Perm() != 0600 {
			t.Fatal(stat.Nlink, info.Mode())
		}
		entries, err := r.Entries()
		if err != nil || len(entries) != 0 {
			t.Fatal(entries, err)
		}
		f.Close()
	}
}
func TestAnonymousRecoveryOwnsOnlyEmptyInstallationPlaceholders(t *testing.T) {
	r, directory := privateTestRoot(t)
	own := "image-inspection-a"
	foreign := "image-inspection-b-" + strings.Repeat("f", 32) + ".empty"
	name := own + "-" + strings.Repeat("a", 32) + ".empty"
	for _, n := range []string{name, foreign, "unrelated.txt"} {
		if err := os.WriteFile(filepath.Join(directory, n), nil, 0600); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.RecoverAnonymousPlaceholders(own); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(directory, name)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	for _, n := range []string{foreign, "unrelated.txt"} {
		if _, err := os.Stat(filepath.Join(directory, n)); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, name), []byte("retain unexpected data"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := r.RecoverAnonymousPlaceholders(own); !errors.Is(err, ErrUnsafePath) {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(filepath.Join(directory, name))
	if string(got) != "retain unexpected data" {
		t.Fatal("unexpected file removed")
	}
}
func TestAnonymousCrashChild(t *testing.T) {
	directory := os.Getenv("PIWORK_ANONYMOUS_CRASH_ROOT")
	if directory == "" {
		return
	}
	r, err := OpenRoot(directory)
	if err != nil {
		os.Exit(21)
	}
	if r.Lock() != nil {
		os.Exit(22)
	}
	f, err := r.AnonymousFile("image-inspection-crash")
	if err != nil {
		os.Exit(23)
	}
	if _, err = f.Write(bytes.Repeat([]byte{1}, 8192)); err != nil {
		os.Exit(24)
	}
	info, err := f.Stat()
	if err != nil || info.Sys().(*syscall.Stat_t).Nlink != 0 {
		os.Exit(25)
	}
	os.Stdout.Write([]byte("READY\n"))
	time.Sleep(time.Minute)
	os.Exit(26)
}
func TestInspectionSIGKILLLeavesNoNamedArchive(t *testing.T) {
	directory := t.TempDir()
	os.Chmod(directory, 0700)
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(binary, "-test.run=^TestAnonymousCrashChild$")
	cmd.Env = append(os.Environ(), "PIWORK_ANONYMOUS_CRASH_ROOT="+directory)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cmd.Process.Kill(); cmd.Wait() })
	ready := make(chan error, 1)
	go func() {
		var b [6]byte
		_, err := io.ReadFull(stdout, b[:])
		if err == nil && string(b[:]) != "READY\n" {
			err = ErrUnsafePath
		}
		ready <- err
	}()
	select {
	case err := <-ready:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("child did not initialize")
	}
	if err := cmd.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	cmd.Wait()
	r, err := OpenRoot(directory)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if err := r.Lock(); err != nil {
		t.Fatal("killed inspector retained lock", err)
	}
	entries, err := r.Entries()
	if err != nil || len(entries) != 0 {
		t.Fatal(entries, err)
	}
}
