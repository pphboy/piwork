//go:build linux

package client

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestCredentialConditionalClearPreservesNewSessions(t *testing.T) {
	for _, kind := range []string{"matching-origin", "same-core-new-token", "different-core-same-token", "absent-file", "absent-directory", "malformed", "malformed-origin", "unsafe"} {
		t.Run(kind, func(t *testing.T) {
			store := CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}
			old := fixtureCredential("http://127.0.0.1:7171/")
			current := old
			switch kind {
			case "same-core-new-token":
				current.Token = "new-token"
			case "different-core-same-token":
				current.CoreURL = "http://127.0.0.1:7172/"
			case "malformed-origin":
				current.CoreURL = "not-an-origin"
			}
			if kind != "absent-directory" {
				if err := store.Save(current); err != nil {
					t.Fatal(err)
				}
			}
			switch kind {
			case "absent-file":
				if err := os.Remove(store.Path); err != nil {
					t.Fatal(err)
				}
			case "malformed":
				if err := os.WriteFile(store.Path, []byte("{bad json"), 0600); err != nil {
					t.Fatal(err)
				}
			case "unsafe":
				if err := os.Chmod(store.Path, 0644); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := os.ReadFile(store.Path)
			err := store.ClearSession("http://127.0.0.1:7171", old.Token)
			after, readErr := os.ReadFile(store.Path)
			switch kind {
			case "malformed", "malformed-origin", "unsafe":
				if err == nil || readErr != nil || !bytes.Equal(before, after) {
					t.Fatal("unsafe clear succeeded or changed record", err, readErr)
				}
			case "same-core-new-token", "different-core-same-token":
				if err != nil || readErr != nil || !bytes.Equal(before, after) {
					t.Fatal("new session removed", err, readErr)
				}
			default:
				if err != nil || !os.IsNotExist(readErr) {
					t.Fatal("matching/absent cleanup failed", err, readErr)
				}
			}
		})
	}
}

// The helper deliberately pauses between reading a matching identity and
// removing it. Another OS process must not publish in that gap.
func TestCredentialMutationLockProcesses(t *testing.T) {
	if path := os.Getenv("PIWORK_TEST_CREDENTIAL_LOCK_HELPER"); path != "" {
		d, err := openCredentialDirectory(path, false)
		if err != nil {
			t.Fatal(err)
		}
		defer d.close()
		if err := d.lock(); err != nil {
			t.Fatal(err)
		}
		current, err := d.load()
		if err != nil || current == nil {
			t.Fatal(err)
		}
		if _, err := os.Stdout.WriteString("locked\n"); err != nil {
			t.Fatal(err)
		}
		if _, err := io.ReadFull(os.Stdin, make([]byte, 1)); err != nil {
			t.Fatal(err)
		}
		if err := d.clearSession(current.CoreURL, current.Token); err != nil {
			t.Fatal(err)
		}
		return
	}
	store := CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "client.json")}
	old := fixtureCredential("http://127.0.0.1:7171/")
	if err := store.Save(old); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(store.Path)
	helper := exec.Command(os.Args[0], "-test.run=^TestCredentialMutationLockProcesses$")
	helper.Env = append(os.Environ(), "PIWORK_TEST_CREDENTIAL_LOCK_HELPER="+store.Path)
	input, err := helper.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	output, err := helper.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostic bytes.Buffer
	helper.Stderr = &diagnostic
	if err := helper.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = helper.Process.Kill() })
	ready := make(chan bool, 1)
	go func() { scanner := bufio.NewScanner(output); ready <- scanner.Scan() && scanner.Text() == "locked" }()
	select {
	case ok := <-ready:
		if !ok {
			t.Fatal("lock helper failed", diagnostic.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("lock helper timed out")
	}
	newer := old
	newer.Token = "new-token"
	for name, mutation := range map[string]func() error{
		"Save": func() error { return store.Save(newer) }, "Clear": store.Clear,
		"ClearSession": func() error { return store.ClearSession(old.CoreURL, old.Token) },
	} {
		began := time.Now()
		if err := mutation(); err == nil || time.Since(began) > time.Second {
			t.Fatal(name, "did not fail promptly under a cross-process lock", err)
		}
		after, err := os.ReadFile(store.Path)
		if err != nil || !bytes.Equal(before, after) {
			t.Fatal(name, "modified locked record", err)
		}
	}
	if loaded, err := store.Load(); err != nil || loaded == nil || *loaded != old {
		t.Fatal("snapshot read blocked or changed", err)
	}
	if _, err := input.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	_ = input.Close()
	if err := helper.Wait(); err != nil {
		t.Fatal(err, diagnostic.String())
	}
	if err := store.Save(newer); err != nil {
		t.Fatal("lock not released", err)
	}
	if err := store.ClearSession(old.CoreURL, old.Token); err != nil {
		t.Fatal(err)
	}
	if saved, err := store.Load(); err != nil || saved == nil || *saved != newer {
		t.Fatal("late old-session cleanup removed new record", err)
	}
}
