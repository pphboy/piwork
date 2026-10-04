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
	"os"
	"os/signal"
	"strconv"
	"sync"
	"time"

	"golang.org/x/sys/unix"
)

const desktopControlLimit = 16 << 10

var errDesktopControlSecurity = errors.New("Desktop control channel security check failed; use the same system user")
var errDesktopControlMissing = errors.New("Desktop instance is not running; start piwork-cli desktop on this port")
var errDesktopControlProtocol = errors.New("Desktop control channel is unavailable or incompatible; check the running instance")

type desktopControlMeta struct {
	Version      int    `json:"version"`
	InstanceID   string `json:"instanceId"`
	Port         int    `json:"port"`
	SocketDevice uint64 `json:"socketDevice"`
	SocketInode  uint64 `json:"socketInode"`
}
type desktopControlRequest struct {
	Version    int    `json:"version"`
	InstanceID string `json:"instanceId"`
	Port       int    `json:"port"`
	Action     string `json:"action"`
}
type desktopControlReply struct {
	Version                   int    `json:"version"`
	InstanceID                string `json:"instanceId"`
	Port                      int    `json:"port"`
	LaunchURL                 string `json:"launchUrl,omitempty"`
	LocalCleared              bool   `json:"localCleared,omitempty"`
	RemoteRevocationConfirmed bool   `json:"remoteRevocationConfirmed,omitempty"`
	CredentialCleared         bool   `json:"credentialCleared,omitempty"`
	Error                     string `json:"error,omitempty"`
}
type desktopLocalControl struct {
	dir, lock            int
	listener             *net.UnixListener
	meta                 desktopControlMeta
	socketStat, metaStat unix.Stat_t
	slots                chan struct{}
	closeOnce            sync.Once
	workers              sync.WaitGroup
}

func parseDesktopControlOptions(args []string) (desktopOptions, error) {
	if len(args) == 0 || args[0] != "open" && args[0] != "logout" {
		return desktopOptions{}, errors.New("invalid desktop control command")
	}
	options, err := parseUserDesktopOptions(args[1:])
	if err == nil && args[0] == "logout" && !options.open {
		err = errors.New("desktop logout does not accept --no-open")
	}
	return options, err
}

func openDesktopControlDirectory(create bool) (int, error) {
	parent, err := unix.Open("/tmp", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, errDesktopControlSecurity
	}
	defer unix.Close(parent)
	name := fmt.Sprintf("piwork-desktop-%d", os.Geteuid())
	if create {
		if err := unix.Mkdirat(parent, name, 0700); err != nil && !errors.Is(err, unix.EEXIST) {
			return -1, errDesktopControlSecurity
		}
	}
	fd, err := unix.Openat(parent, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if errors.Is(err, unix.ENOENT) {
		return -1, errDesktopControlMissing
	}
	if err != nil {
		return -1, errDesktopControlSecurity
	}
	var st unix.Stat_t
	if unix.Fstat(fd, &st) != nil || !validDesktopControlDirectory(st, uint32(os.Geteuid())) {
		unix.Close(fd)
		return -1, errDesktopControlSecurity
	}
	return fd, nil
}
func validDesktopControlDirectory(st unix.Stat_t, uid uint32) bool {
	return st.Uid == uid && st.Mode&unix.S_IFMT == unix.S_IFDIR && st.Mode&07777 == 0700
}
func desktopControlName(port int, suffix string) string { return strconv.Itoa(port) + suffix }
func desktopControlPath(dir int, name string) string {
	return fmt.Sprintf("/proc/self/fd/%d/%s", dir, name)
}
func desktopControlStat(dir int, name string, kind uint32) (unix.Stat_t, error) {
	var st unix.Stat_t
	err := unix.Fstatat(dir, name, &st, unix.AT_SYMLINK_NOFOLLOW)
	if errors.Is(err, unix.ENOENT) {
		return st, errDesktopControlMissing
	}
	if err != nil || st.Uid != uint32(os.Geteuid()) || st.Mode&unix.S_IFMT != kind || st.Mode&07777 != 0600 || st.Nlink != 1 {
		return st, errDesktopControlSecurity
	}
	return st, nil
}
func desktopSameInode(a, b unix.Stat_t) bool { return a.Dev == b.Dev && a.Ino == b.Ino }
func desktopUnlinkOwn(dir int, name string, before unix.Stat_t) {
	var current unix.Stat_t
	if unix.Fstatat(dir, name, &current, unix.AT_SYMLINK_NOFOLLOW) == nil && desktopSameInode(current, before) {
		_ = unix.Unlinkat(dir, name, 0)
	}
}
func desktopReadMeta(dir, port int) (desktopControlMeta, unix.Stat_t, error) {
	var meta desktopControlMeta
	name := desktopControlName(port, ".json")
	st, err := desktopControlStat(dir, name, unix.S_IFREG)
	if err != nil {
		return meta, st, err
	}
	fd, err := unix.Openat(dir, name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return meta, st, errDesktopControlSecurity
	}
	file := os.NewFile(uintptr(fd), "Desktop control metadata")
	defer file.Close()
	var opened unix.Stat_t
	if unix.Fstat(fd, &opened) != nil || !desktopSameInode(st, opened) {
		return meta, st, errDesktopControlSecurity
	}
	raw, err := io.ReadAll(io.LimitReader(file, desktopControlLimit+1))
	if err != nil || len(raw) > desktopControlLimit || desktopStrictJSON(raw, &meta) != nil || meta.Version != 1 || meta.Port != port || len(meta.InstanceID) != 43 || meta.SocketInode == 0 {
		return meta, st, errDesktopControlProtocol
	}
	return meta, st, nil
}

func startDesktopControl(d *nativeDesktop) (*desktopLocalControl, error) {
	dir, err := openDesktopControlDirectory(true)
	if err != nil {
		return nil, err
	}
	c := &desktopLocalControl{dir: dir, lock: -1, meta: desktopControlMeta{Port: d.port}, slots: make(chan struct{}, 16)}
	success := false
	defer func() {
		if !success {
			c.close()
		}
	}()
	lockName := desktopControlName(d.port, ".lock")
	lock, err := unix.Openat(dir, lockName, unix.O_RDWR|unix.O_CREAT|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	c.lock = lock
	st, err := desktopControlStat(dir, lockName, unix.S_IFREG)
	var opened unix.Stat_t
	if err != nil || unix.Fstat(lock, &opened) != nil || !desktopSameInode(st, opened) {
		return nil, errDesktopControlSecurity
	}
	if unix.Flock(lock, unix.LOCK_EX|unix.LOCK_NB) != nil {
		return nil, errDesktopControlProtocol
	}
	currentLock, err := desktopControlStat(dir, lockName, unix.S_IFREG)
	if err != nil || !desktopSameInode(st, currentLock) {
		return nil, errDesktopControlSecurity
	}
	// Only the lock holder can remove verified stale objects. Never follow links.
	for _, suffix := range []string{".json", ".sock"} {
		kind := uint32(unix.S_IFREG)
		if suffix == ".sock" {
			kind = unix.S_IFSOCK
		}
		name := desktopControlName(d.port, suffix)
		before, err := desktopControlStat(dir, name, kind)
		if errors.Is(err, errDesktopControlMissing) {
			continue
		}
		if err != nil {
			return nil, err
		}
		desktopUnlinkOwn(dir, name, before)
	}
	instance, err := desktopSecret()
	if err != nil {
		return nil, errDesktopControlProtocol
	}
	socketName := desktopControlName(d.port, ".sock")
	fd, err := unix.Socket(unix.AF_UNIX, unix.SOCK_STREAM|unix.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, errDesktopControlProtocol
	}
	file := os.NewFile(uintptr(fd), "Desktop control socket")
	defer file.Close()
	if unix.Bind(fd, &unix.SockaddrUnix{Name: desktopControlPath(dir, socketName)}) != nil {
		return nil, errDesktopControlProtocol
	}
	var bound unix.Stat_t
	if unix.Fstatat(dir, socketName, &bound, unix.AT_SYMLINK_NOFOLLOW) != nil {
		return nil, errDesktopControlSecurity
	}
	c.socketStat = bound
	if unix.Fchmodat(dir, socketName, 0600, 0) != nil || unix.Listen(fd, 16) != nil {
		return nil, errDesktopControlProtocol
	}
	c.socketStat, err = desktopControlStat(dir, socketName, unix.S_IFSOCK)
	if err != nil || !desktopSameInode(bound, c.socketStat) {
		return nil, errDesktopControlSecurity
	}
	listener, err := net.FileListener(file)
	if err != nil {
		return nil, errDesktopControlProtocol
	}
	c.listener = listener.(*net.UnixListener)
	c.listener.SetUnlinkOnClose(false)
	c.meta = desktopControlMeta{Version: 1, InstanceID: instance, Port: d.port, SocketDevice: uint64(c.socketStat.Dev), SocketInode: c.socketStat.Ino}
	name := desktopControlName(d.port, ".json")
	metaFD, err := unix.Openat(dir, name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	mf := os.NewFile(uintptr(metaFD), "Desktop control metadata")
	_ = unix.Fstat(metaFD, &c.metaStat)
	err = json.NewEncoder(mf).Encode(c.meta)
	if err == nil {
		err = mf.Sync()
	}
	_ = mf.Close()
	if err != nil {
		return nil, errDesktopControlProtocol
	}
	success = true
	go c.serve(d)
	return c, nil
}
func (c *desktopLocalControl) close() {
	c.closeOnce.Do(func() {
		if c.listener != nil {
			_ = c.listener.Close()
		}
		if c.metaStat.Ino != 0 {
			desktopUnlinkOwn(c.dir, desktopControlName(c.meta.Port, ".json"), c.metaStat)
		}
		// The port is available even if metadata creation failed.
		port := c.meta.Port
		if port != 0 && c.socketStat.Ino != 0 {
			desktopUnlinkOwn(c.dir, desktopControlName(port, ".sock"), c.socketStat)
		}
		if c.lock >= 0 {
			_ = unix.Close(c.lock)
		}
		_ = unix.Close(c.dir)
	})
}
func desktopPeerUID(conn *net.UnixConn, uid uint32) bool {
	raw, err := conn.SyscallConn()
	if err != nil {
		return false
	}
	valid := false
	err = raw.Control(func(fd uintptr) {
		peer, e := unix.GetsockoptUcred(int(fd), unix.SOL_SOCKET, unix.SO_PEERCRED)
		valid = e == nil && peer.Uid == uid
	})
	return err == nil && valid
}

// Detect duplicate keys before decoding into the strict protocol structure.
func desktopStrictJSON(raw []byte, value any) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return errDesktopControlProtocol
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err = decoder.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return errDesktopControlProtocol
		}
		seen[key] = true
		var field json.RawMessage
		if decoder.Decode(&field) != nil {
			return errDesktopControlProtocol
		}
	}
	if _, err = decoder.Token(); err != nil {
		return errDesktopControlProtocol
	}
	if _, err = decoder.Token(); err != io.EOF {
		return errDesktopControlProtocol
	}
	decoder = json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(value) != nil {
		return errDesktopControlProtocol
	}
	return nil
}
func desktopControlRead(conn net.Conn, value any) error {
	raw, err := io.ReadAll(io.LimitReader(conn, desktopControlLimit+1))
	if err != nil || len(raw) == 0 || raw[len(raw)-1] != '\n' || len(raw) > desktopControlLimit || desktopStrictJSON(raw, value) != nil {
		return errDesktopControlProtocol
	}
	return nil
}
func (c *desktopLocalControl) serve(d *nativeDesktop) {
	for {
		conn, err := c.listener.AcceptUnix()
		if err != nil {
			return
		}
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
		select {
		case c.slots <- struct{}{}:
			c.workers.Add(1)
			go func() { defer c.workers.Done(); defer func() { <-c.slots }(); defer conn.Close(); c.handle(d, conn) }()
		default:
			_ = json.NewEncoder(conn).Encode(desktopControlReply{Version: 1, InstanceID: c.meta.InstanceID, Port: c.meta.Port, Error: "LOCAL_CONTROL_BUSY"})
			_ = conn.Close()
		}
	}
}
func (c *desktopLocalControl) handle(d *nativeDesktop, conn *net.UnixConn) {
	if !desktopPeerUID(conn, uint32(os.Geteuid())) {
		return
	}
	var request desktopControlRequest
	if desktopControlRead(conn, &request) != nil || request.Version != 1 || request.InstanceID != c.meta.InstanceID || request.Port != c.meta.Port || request.Action != "open" && request.Action != "logout" {
		return
	}
	reply := desktopControlReply{Version: 1, InstanceID: c.meta.InstanceID, Port: c.meta.Port}
	if request.Action == "open" {
		reply.LaunchURL, _ = d.issueTicket()
		if reply.LaunchURL == "" {
			reply.Error = "LOCAL_SESSION_UNAVAILABLE"
		}
	} else {
		result := d.logoutIdentity()
		reply.LocalCleared = result.LocalCleared
		reply.RemoteRevocationConfirmed = result.RemoteRevocationConfirmed
		reply.CredentialCleared = result.CredentialCleared
		reply.Error = result.Error
	}
	_ = json.NewEncoder(conn).Encode(reply)
}
func requestDesktopControl(ctx context.Context, port int, action string) (desktopControlReply, error) {
	var reply desktopControlReply
	dir, err := openDesktopControlDirectory(false)
	if err != nil {
		return reply, err
	}
	defer unix.Close(dir)
	meta, _, err := desktopReadMeta(dir, port)
	if err != nil {
		return reply, err
	}
	name := desktopControlName(port, ".sock")
	st, err := desktopControlStat(dir, name, unix.S_IFSOCK)
	if err != nil {
		return reply, err
	}
	if uint64(st.Dev) != meta.SocketDevice || st.Ino != meta.SocketInode {
		return reply, errDesktopControlSecurity
	}
	dialer := net.Dialer{Timeout: 10 * time.Second}
	connection, err := dialer.DialContext(ctx, "unix", desktopControlPath(dir, name))
	if err != nil {
		if errors.Is(err, unix.ECONNREFUSED) || errors.Is(err, unix.ENOENT) {
			return reply, errDesktopControlMissing
		}
		return reply, errDesktopControlProtocol
	}
	conn := connection.(*net.UnixConn)
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	after, err := desktopControlStat(dir, name, unix.S_IFSOCK)
	if err != nil || !desktopSameInode(st, after) || !desktopPeerUID(conn, uint32(os.Geteuid())) {
		return reply, errDesktopControlSecurity
	}
	request := desktopControlRequest{Version: 1, InstanceID: meta.InstanceID, Port: port, Action: action}
	if json.NewEncoder(conn).Encode(request) != nil || conn.CloseWrite() != nil || desktopControlRead(conn, &reply) != nil || reply.Version != 1 || reply.InstanceID != meta.InstanceID || reply.Port != port {
		return reply, errDesktopControlProtocol
	}
	if reply.LaunchURL != "" && !validDesktopLaunchURL(reply.LaunchURL, port) {
		return desktopControlReply{}, errDesktopControlProtocol
	}
	return reply, nil
}
func validDesktopLaunchURL(address string, port int) bool {
	prefix := fmt.Sprintf("http://desktop.localhost:%d/#ticket=", port)
	if len(address) != len(prefix)+43 || !bytes.HasPrefix([]byte(address), []byte(prefix)) {
		return false
	}
	for _, ch := range address[len(prefix):] {
		if !(ch >= 'A' && ch <= 'Z' || ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9' || ch == '-' || ch == '_') {
			return false
		}
	}
	return true
}
func runDesktopControl(args []string, stdout, stderr io.Writer) int {
	options, err := parseDesktopControlOptions(args)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	reply, err := requestDesktopControl(ctx, options.port, args[0])
	if ctx.Err() != nil {
		return 130
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		if errors.Is(err, errDesktopControlMissing) {
			return 4
		}
		if errors.Is(err, errDesktopControlSecurity) {
			return 3
		}
		return 5
	}
	if args[0] == "open" {
		if reply.Error != "" || reply.LaunchURL == "" {
			fmt.Fprintln(stderr, "Desktop could not issue browser access; check the running instance")
			return 5
		}
		fmt.Fprintf(stdout, "Piwork Desktop: %s\n", reply.LaunchURL)
		if options.open {
			openDesktopBrowserContext(ctx, reply.LaunchURL, stderr)
		}
		if ctx.Err() != nil {
			return 130
		}
		return 0
	}
	if reply.Error != "" || !reply.CredentialCleared || !reply.RemoteRevocationConfirmed {
		fmt.Fprintf(stderr, "Desktop local identity cleared: %t; saved credential cleared: %t; remote revocation confirmed: %t. Retry piwork-cli desktop logout --port %d.\n", reply.LocalCleared, reply.CredentialCleared, reply.RemoteRevocationConfirmed, options.port)
		return 5
	}
	fmt.Fprintln(stdout, "Desktop platform login cleared; browser access and Work execution retained.")
	return 0
}
