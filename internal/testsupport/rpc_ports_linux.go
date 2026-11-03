package testsupport

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"

	"golang.org/x/sys/unix"
)

type rpcLease struct {
	Directory string `json:"directory"`
	Port      int    `json:"port"`
}

func readLease(path string) (rpcLease, error) {
	var lease rpcLease
	info, err := os.Lstat(path)
	if err != nil {
		return lease, err
	}
	if !info.Mode().IsRegular() {
		return lease, errors.New("unsafe test RPC lease")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return lease, err
	}
	err = json.Unmarshal(raw, &lease)
	if err == nil && (lease.Directory == "" || lease.Port < 1 || lease.Port > 65535) {
		err = errors.New("invalid test RPC lease")
	}
	return lease, err
}

// LeaseRPCListener binds the actual listener without a probe/rebind window.
// Only logical ownership survives shutdown; no parent keeps a listener open.
func LeaseRPCListener(directory, registry string, excluded ...int) (net.Listener, error) {
	directory, err := filepath.Abs(directory)
	if err != nil {
		return nil, err
	}
	if registry == "" {
		registry = filepath.Join(os.TempDir(), fmt.Sprintf("piwork-test-rpc-%d", os.Getuid()))
	}
	if err := os.Mkdir(registry, 0700); err != nil && !os.IsExist(err) {
		return nil, err
	}
	info, err := os.Lstat(registry)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 {
		return nil, errors.New("unsafe test RPC registry")
	}
	fd, err := unix.Open(filepath.Join(registry, "lock"), unix.O_CREAT|unix.O_RDWR|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, err
	}
	defer unix.Close(fd)
	if err := unix.Flock(fd, unix.LOCK_EX); err != nil {
		return nil, err
	}
	defer unix.Flock(fd, unix.LOCK_UN)
	record := directory + ".test-rpc.json"
	lease, err := readLease(record)
	if err == nil {
		if lease.Directory != directory {
			return nil, errors.New("test RPC lease owner mismatch")
		}
		registered, err := readLease(filepath.Join(registry, strconv.Itoa(lease.Port)+".json"))
		if err != nil || registered != lease {
			return nil, errors.New("test RPC lease registration mismatch")
		}
		return net.Listen("tcp4", net.JoinHostPort("0.0.0.0", strconv.Itoa(lease.Port)))
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	for attempt := 0; attempt < 128; attempt++ {
		listener, err := net.Listen("tcp4", "0.0.0.0:0")
		if err != nil {
			return nil, err
		}
		lease = rpcLease{Directory: directory, Port: listener.Addr().(*net.TCPAddr).Port}
		conflict := false
		for _, port := range excluded {
			conflict = conflict || port == lease.Port
		}
		if conflict {
			listener.Close()
			continue
		}
		registration := filepath.Join(registry, strconv.Itoa(lease.Port)+".json")
		previous, err := readLease(registration)
		if err == nil {
			if _, e := os.Stat(previous.Directory); !os.IsNotExist(e) {
				listener.Close()
				continue
			}
		} else if !os.IsNotExist(err) {
			listener.Close()
			return nil, err
		}
		raw, _ := json.Marshal(lease)
		if err := os.WriteFile(registration, raw, 0600); err != nil {
			listener.Close()
			return nil, err
		}
		if err := os.WriteFile(record, raw, 0600); err != nil {
			listener.Close()
			os.Remove(registration)
			return nil, err
		}
		return listener, nil
	}
	return nil, errors.New("test RPC lease allocation exhausted")
}
