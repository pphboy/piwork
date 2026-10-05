package clientfs

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestClientFSProcessHelper(t *testing.T) {
	mode := os.Getenv("PIWORK_CLIENTFS_HELPER_MODE")
	if mode == "" {
		return
	}
	d, err := OpenPrivateDirectory(os.Getenv("PIWORK_CLIENTFS_HELPER_PATH"), false)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	defer d.Close()
	switch mode {
	case "lock":
		lock, err := d.TryLock(".lock")
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		defer lock.Close()
	case "half-write":
		f, _, err := d.CreateTemp(".interrupted-")
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		defer f.Close()
		if _, err := f.Write([]byte("partial candidate")); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
	default:
		os.Exit(2)
	}
	fmt.Println("ready")
	_, _ = io.Copy(io.Discard, os.Stdin)
}

func startHelper(t *testing.T, mode, path string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, executable, "-test.run=^TestClientFSProcessHelper$")
	cmd.Dir = filepath.Dir(executable)
	cmd.Env = append(os.Environ(), "PIWORK_CLIENTFS_HELPER_MODE="+mode, "PIWORK_CLIENTFS_HELPER_PATH="+path)
	stdin, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { stdin.Close() })
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil || line != "ready\n" {
		t.Fatalf("helper failed to become ready: %q %v", line, err)
	}
	return cmd
}

func TestNativeProcessCrashReleasesFileLock(t *testing.T) {
	d, path := privateDirectory(t)
	child := startHelper(t, "lock", path)
	lock, err := d.TryLock(".lock")
	if lock != nil {
		lock.Close()
	}
	if err != ErrBusy {
		t.Fatal("cross-process lock not exclusive", err)
	}
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	recovered, err := d.TryLock(".lock")
	if err != nil {
		t.Fatal("process crash retained lock", err)
	}
	recovered.Close()
}

func TestNativeProcessCrashCannotPublishHalfWrittenCandidate(t *testing.T) {
	d, path := privateDirectory(t)
	if err := d.AtomicWrite(context.Background(), "record", []byte("old complete record")); err != nil {
		t.Fatal(err)
	}
	child := startHelper(t, "half-write", path)
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	if raw, err := d.ReadFile("record", 64); err != nil || string(raw) != "old complete record" {
		t.Fatal("half-write reached committed state", string(raw), err)
	}
}
