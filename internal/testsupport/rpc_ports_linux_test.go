package testsupport

import (
	"net"
	"os"
	"path/filepath"
	"testing"
)

func TestRPCLeaseIsolationRestartConflictAndRelease(t *testing.T) {
	registry := filepath.Join(t.TempDir(), "leases")
	first, second := t.TempDir(), t.TempDir()
	a, err := LeaseRPCListener(first, registry)
	if err != nil {
		t.Fatal(err)
	}
	b, err := LeaseRPCListener(second, registry)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	if a.Addr().String() == b.Addr().String() {
		t.Fatal("installations shared a port")
	}
	address := a.Addr().String()
	a.Close()
	blocker, err := net.Listen("tcp4", address)
	if err != nil {
		t.Fatal("shutdown retained listener", err)
	}
	if l, err := LeaseRPCListener(first, registry); err == nil {
		l.Close()
		t.Fatal("silently replaced occupied original port")
	}
	blocker.Close()
	restarted, err := LeaseRPCListener(first, registry)
	if err != nil {
		t.Fatal(err)
	}
	if restarted.Addr().String() != address {
		t.Fatal("restart changed endpoint")
	}
	restarted.Close()
	if err := os.Remove(first + ".test-rpc.json"); err != nil {
		t.Fatal(err)
	}
}

func TestRPCLeaseRejectsUnsafeRecord(t *testing.T) {
	root, registry := t.TempDir(), filepath.Join(t.TempDir(), "leases")
	outside := filepath.Join(t.TempDir(), "sentinel")
	if err := os.WriteFile(outside, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, root+".test-rpc.json"); err != nil {
		t.Fatal(err)
	}
	if l, err := LeaseRPCListener(root, registry); err == nil {
		l.Close()
		t.Fatal("followed unsafe lease")
	}
	raw, _ := os.ReadFile(outside)
	if string(raw) != "untouched" {
		t.Fatal("outside data modified")
	}
}

func TestRPCLeaseFailedReceiptDoesNotRetainRegistration(t *testing.T) {
	registry := filepath.Join(t.TempDir(), "leases")
	missing := filepath.Join(t.TempDir(), "missing", "data")
	if listener, err := LeaseRPCListener(missing, registry); err == nil {
		listener.Close()
		t.Fatal("missing private receipt parent accepted")
	}
	files, err := filepath.Glob(filepath.Join(registry, "*.json"))
	if err != nil || len(files) != 0 {
		t.Fatal("failed handoff retained a port registration", files, err)
	}
}
