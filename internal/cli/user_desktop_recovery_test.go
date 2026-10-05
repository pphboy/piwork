//go:build linux

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/client"
)

func TestDesktopControlResourcesAndStaleRecovery(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.close)
	for _, suffix := range []string{".lock", ".json", ".sock"} {
		kind := uint32(unix.S_IFREG)
		if suffix == ".sock" {
			kind = unix.S_IFSOCK
		}
		if _, err := desktopControlStat(c.dir, desktopControlName(d.port, suffix), kind); err != nil {
			t.Fatal(err)
		}
	}
	if second, err := startDesktopControl(d); err == nil {
		second.close()
		t.Fatal("active instance lock acquired")
	}
	if _, err := requestDesktopControl(context.Background(), d.port, "open"); err != nil {
		t.Fatal("active channel removed", err)
	}
	// Emulate SIGKILL: release process handles without unlinking persisted objects.
	_ = c.listener.Close()
	_ = unix.Close(c.lock)
	c.lock = -1
	_ = unix.Close(c.dir)
	c.dir = -1
	c.closeOnce.Do(func() {})
	fresh, err := startDesktopControl(d)
	if err != nil {
		t.Fatal("stale channel not recovered", err)
	}
	defer fresh.close()
	if fresh.meta.InstanceID == c.meta.InstanceID {
		t.Fatal("stale instance reused")
	}
	for _, suffix := range []string{".sock", ".json"} {
		name := desktopControlName(d.port, suffix)
		var before unix.Stat_t
		_ = unix.Fstatat(fresh.dir, name, &before, unix.AT_SYMLINK_NOFOLLOW)
		replacement := desktopControlName(d.port, suffix+".replacement")
		fd, e := unix.Openat(fresh.dir, replacement, unix.O_CREAT|unix.O_EXCL|unix.O_WRONLY, 0600)
		if e != nil {
			t.Fatal(e)
		}
		_ = unix.Close(fd)
		if unix.Renameat(fresh.dir, replacement, fresh.dir, name) != nil {
			t.Fatal("replace inode")
		}
		desktopUnlinkOwn(fresh.dir, name, before)
		var after unix.Stat_t
		if unix.Fstatat(fresh.dir, name, &after, unix.AT_SYMLINK_NOFOLLOW) != nil {
			t.Fatal("unlinked another instance")
		}
		_ = unix.Unlinkat(fresh.dir, name, 0)
	}
}
func TestDesktopControlRejectsUnsafeObjectsAndRollsBackHTTP(t *testing.T) {
	for _, kind := range []string{"symlink", "directory", "permissions", "hardlink"} {
		t.Run(kind, func(t *testing.T) {
			d := recoveryDesktop(t)
			dir, err := openDesktopControlDirectory(true)
			if err != nil {
				t.Fatal(err)
			}
			defer unix.Close(dir)
			name := desktopControlName(d.port, ".json")
			path := desktopControlPath(dir, name)
			switch kind {
			case "symlink":
				err = os.Symlink("/etc/passwd", path)
			case "directory":
				err = os.Mkdir(path, 0600)
			default:
				err = os.WriteFile(path, []byte("unchanged"), 0600)
				if kind == "permissions" {
					err = os.Chmod(path, 0644)
				}
				if kind == "hardlink" {
					err = os.Link(path, desktopControlPath(dir, name+".link"))
					defer os.Remove(desktopControlPath(dir, name+".link"))
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			defer os.Remove(path)
			var out, stderr bytes.Buffer
			if code := runUserDesktop(d.api, d.store, nil, []string{"--port", fmt.Sprint(d.port), "--no-open"}, &out, &stderr); code != 5 || out.Len() != 0 {
				t.Fatal("unsafe channel started", code, stderr.String())
			}
			listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", d.port))
			if err != nil {
				t.Fatal("HTTP left bound", err)
			}
			_ = listener.Close()
			if _, err := os.Lstat(path); err != nil {
				t.Fatal("unsafe object removed", err)
			}
		})
	}
}
func controlRaw(t *testing.T, c *desktopLocalControl, raw string) []byte {
	t.Helper()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: desktopControlPath(c.dir, desktopControlName(c.meta.Port, ".sock")), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(2 * time.Second))
	_, _ = io.WriteString(conn, raw)
	_ = conn.CloseWrite()
	response, _ := io.ReadAll(conn)
	return response
}
func TestDesktopControlProtocolBoundsAndPeers(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	good := fmt.Sprintf(`{"version":1,"instanceId":%q,"port":%d,"action":"open"}`, c.meta.InstanceID, d.port)
	for _, raw := range []string{
		strings.Replace(good, `"version":1`, `"version":1,"version":1`, 1) + "\n",
		strings.Replace(good, `"action":"open"`, `"action":"open","unknown":true`, 1) + "\n",
		strings.Replace(good, `"version":1`, `"version":2`, 1) + "\n",
		strings.Replace(good, c.meta.InstanceID, strings.Repeat("x", 43), 1) + "\n",
		good + "\n{}\n", good, strings.Repeat(" ", desktopControlLimit) + good + "\n",
	} {
		if rawReply := controlRaw(t, c, raw); len(rawReply) != 0 {
			t.Fatal("malformed accepted", string(rawReply))
		}
	}
	if d.ticket != "" {
		t.Fatal("invalid protocol issued a ticket")
	}
	if _, err := requestDesktopControl(context.Background(), d.port, "open"); err != nil {
		t.Fatal(err)
	}
	one, two, err := unixSocketPair()
	if err != nil {
		t.Fatal(err)
	}
	defer one.Close()
	defer two.Close()
	if !desktopPeerUID(one, uint32(os.Geteuid())) || desktopPeerUID(one, uint32(os.Geteuid()+1)) {
		t.Fatal("peer UID accepted wrong user")
	}
	held := []*net.UnixConn{}
	for i := 0; i < 16; i++ {
		conn, e := net.DialUnix("unix", nil, &net.UnixAddr{Name: desktopControlPath(c.dir, desktopControlName(d.port, ".sock")), Net: "unix"})
		if e != nil {
			t.Fatal(e)
		}
		held = append(held, conn)
	}
	defer func() {
		for _, conn := range held {
			_ = conn.Close()
		}
	}()
	deadline := time.Now().Add(time.Second)
	for len(c.slots) != 16 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	response := controlRaw(t, c, good+"\n")
	if !bytes.Contains(response, []byte("LOCAL_CONTROL_BUSY")) {
		t.Fatal("connection cap", string(response))
	}
}
func unixSocketPair() (*net.UnixConn, *net.UnixConn, error) {
	fds, err := unix.Socketpair(unix.AF_UNIX, unix.SOCK_STREAM|unix.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, nil, err
	}
	first, second := os.NewFile(uintptr(fds[0]), "one"), os.NewFile(uintptr(fds[1]), "two")
	defer first.Close()
	defer second.Close()
	one, err := net.FileConn(first)
	if err != nil {
		return nil, nil, err
	}
	two, err := net.FileConn(second)
	if err != nil {
		one.Close()
		return nil, nil, err
	}
	return one.(*net.UnixConn), two.(*net.UnixConn), nil
}
func TestDesktopLogoutCleanupRetryAndConditionalDeletion(t *testing.T) {
	var offline atomic.Bool
	var requests atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if offline.Load() {
			w.WriteHeader(503)
		} else {
			w.WriteHeader(204)
		}
	}))
	defer core.Close()
	d := recoveryDesktop(t)
	old := client.Credential{Version: 1, CoreURL: core.URL, Token: "old-secret", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "old", Account: "owner", Role: "user"}}
	d.identity.coreURL = core.URL
	d.identity.credential = &old
	if err := d.store.Save(old); err != nil {
		t.Fatal(err)
	}
	// Wrong file mode prevents deletion, then repeat logout must retain its capture.
	if err := os.Chmod(d.store.Path, 0644); err != nil {
		t.Fatal(err)
	}
	result := d.logoutIdentity()
	if result.CredentialCleared || !result.LocalCleared || d.pendingCleanup == nil {
		t.Fatal("storage cleanup falsely confirmed", result)
	}
	login := recoveryHTTP(d, "POST", "/_desktop/api/login", `{"account":"x","password":"x"}`, "", "")
	// Invoke login directly to isolate pending-cleanup from local Cookie rejection.
	request := httptest.NewRequest("POST", d.origin+"/_desktop/api/login", strings.NewReader(`{"account":"x","password":"x"}`))
	request.Header.Set("Content-Type", "application/json")
	login = httptest.NewRecorder()
	d.login(login, request, "csrf")
	if login.Code != 409 || !strings.Contains(login.Body.String(), "CREDENTIAL_CLEANUP_REQUIRED") {
		t.Fatal("new login accepted before cleanup", login.Code)
	}
	if err := os.Chmod(d.store.Path, 0600); err != nil {
		t.Fatal(err)
	}
	fresh := old
	fresh.Token = "new-secret"
	if err := d.store.Save(fresh); err != nil {
		t.Fatal(err)
	}
	result = d.logoutIdentity()
	if !result.CredentialCleared || d.pendingCleanup != nil {
		t.Fatal("retry failed", result)
	}
	saved, err := d.store.Load()
	if err != nil || saved == nil || saved.Token != fresh.Token {
		t.Fatal("conditional cleanup removed new credential")
	}
	offline.Store(true)
	d.identity.credential = &old
	result = d.logoutIdentity()
	if !result.CredentialCleared || result.RemoteRevocationConfirmed {
		t.Fatal("offline revocation claimed", result)
	}
	result = d.logoutIdentity()
	if !result.RemoteRevocationConfirmed {
		t.Fatal("empty logout not idempotent")
	}
}
func TestDesktopControlIdleDeadlineAndClientGenerationValidation(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: desktopControlPath(c.dir, desktopControlName(d.port, ".sock")), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(12 * time.Second))
	start := time.Now()
	raw, _ := io.ReadAll(conn)
	if len(raw) != 0 || time.Since(start) > 11*time.Second || time.Since(start) < 9*time.Second {
		t.Fatal("server did not bound idle connection", time.Since(start))
	}
	// Retain trusted socket/metadata, substitute a protocol-incompatible server.
	_ = c.listener.Close()
	name := desktopControlName(d.port, ".sock")
	desktopUnlinkOwn(c.dir, name, c.socketStat)
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: desktopControlPath(c.dir, name), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	listener.SetUnlinkOnClose(false)
	if err := os.Chmod(desktopControlPath(c.dir, name), 0600); err != nil {
		t.Fatal(err)
	}
	c.socketStat, err = desktopControlStat(c.dir, name, unix.S_IFSOCK)
	if err != nil {
		t.Fatal(err)
	}
	meta := c.meta
	meta.SocketDevice = uint64(c.socketStat.Dev)
	meta.SocketInode = c.socketStat.Ino
	file, err := os.OpenFile(desktopControlPath(c.dir, desktopControlName(d.port, ".json")), os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewEncoder(file).Encode(meta)
	_ = file.Close()
	go func() {
		incoming, e := listener.AcceptUnix()
		if e != nil {
			return
		}
		defer incoming.Close()
		var request desktopControlRequest
		_ = desktopControlRead(incoming, &request)
		_ = json.NewEncoder(incoming).Encode(desktopControlReply{Version: 2, Port: d.port, InstanceID: meta.InstanceID})
	}()
	if _, err := requestDesktopControl(context.Background(), d.port, "open"); !errors.Is(err, errDesktopControlProtocol) {
		t.Fatal("client accepted mismatched response", err)
	}
}

func TestDesktopLogoutIsBoundedAndDisconnectDoesNotCancelCleanup(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(started); <-r.Context().Done(); close(cancelled) }))
	defer core.Close()
	d := recoveryDesktop(t)
	record := client.Credential{Version: 1, CoreURL: core.URL, Token: "captured-secret", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	d.identity.coreURL = core.URL
	d.identity.credential = &record
	if err := d.store.Save(record); err != nil {
		t.Fatal(err)
	}
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	conn, err := net.DialUnix("unix", nil, &net.UnixAddr{Name: desktopControlPath(c.dir, desktopControlName(d.port, ".sock")), Net: "unix"})
	if err != nil {
		t.Fatal(err)
	}
	_ = json.NewEncoder(conn).Encode(desktopControlRequest{Version: 1, Port: d.port, InstanceID: c.meta.InstanceID, Action: "logout"})
	_ = conn.CloseWrite()
	<-started
	_ = conn.Close()
	select {
	case <-cancelled:
	case <-time.After(6 * time.Second):
		t.Fatal("remote cleanup not bounded")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		saved, err := d.store.Load()
		if err == nil && saved == nil {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("accepted cleanup cancelled by helper disconnect")
}

func TestDesktopControlDirectoryOwnerAndModeBoundary(t *testing.T) {
	uid := uint32(os.Geteuid())
	if !validDesktopControlDirectory(unix.Stat_t{Uid: uid, Mode: unix.S_IFDIR | 0700}, uid) {
		t.Fatal("private directory rejected")
	}
	for _, st := range []unix.Stat_t{{Uid: uid + 1, Mode: unix.S_IFDIR | 0700}, {Uid: uid, Mode: unix.S_IFDIR | 0750}, {Uid: uid, Mode: unix.S_IFLNK | 0700}, {Uid: uid, Mode: unix.S_IFREG | 0700}} {
		if validDesktopControlDirectory(st, uid) {
			t.Fatal("unsafe directory accepted")
		}
	}
}
func desktopControlFixturePortAvailable(port int) bool {
	for _, suffix := range []string{".json", ".sock"} {
		_, err := os.Lstat(filepath.Join("/tmp", fmt.Sprintf("piwork-desktop-%d", os.Geteuid()), desktopControlName(port, suffix)))
		if !errors.Is(err, os.ErrNotExist) {
			return false
		}
	}
	return true
}
