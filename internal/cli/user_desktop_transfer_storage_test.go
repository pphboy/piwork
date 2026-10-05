package cli

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"piwork/internal/clientfs"
	"testing"
	"time"
)

func TestDesktopTransferCleanupProcessHelper(t *testing.T) {
	if os.Getenv("PIWORK_TEST_TRANSFER_PROCESS") != "1" {
		return
	}
	os.Stdout.WriteString("ready\n")
	<-time.After(time.Hour)
}

func TestDesktopTransferCleanupOnlyRemovesConfirmedStalePrivateInstances(t *testing.T) {
	command := nativeTestCommand(t, "-test.run=^TestDesktopTransferCleanupProcessHelper$")
	command.Env = append(os.Environ(), "PIWORK_TEST_TRANSFER_PROCESS=1")
	output, err := command.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := command.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { command.Process.Kill(); command.Wait() }()
	ready := make(chan string, 1)
	go func() { line, _ := bufio.NewReader(output).ReadString('\n'); ready <- line }()
	select {
	case line := <-ready:
		if line != "ready\n" {
			t.Fatal("fixture did not start")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fixture startup timed out")
	}
	stalePID := command.Process.Pid
	if err := command.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	command.Wait()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	path := filepath.Join(filepath.Dir(credential), "desktop-transfers-go")
	parent, err := clientfs.OpenPrivateDirectory(path, true)
	if err != nil {
		t.Fatal(err)
	}
	defer parent.Close()
	stale := fmt.Sprintf("instance-%d-stale", stalePID)
	active := fmt.Sprintf("instance-%d-active", os.Getpid())
	unknown := "instance-0-unknown"
	for _, name := range []string{stale, active, unknown} {
		child, err := parent.Child(name, true)
		if err != nil {
			t.Fatal(err)
		}
		err = child.AtomicWrite(t.Context(), "sentinel", []byte("private"))
		child.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	transfers, err := newDesktopTransfers(credential)
	if err != nil {
		t.Fatal(err)
	}
	defer transfers.clear()
	if _, err := os.Stat(filepath.Join(path, stale)); !os.IsNotExist(err) {
		t.Fatal("confirmed stale instance retained", err)
	}
	for _, name := range []string{active, unknown} {
		raw, err := os.ReadFile(filepath.Join(path, name, "sentinel"))
		if err != nil || string(raw) != "private" {
			t.Fatal("live or unknown instance removed", name, err)
		}
	}
}
