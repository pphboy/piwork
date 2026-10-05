package client

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"piwork/internal/clientfs"
	"testing"
	"time"
)

func TestDesktopPreferencesProcessHelper(t *testing.T) {
	path := os.Getenv("PIWORK_TEST_PREFERENCE_LOCK")
	if path == "" {
		return
	}
	dir, err := clientfs.OpenPrivateDirectory(path, false)
	if err != nil {
		os.Exit(91)
	}
	defer dir.Close()
	lock, err := dir.TryLock(".lock")
	if err != nil {
		os.Exit(92)
	}
	defer lock.Close()
	os.Stdout.WriteString("locked\n")
	<-time.After(time.Hour)
}

func TestDesktopPreferencesNativeProcessContentionAndCrashRecovery(t *testing.T) {
	store, _, path := preferenceFixture(t)
	if _, err := store.Save(t.Context(), "https://original.example", nil); err != nil {
		t.Fatal(err)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command(executable, "-test.run=^TestDesktopPreferencesProcessHelper$")
	command.Dir = t.TempDir()
	command.Env = append(os.Environ(), "PIWORK_TEST_PREFERENCE_LOCK="+path)
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { command.Process.Kill(); command.Wait() }()
	ready := make(chan bool, 1)
	go func() {
		var raw [7]byte
		n, err := output.Read(raw[:])
		ready <- err == nil && n == 7 && string(raw[:]) == "locked\n"
	}()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("native preference writer did not lock")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("native writer timed out")
	}
	if _, err := store.Save(t.Context(), "https://replacement.example", nil); !errors.Is(err, clientfs.ErrBusy) {
		t.Fatal("another process bypassed preference lock", err)
	}
	if err := store.Clear(t.Context(), nil); !errors.Is(err, clientfs.ErrBusy) {
		t.Fatal("clear bypassed preference lock", err)
	}
	if core, err := store.Load(); err != nil || core == nil || *core != "https://original.example" {
		t.Fatal("contended state changed", err)
	}
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	command.Wait()
	if _, err := store.Save(t.Context(), "https://after-crash.example", nil); err != nil {
		t.Fatal("crashed writer retained lock", err)
	}
	if _, err := os.Stat(filepath.Join(path, "preferences.json")); err != nil {
		t.Fatal(err)
	}
}
