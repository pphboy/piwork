package cli

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/Microsoft/go-winio"
	"golang.org/x/sys/windows"
	"piwork/internal/clientfs"
)

type desktopControlMeta struct {
	Version        int    `json:"version"`
	InstanceID     string `json:"instanceId"`
	Port           int    `json:"port"`
	PipeName       string `json:"pipeName"`
	ServerPID      uint32 `json:"serverPid"`
	ServerCreation uint64 `json:"serverCreation"`
}

type desktopLocalControl struct {
	dir       *clientfs.Directory
	lock      *clientfs.Lock
	listener  net.Listener
	meta      desktopControlMeta
	metaID    clientfs.FileIdentity
	sid       *windows.SID
	slots     chan struct{}
	closeOnce sync.Once
	workers   sync.WaitGroup
	mu        sync.Mutex
	closed    bool
	conns     map[net.Conn]bool
}

func desktopCurrentSID() (*windows.SID, error) {
	token, err := windows.OpenCurrentProcessToken()
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	return user.User.Sid.Copy()
}

func openDesktopControlDirectory(create bool) (*clientfs.Directory, error) {
	base, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, windows.KF_FLAG_DEFAULT)
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	d, err := clientfs.OpenPrivateDirectory(filepath.Join(base, "piwork", "desktop-control"), create)
	if errors.Is(err, os.ErrNotExist) {
		return nil, errDesktopControlMissing
	}
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	return d, nil
}

func desktopControlName(port int, suffix string) string { return strconv.Itoa(port) + suffix }

func desktopPipeName(sid *windows.SID, port int, instance string) string {
	hash := sha256.Sum256([]byte(sid.String()))
	return `\\.\pipe\piwork-desktop-` + hex.EncodeToString(hash[:]) + "-" + strconv.Itoa(port) + "-" + instance
}

func desktopProcessIdentity(pid uint32, sid *windows.SID) (uint64, error) {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION|windows.SYNCHRONIZE, false, pid)
	if errors.Is(err, windows.ERROR_INVALID_PARAMETER) {
		return 0, errDesktopControlMissing
	}
	if err != nil {
		return 0, errDesktopControlSecurity
	}
	defer windows.CloseHandle(h)
	state, err := windows.WaitForSingleObject(h, 0)
	if err != nil {
		return 0, errDesktopControlSecurity
	}
	if state == windows.WAIT_OBJECT_0 {
		return 0, errDesktopControlMissing
	}
	if state != uint32(windows.WAIT_TIMEOUT) {
		return 0, errDesktopControlSecurity
	}
	var token windows.Token
	if windows.OpenProcessToken(h, windows.TOKEN_QUERY, &token) != nil {
		return 0, errDesktopControlSecurity
	}
	defer token.Close()
	user, err := token.GetTokenUser()
	if err != nil || !user.User.Sid.Equals(sid) {
		return 0, errDesktopControlSecurity
	}
	var created, exited, kernel, userTime windows.Filetime
	if windows.GetProcessTimes(h, &created, &exited, &kernel, &userTime) != nil {
		return 0, errDesktopControlSecurity
	}
	return uint64(created.HighDateTime)<<32 | uint64(created.LowDateTime), nil
}

func desktopReadMeta(dir *clientfs.Directory, port int, sid *windows.SID) (desktopControlMeta, clientfs.FileIdentity, error) {
	var meta desktopControlMeta
	var id clientfs.FileIdentity
	name := desktopControlName(port, ".json")
	f, err := dir.OpenRegular(name)
	if errors.Is(err, os.ErrNotExist) {
		return meta, id, errDesktopControlMissing
	}
	if err != nil {
		return meta, id, errDesktopControlSecurity
	}
	defer f.Close()
	id, err = clientfs.Identity(f)
	if err != nil || id.Size > desktopControlLimit {
		return meta, id, errDesktopControlSecurity
	}
	raw, err := io.ReadAll(io.LimitReader(f, desktopControlLimit+1))
	after, identityErr := clientfs.Identity(f)
	if err != nil || identityErr != nil || after != id || dir.Check() != nil {
		return meta, id, errDesktopControlSecurity
	}
	if len(raw) > desktopControlLimit || desktopStrictJSON(raw, &meta) != nil || meta.Version != 1 || meta.Port != port || meta.ServerPID == 0 || meta.ServerCreation == 0 {
		return meta, id, errDesktopControlProtocol
	}
	nonce, err := base64.RawURLEncoding.DecodeString(meta.InstanceID)
	if err != nil || len(nonce) != 32 || meta.PipeName != desktopPipeName(sid, port, meta.InstanceID) {
		return meta, id, errDesktopControlSecurity
	}
	return meta, id, nil
}

func startDesktopControl(d *nativeDesktop) (*desktopLocalControl, error) {
	sid, err := desktopCurrentSID()
	if err != nil {
		return nil, err
	}
	dir, err := openDesktopControlDirectory(true)
	if err != nil {
		return nil, err
	}
	c := &desktopLocalControl{dir: dir, sid: sid, meta: desktopControlMeta{Port: d.port}, slots: make(chan struct{}, 16), conns: map[net.Conn]bool{}}
	success := false
	defer func() {
		if !success {
			c.close()
		}
	}()
	c.lock, err = dir.TryLock(desktopControlName(d.port, ".lock"))
	if errors.Is(err, clientfs.ErrBusy) {
		return nil, errDesktopControlProtocol
	}
	if err != nil {
		return nil, errDesktopControlSecurity
	}
	old, _, err := desktopReadMeta(dir, d.port, sid)
	if err == nil {
		created, identityErr := desktopProcessIdentity(old.ServerPID, sid)
		if identityErr == nil && created == old.ServerCreation {
			return nil, errDesktopControlProtocol
		}
		if identityErr != nil && !errors.Is(identityErr, errDesktopControlMissing) {
			return nil, identityErr
		}
		if err := dir.Remove(desktopControlName(d.port, ".json")); err != nil {
			return nil, errDesktopControlSecurity
		}
	} else if !errors.Is(err, errDesktopControlMissing) {
		return nil, err
	}
	instance, err := desktopSecret()
	if err != nil {
		return nil, errDesktopControlProtocol
	}
	created, err := desktopProcessIdentity(uint32(os.Getpid()), sid)
	if err != nil {
		return nil, err
	}
	c.meta = desktopControlMeta{Version: 1, InstanceID: instance, Port: d.port, PipeName: desktopPipeName(sid, d.port, instance), ServerPID: uint32(os.Getpid()), ServerCreation: created}
	// go-winio v0.6.2 uses FILE_CREATE for its first instance and sets
	// FILE_PIPE_REJECT_REMOTE_CLIENTS for every instance, including byte mode.
	c.listener, err = winio.ListenPipe(c.meta.PipeName, &winio.PipeConfig{SecurityDescriptor: "O:" + sid.String() + "D:P(A;;FA;;;" + sid.String() + ")(A;;FA;;;SY)", InputBufferSize: desktopControlLimit + 4, OutputBufferSize: desktopControlLimit + 4})
	if err != nil {
		return nil, errDesktopControlProtocol
	}
	raw, err := json.Marshal(c.meta)
	if err != nil || dir.AtomicWrite(context.Background(), desktopControlName(d.port, ".json"), append(raw, '\n')) != nil {
		return nil, errDesktopControlProtocol
	}
	_, c.metaID, err = desktopReadMeta(dir, d.port, sid)
	if err != nil {
		return nil, err
	}
	success = true
	go c.serve(d)
	return c, nil
}

func (c *desktopLocalControl) close() {
	c.closeOnce.Do(func() {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		if c.listener != nil {
			c.listener.Close()
		}
		c.mu.Lock()
		for conn := range c.conns {
			conn.Close()
		}
		c.mu.Unlock()
		c.workers.Wait()
		if c.metaID != (clientfs.FileIdentity{}) {
			meta, id, err := desktopReadMeta(c.dir, c.meta.Port, c.sid)
			if err == nil && id == c.metaID && meta.InstanceID == c.meta.InstanceID {
				_ = c.dir.Remove(desktopControlName(c.meta.Port, ".json"))
			}
		}
		c.lock.Close()
		c.dir.Close()
	})
}

func desktopPipePeer(conn net.Conn, sid *windows.SID, server bool, pid uint32, creation uint64) bool {
	file, ok := conn.(interface{ Fd() uintptr })
	if !ok {
		return false
	}
	var actual uint32
	var err error
	if server {
		err = windows.GetNamedPipeServerProcessId(windows.Handle(file.Fd()), &actual)
	} else {
		err = windows.GetNamedPipeClientProcessId(windows.Handle(file.Fd()), &actual)
	}
	if err != nil || actual == 0 || server && actual != pid {
		return false
	}
	created, err := desktopProcessIdentity(actual, sid)
	return err == nil && (!server || created == creation)
}

func desktopControlFrameRead(r io.Reader, value any) error {
	var prefix [4]byte
	if _, err := io.ReadFull(r, prefix[:]); err != nil {
		return errDesktopControlProtocol
	}
	n := binary.BigEndian.Uint32(prefix[:])
	if n == 0 || n > desktopControlLimit {
		return errDesktopControlProtocol
	}
	raw := make([]byte, int(n))
	if _, err := io.ReadFull(r, raw); err != nil || raw[len(raw)-1] != '\n' || desktopStrictJSON(raw, value) != nil {
		return errDesktopControlProtocol
	}
	return nil
}

func desktopControlFrameWrite(w io.Writer, value any) error {
	raw, err := json.Marshal(value)
	if err != nil || len(raw)+1 > desktopControlLimit {
		return errDesktopControlProtocol
	}
	raw = append(raw, '\n')
	var prefix [4]byte
	binary.BigEndian.PutUint32(prefix[:], uint32(len(raw)))
	for _, part := range [][]byte{prefix[:], raw} {
		if n, err := w.Write(part); err != nil || n != len(part) {
			return errDesktopControlProtocol
		}
	}
	return nil
}

func desktopControlReplyAndACK(conn net.Conn, reply desktopControlReply) {
	if desktopControlFrameWrite(conn, reply) != nil {
		return
	}
	var ack [1]byte
	_, _ = io.ReadFull(conn, ack[:])
}

func (c *desktopLocalControl) serve(d *nativeDesktop) {
	for {
		conn, err := c.listener.Accept()
		if err != nil {
			return
		}
		conn.SetDeadline(time.Now().Add(10 * time.Second))
		if !desktopPipePeer(conn, c.sid, false, 0, 0) {
			conn.Close()
			continue
		}
		c.mu.Lock()
		if c.closed {
			c.mu.Unlock()
			conn.Close()
			return
		}
		c.conns[conn] = true
		select {
		case c.slots <- struct{}{}:
			c.workers.Add(1)
			c.mu.Unlock()
			go func() {
				defer c.workers.Done()
				defer func() { conn.Close(); c.mu.Lock(); delete(c.conns, conn); c.mu.Unlock(); <-c.slots }()
				var request desktopControlRequest
				if desktopControlFrameRead(conn, &request) != nil || request.Version != 1 || request.InstanceID != c.meta.InstanceID || request.Port != c.meta.Port || request.Action != "open" && request.Action != "logout" {
					return
				}
				desktopControlReplyAndACK(conn, executeDesktopControl(d, c.meta.InstanceID, c.meta.Port, request.Action))
			}()
		default:
			c.mu.Unlock()
			// A bounded busy reply has no action and occupies no worker slot.
			desktopControlReplyAndACK(conn, desktopControlReply{Version: 1, InstanceID: c.meta.InstanceID, Port: c.meta.Port, Error: "LOCAL_CONTROL_BUSY"})
			conn.Close()
			c.mu.Lock()
			delete(c.conns, conn)
			c.mu.Unlock()
		}
	}
}

func requestDesktopControl(ctx context.Context, port int, action string) (desktopControlReply, error) {
	var reply desktopControlReply
	sid, err := desktopCurrentSID()
	if err != nil {
		return reply, err
	}
	dir, err := openDesktopControlDirectory(false)
	if err != nil {
		return reply, err
	}
	defer dir.Close()
	meta, id, err := desktopReadMeta(dir, port, sid)
	if err != nil {
		return reply, err
	}
	created, err := desktopProcessIdentity(meta.ServerPID, sid)
	if err != nil {
		return reply, err
	}
	if created != meta.ServerCreation {
		return reply, errDesktopControlMissing
	}
	dialCtx, stop := context.WithTimeout(ctx, 10*time.Second)
	defer stop()
	conn, err := winio.DialPipeContext(dialCtx, meta.PipeName)
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) || errors.Is(err, windows.ERROR_PIPE_NOT_CONNECTED) {
		return reply, errDesktopControlMissing
	}
	if errors.Is(err, windows.ERROR_ACCESS_DENIED) {
		return reply, errDesktopControlSecurity
	}
	if err != nil {
		return reply, errDesktopControlProtocol
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(10 * time.Second))
	cancel := context.AfterFunc(ctx, func() { conn.Close() })
	defer cancel()
	current, after, err := desktopReadMeta(dir, port, sid)
	if err != nil || after != id || current != meta || !desktopPipePeer(conn, sid, true, meta.ServerPID, meta.ServerCreation) {
		return reply, errDesktopControlSecurity
	}
	request := desktopControlRequest{Version: 1, InstanceID: meta.InstanceID, Port: port, Action: action}
	if desktopControlFrameWrite(conn, request) != nil || desktopControlFrameRead(conn, &reply) != nil || reply.Version != 1 || reply.InstanceID != meta.InstanceID || reply.Port != port {
		return reply, errDesktopControlProtocol
	}
	if reply.LaunchURL != "" && !validDesktopLaunchURL(reply.LaunchURL, port) {
		return desktopControlReply{}, errDesktopControlProtocol
	}
	if _, err := conn.Write([]byte{1}); err != nil {
		return reply, errDesktopControlProtocol
	}
	return reply, nil
}
