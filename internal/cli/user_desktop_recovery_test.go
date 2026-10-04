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
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/client"
)

func recoveryDesktop(t *testing.T) *nativeDesktop {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()
	api, _ := client.New("http://127.0.0.1:1", "")
	return &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credential", "client.json")}, port: port, origin: fmt.Sprintf("http://desktop.localhost:%d", port), sessions: map[string]desktopSession{}, identity: desktopIdentity{coreURL: "http://127.0.0.1:1"}}
}
func recoveryHTTP(d *nativeDesktop, method, path, body, cookie, csrf string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, d.origin+path, strings.NewReader(body))
	req.Header.Set("Origin", d.origin)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", cookie)
	req.Header.Set("X-Piwork-Csrf", csrf)
	response := httptest.NewRecorder()
	d.ServeHTTP(response, req)
	return response
}
func recoveryBootstrap(d *nativeDesktop, ticket string) *httptest.ResponseRecorder {
	return recoveryHTTP(d, "POST", "/_desktop/api/bootstrap", `{"ticket":"`+ticket+`"}`, "", "")
}
func recoveryTicket(address string) string { return strings.Split(address, "#ticket=")[1] }
func TestDesktopRecoveryCLIValidationPrecedesCredentialIO(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", "/definitely/not/a/credential.json")
	t.Setenv("PIWORK_CORE_URL", ":bad")
	for _, args := range [][]string{
		{"desktop", "open", "--port", "0"}, {"desktop", "open", "--port", "65536"}, {"desktop", "open", "--port", "-1"},
		{"desktop", "open", "--port", "42", "--port", "43"}, {"desktop", "open", "--no-open", "--no-open"},
		{"desktop", "logout", "--no-open"}, {"--core", "http://localhost:1", "desktop", "open"}, {"--json", "desktop", "logout"},
		{"desktop", "open", "extra"}, {"desktop", "logout", "--wat"},
	} {
		var out, err bytes.Buffer
		if code := runUser(args, &out, &err); code != 2 || out.Len() != 0 {
			t.Fatalf("syntax %v: %d", args, code)
		}
	}
	for _, args := range [][]string{{"desktop", "open", "--help"}, {"desktop", "logout", "--help"}} {
		var out, err bytes.Buffer
		if code := runUser(args, &out, &err); code != 0 || !strings.Contains(out.String(), "desktop open") {
			t.Fatal("help did I/O", code, err.String())
		}
	}
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	var out, stderr bytes.Buffer
	if code := runUser([]string{"desktop", "open", "--port", fmt.Sprint(d.port), "--no-open"}, &out, &stderr); code != 0 {
		t.Fatal(code, stderr.String())
	}
	if !validDesktopLaunchURL(strings.TrimSpace(strings.TrimPrefix(out.String(), "Piwork Desktop: ")), d.port) {
		t.Fatal("bad launch output")
	}
	c.close()
	out.Reset()
	stderr.Reset()
	if code := runUser([]string{"desktop", "open", "--port", fmt.Sprint(d.port), "--no-open"}, &out, &stderr); code != 4 || out.Len() != 0 {
		t.Fatal("missing instance", code, stderr.String())
	}
}
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
func TestDesktopTicketAtomicRenewalCapacityAndRandomFailure(t *testing.T) {
	d := recoveryDesktop(t)
	first, err := d.issueTicket()
	if err != nil {
		t.Fatal(err)
	}
	response := recoveryBootstrap(d, recoveryTicket(first))
	if response.Code != 200 {
		t.Fatal(response.Code)
	}
	cookie := strings.Split(response.Header().Get("Set-Cookie"), ";")[0]
	second, _ := d.issueTicket()
	third, _ := d.issueTicket()
	if recoveryBootstrap(d, recoveryTicket(second)).Code != 403 {
		t.Fatal("prior ticket valid")
	}
	if recoveryHTTP(d, "GET", "/_desktop/api/session", "", cookie, "").Code != 200 {
		t.Fatal("renewal revoked local session")
	}
	var successes atomic.Int32
	var wait sync.WaitGroup
	for i := 0; i < 12; i++ {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if recoveryBootstrap(d, recoveryTicket(third)).Code == 200 {
				successes.Add(1)
			}
		}()
	}
	wait.Wait()
	if successes.Load() != 1 {
		t.Fatal("concurrent ticket", successes.Load())
	}
	fourth, _ := d.issueTicket()
	d.secret = func() (string, error) { return "", errors.New("random unavailable") }
	if recoveryBootstrap(d, recoveryTicket(fourth)).Code != 503 || d.used {
		t.Fatal("random failure consumed ticket")
	}
	d.secret = nil
	for len(d.sessions) < 128 {
		id := fmt.Sprint(len(d.sessions))
		d.sessions[id] = desktopSession{end: time.Now().Add(time.Hour)}
	}
	if r := recoveryBootstrap(d, recoveryTicket(fourth)); r.Code != 503 || !strings.Contains(r.Body.String(), "LOCAL_SESSION_CAPACITY") || d.used {
		t.Fatal("capacity consumed or evicted", r.Code)
	}
	d.sessions["expired"] = desktopSession{end: time.Now().Add(-time.Second)}
	delete(d.sessions, "127")
	if recoveryBootstrap(d, recoveryTicket(fourth)).Code != 200 {
		t.Fatal("expired capacity not recovered")
	}
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
func TestDesktopBrowserResetKeepsCoreAndCancelsContent(t *testing.T) {
	d := recoveryDesktop(t)
	credential := client.Credential{Version: 1, CoreURL: d.identity.coreURL, Token: "core-secret", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	d.identity.credential = &credential
	d.identity.checked = true
	if err := d.store.Save(credential); err != nil {
		t.Fatal(err)
	}
	url, _ := d.issueTicket()
	bootstrap := recoveryBootstrap(d, recoveryTicket(url))
	cookie := strings.Split(bootstrap.Header().Get("Set-Cookie"), ";")[0]
	var jsonValue map[string]any
	_ = json.Unmarshal(bootstrap.Body.Bytes(), &jsonValue)
	csrf := jsonValue["csrf"].(string)
	req := httptest.NewRequest("GET", d.origin+"/_desktop/files/works/w/files/a", nil)
	req.Header.Set("Cookie", cookie)
	ss, ok := d.authorize(req, false)
	if !ok {
		t.Fatal("authorization")
	}
	guarded, content, finish, ok := d.guardContent(httptest.NewRecorder(), req, ss)
	if !ok {
		t.Fatal("guard")
	}
	defer finish()
	for _, csrfValue := range []string{"", "wrong"} {
		if recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", cookie, csrfValue).Code != 403 {
			t.Fatal("reset bypassed csrf")
		}
	}
	if recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", "", csrf).Code != 403 {
		t.Fatal("anonymous reset")
	}
	pending, _ := d.issueTicket()
	response := recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", cookie, csrf)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"coreSessionRetained":true`) {
		t.Fatal("reset failed", response.Code)
	}
	select {
	case <-content.Context().Done():
	case <-time.After(2 * time.Second):
		t.Fatal("content not cancelled")
	}
	if _, err := guarded.Write([]byte("old sensitive content")); err == nil {
		t.Fatal("late content published")
	}
	if recoveryHTTP(d, "GET", "/_desktop/api/session", "", cookie, "").Code != 401 || recoveryBootstrap(d, recoveryTicket(pending)).Code != 403 {
		t.Fatal("old authorization retained")
	}
	if d.identity.credential != &credential {
		t.Fatal("reset logged Core out")
	}
	saved, err := d.store.Load()
	if err != nil || saved.Token != credential.Token {
		t.Fatal("reset deleted Core credential")
	}
	fresh, _ := d.issueTicket()
	if recoveryBootstrap(d, recoveryTicket(fresh)).Code != 200 {
		t.Fatal("cannot reauthorize")
	}
}

// A separate process exercises the same OS peer credentials and public CLI entry.
func TestDesktopControlHelperProcess(t *testing.T) {
	if os.Getenv("PIWORK_DESKTOP_CONTROL_TEST_HELPER") == "1" {
		args := strings.Split(os.Getenv("PIWORK_DESKTOP_CONTROL_TEST_ARGS"), " ")
		os.Exit(runUser(args, os.Stdout, os.Stderr))
	}
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	command := exec.Command(os.Args[0], "-test.run=^TestDesktopControlHelperProcess$")
	command.Dir = t.TempDir()
	command.Env = append(os.Environ(), "PIWORK_DESKTOP_CONTROL_TEST_HELPER=1", "PIWORK_DESKTOP_CONTROL_TEST_ARGS=desktop open --port "+fmt.Sprint(d.port)+" --no-open", "PIWORK_CONFIG_PATH=/bad/credential", "PIWORK_CORE_URL=invalid")
	output, err := command.CombinedOutput()
	if err != nil || !strings.HasPrefix(string(output), "Piwork Desktop: ") {
		t.Fatal("same-UID helper", err, string(output))
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

func TestDesktopHelperBrowserFallbackAndInterruptPreserveInstance(t *testing.T) {
	d := recoveryDesktop(t)
	c, err := startDesktopControl(d)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	command := exec.Command(os.Args[0], "-test.run=^TestDesktopControlHelperProcess$")
	command.Env = append(os.Environ(), "PIWORK_DESKTOP_CONTROL_TEST_HELPER=1", "PIWORK_DESKTOP_CONTROL_TEST_ARGS=desktop open --port "+fmt.Sprint(d.port), "PATH=/nonexistent")
	output, err := command.CombinedOutput()
	if err != nil || !bytes.Contains(output, []byte("manually")) || !bytes.Contains(output, []byte("Piwork Desktop:")) {
		t.Fatal("browser fallback", err, string(output))
	}
	originalCore := d.identity.coreURL
	d.mu.Lock()
	waiting := exec.Command(os.Args[0], "-test.run=^TestDesktopControlHelperProcess$")
	waiting.Env = append(os.Environ(), "PIWORK_DESKTOP_CONTROL_TEST_HELPER=1", "PIWORK_DESKTOP_CONTROL_TEST_ARGS=desktop open --port "+fmt.Sprint(d.port)+" --no-open")
	if err := waiting.Start(); err != nil {
		d.mu.Unlock()
		t.Fatal(err)
	}
	deadline := time.Now().Add(time.Second)
	for len(c.slots) == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	_ = waiting.Process.Signal(os.Interrupt)
	err = waiting.Wait()
	d.mu.Unlock()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.ExitCode() != 130 {
		t.Fatal("helper interrupt", err)
	}
	if _, err := requestDesktopControl(context.Background(), d.port, "open"); err != nil || d.identity.coreURL != originalCore {
		t.Fatal("interrupt stopped or changed instance", err)
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

func TestDesktopExpiredContentCancelsAndRemovesRegistration(t *testing.T) {
	d := recoveryDesktop(t)
	d.sessions["session"] = desktopSession{end: time.Now().Add(50 * time.Millisecond), csrf: "csrf"}
	req := httptest.NewRequest("GET", d.origin+"/_desktop/api/works", nil)
	req.Header.Set("Cookie", d.cookieName()+"=session")
	ss, ok := d.authorize(req, false)
	if !ok {
		t.Fatal("authorize")
	}
	_, content, finish, ok := d.guardContent(httptest.NewRecorder(), req, ss)
	if !ok {
		t.Fatal("guard")
	}
	select {
	case <-content.Context().Done():
	case <-time.After(2 * time.Second):
		t.Fatal("expired stream survived")
	}
	finish()
	d.mu.Lock()
	count := len(d.activeAccess)
	d.mu.Unlock()
	if count != 0 {
		t.Fatal("registration leaked")
	}
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
func TestDesktopResetOriginAndTemporaryResourceBoundary(t *testing.T) {
	d := recoveryDesktop(t)
	url, _ := d.issueTicket()
	bootstrap := recoveryBootstrap(d, recoveryTicket(url))
	cookie := strings.Split(bootstrap.Header().Get("Set-Cookie"), ";")[0]
	var value map[string]any
	_ = json.Unmarshal(bootstrap.Body.Bytes(), &value)
	csrf := value["csrf"].(string)
	for _, host := range []string{fmt.Sprintf("service.desktop.localhost:%d", d.port), fmt.Sprintf("localhost:%d", d.port)} {
		req := httptest.NewRequest("POST", d.origin+"/_desktop/api/browser-access/reset", strings.NewReader("{}"))
		req.Host = host
		req.Header.Set("Cookie", cookie)
		req.Header.Set("X-Piwork-Csrf", csrf)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Origin", d.origin)
		response := httptest.NewRecorder()
		d.ServeHTTP(response, req)
		if response.Code != 403 {
			t.Fatal("non-shell Host reset accepted", response.Code)
		}
	}
	req := httptest.NewRequest("POST", d.origin+"/_desktop/api/browser-access/reset", strings.NewReader("{}"))
	req.Header.Set("Cookie", cookie)
	req.Header.Set("X-Piwork-Csrf", csrf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://evil.test")
	response := httptest.NewRecorder()
	d.ServeHTTP(response, req)
	if response.Code != 403 {
		t.Fatal("cross-site reset")
	}
	transfers, err := d.transferStore()
	if err != nil {
		t.Fatal(err)
	}
	temporary := filepath.Join(transfers.directory, "pending")
	if err := os.WriteFile(temporary, []byte("private temporary content"), 0600); err != nil {
		t.Fatal(err)
	}
	d.serviceEntries = map[string]*desktopServiceEntry{"old": {}}
	response = recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", cookie, csrf)
	if response.Code != 200 || d.transfers != nil || len(d.serviceEntries) != 0 {
		t.Fatal("reset retained temporary resources")
	}
	if _, err := os.Stat(temporary); !os.IsNotExist(err) {
		t.Fatal("temporary file retained")
	}
	if fresh, err := d.transferStore(); err != nil || fresh == transfers {
		t.Fatal("new transfer store unavailable after reset")
	} else {
		fresh.clear()
	}
}

func TestDesktopResetClosesActualWebDAVAndRunStreams(t *testing.T) {
	for _, route := range []string{"file", "run"} {
		t.Run(route, func(t *testing.T) {
			stopped := make(chan struct{})
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.URL.Path == "/api/v1/me":
					_, _ = io.WriteString(w, `{"id":"owner","account":"owner","role":"user"}`)
				case r.URL.Path == "/api/v1/file-access":
					_ = json.NewEncoder(w).Encode(proxyFileCapability{Version: 1, Protocol: "webdav", Profile: "workspace-transfer-v1", RootTemplate: "/api/v1/works/{workId}/files/", Limits: proxyFileExpectedLimits, Available: true})
				case r.URL.Path == "/api/v1/works/work-1/runs/run-1":
					_, _ = io.WriteString(w, `{"runId":"run-1"}`)
				default:
					if route == "run" {
						w.Header().Set("Content-Type", "application/x-ndjson")
						_, _ = io.WriteString(w, "{\"sequence\":1}\n")
					} else {
						_, _ = io.WriteString(w, strings.Repeat("a", 8192))
					}
					w.(http.Flusher).Flush()
					<-r.Context().Done()
					close(stopped)
				}
			}))
			defer core.Close()
			d := recoveryDesktop(t)
			d.identity.coreURL = core.URL
			d.identity.credential = &client.Credential{Version: 1, CoreURL: core.URL, Token: "stream-secret", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
			d.identity.checked = true
			d.sessions["local"] = desktopSession{csrf: "csrf", end: time.Now().Add(time.Hour)}
			local := httptest.NewServer(d)
			defer local.Close()
			path := "/_desktop/files/works/work-12345678-1234-1234-1234-123456789012/files/stream"
			if route == "run" {
				path = "/_desktop/api/works/work-1/runs/run-1/events?after=0"
			}
			request, _ := http.NewRequest("GET", local.URL+path, nil)
			request.Host = fmt.Sprintf("desktop.localhost:%d", d.port)
			request.Header.Set("Cookie", d.cookieName()+"=local")
			response, err := http.DefaultClient.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			if response.StatusCode != 200 {
				body, _ := io.ReadAll(response.Body)
				t.Fatal("stream rejected", response.StatusCode, string(body))
			}
			initial := make([]byte, 1)
			if _, err := response.Body.Read(initial); err != nil {
				t.Fatal("stream not started", err)
			}
			reset := recoveryHTTP(d, "POST", "/_desktop/api/browser-access/reset", "{}", d.cookieName()+"=local", "csrf")
			if reset.Code != 200 {
				t.Fatal(reset.Code)
			}
			select {
			case <-stopped:
			case <-time.After(2 * time.Second):
				t.Fatal("actual upstream stream still open")
			}
			finished := make(chan struct{})
			go func() { _, _ = io.Copy(io.Discard, response.Body); close(finished) }()
			select {
			case <-finished:
			case <-time.After(2 * time.Second):
				t.Fatal("browser body still open")
			}
		})
	}
}
func TestDesktopLogoutAlreadyInvalidAndLateResponseStayCaptured(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{})
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-gate
		w.WriteHeader(401)
		_, _ = io.WriteString(w, `{"code":"AUTHENTICATION_FAILED","message":"Session ended"}`)
	}))
	defer core.Close()
	d := recoveryDesktop(t)
	old := client.Credential{Version: 1, CoreURL: core.URL, Token: "old", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "old", Account: "old", Role: "user"}}
	d.identity.coreURL = core.URL
	d.identity.credential = &old
	if err := d.store.Save(old); err != nil {
		t.Fatal(err)
	}
	result := make(chan desktopLogoutResult, 1)
	go func() { result <- d.logoutIdentity() }()
	<-started
	newer := old
	newer.Token = "new"
	newer.User.ID = "new"
	if err := d.store.Save(newer); err != nil {
		t.Fatal(err)
	}
	// Emulate a later identity callback without replacing the captured cleanup.
	d.mu.Lock()
	d.identity.generation++
	d.identity.credential = &newer
	generation := d.identity.generation
	d.mu.Unlock()
	close(gate)
	outcome := <-result
	if !outcome.RemoteRevocationConfirmed || !outcome.CredentialCleared {
		t.Fatal("already invalid not confirmed", outcome)
	}
	d.mu.Lock()
	unchanged := d.identity.credential == &newer && d.identity.generation == generation
	d.mu.Unlock()
	if !unchanged || outcome.View["generation"] == generation {
		t.Fatal("late logout mutated/reported new identity")
	}
	saved, err := d.store.Load()
	if err != nil || saved.Token != newer.Token {
		t.Fatal("late logout deleted newer credential")
	}
}

func TestDesktopConcurrentLogoutSharesBoundedCleanup(t *testing.T) {
	gate := make(chan struct{})
	started := make(chan struct{})
	var calls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-gate
		w.WriteHeader(204)
	}))
	defer core.Close()
	d := recoveryDesktop(t)
	d.identity.coreURL = core.URL
	d.identity.credential = &client.Credential{Version: 1, CoreURL: core.URL, Token: "shared", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}
	first := make(chan desktopLogoutResult, 1)
	second := make(chan desktopLogoutResult, 1)
	go func() { first <- d.logoutIdentity() }()
	<-started
	go func() { second <- d.logoutIdentity() }()
	time.Sleep(10 * time.Millisecond)
	close(gate)
	one, two := <-first, <-second
	if calls.Load() != 1 || !one.RemoteRevocationConfirmed || !two.RemoteRevocationConfirmed {
		t.Fatal("concurrent cleanup duplicated", calls.Load())
	}
	one.View["csrf"] = "one"
	if two.View["csrf"] != nil {
		t.Fatal("shared mutable response view")
	}
}
