package cli

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"piwork/internal/client"
)

func TestContainerModeRequiresAnExplicitLiteralAndKeepsHelpFreeOfIO(t *testing.T) {
	for _, item := range []struct {
		value   string
		want    bool
		invalid bool
	}{{"1", true, false}, {"0", false, false}, {"", false, false}, {"true", false, true}, {"01", false, true}, {" 1", false, true}, {"private-value", false, true}} {
		t.Setenv("PIWORK_CLI_CONTAINER_MODE", item.value)
		mode, err := cliContainerMode()
		if mode != item.want || (err != nil) != item.invalid {
			t.Fatal(item, mode, err)
		}
		if err != nil && strings.Contains(err.Error(), "private-value") {
			t.Fatal("mode diagnostic reflected input")
		}
	}
	t.Setenv("PIWORK_CLI_CONTAINER_MODE", "invalid")
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "unreadable", "credential"))
	for _, args := range [][]string{{"--help"}, {"--version"}, {"desktop", "--help"}, {"desktop", "open", "--help"}, {"proxy", "--help"}, {"--json"}} {
		var stdout, stderr bytes.Buffer
		if code := runUser(args, &stdout, &stderr); code != 0 || stderr.Len() != 0 {
			t.Fatal(args, code, stderr.String())
		}
	}
	for _, args := range [][]string{nil, {"desktop"}, {"desktop", "open"}, {"desktop", "logout"}, {"proxy"}} {
		var stdout, stderr bytes.Buffer
		if code := runUser(args, &stdout, &stderr); code != 2 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "PIWORK_CLI_CONTAINER_MODE") {
			t.Fatal(args, code, stdout.String(), stderr.String())
		}
	}
	// Ordinary commands ignore this unused deployment flag.
	core := nonLoopbackCore(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"status":"healthy","ready":true}`) }))
	defer core.Close()
	var stdout, stderr bytes.Buffer
	if code := runUser([]string{"--core", core.URL, "status"}, &stdout, &stderr); code != 0 {
		t.Fatal(code, stderr.String())
	}
}

func TestContainerListenersAndNativeListenersKeepPortsAndBindings(t *testing.T) {
	for _, container := range []bool{false, true} {
		listener, err := listenCLILocal(0, container)
		if err != nil {
			t.Fatal(err)
		}
		address := listener.Addr().(*net.TCPAddr)
		if address.IP.String() != cliListenHost(container) {
			listener.Close()
			t.Fatal(container, address)
		}
		occupied, err := listenCLILocal(address.Port, container)
		if err == nil {
			occupied.Close()
			listener.Close()
			t.Fatal("occupied port was silently changed")
		}
		listener.Close()
		if opts, err := parseUserDesktopOptions(nil); err != nil || opts.port != 17891 {
			t.Fatal(opts, err)
		}
		if port, err := parseUserProxyPort(nil); err != nil || port != 17890 {
			t.Fatal(port, err)
		}
	}
}

func TestContainerProxyNATKeepsHostOriginAndLocalAuthentication(t *testing.T) {
	var calls atomic.Int32
	p := testUserProxy(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path == "/api/v1/file-access" {
			json.NewEncoder(w).Encode(map[string]any{"version": 1, "protocol": "webdav", "profile": "workspace-transfer-v1", "rootTemplate": "/api/v1/works/{workId}/files/", "available": true, "reason": nil, "limits": proxyFileExpectedLimits})
			return
		}
		if r.Header.Get("Authorization") != "Bearer core-secret" || r.Header.Get("X-Forwarded-For") != "" {
			t.Error("reserved local headers reached Core")
		}
		io.WriteString(w, "file bytes")
	})
	p.containerMode = true
	request := func() *http.Request {
		r := httptest.NewRequest("GET", "/works/"+testProxyWorkID+"/files/value.txt", nil)
		r.Host = "127.0.0.1:17890"
		r.RemoteAddr = "172.19.0.1:45000"
		r.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:local-secret")))
		return r
	}
	r := request()
	r.Header.Set("X-Forwarded-For", "127.0.0.1")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, r)
	if w.Code != 200 || w.Body.String() != "file bytes" {
		t.Fatal("Docker peer was rejected", w.Code, w.Body.String())
	}
	before := calls.Load()
	for _, mutate := range []func(*http.Request){
		func(r *http.Request) { r.Host = "attacker.invalid:17890" },
		func(r *http.Request) { r.Header.Set("Origin", "http://attacker.invalid") },
		func(r *http.Request) { r.Header.Set("Sec-Fetch-Site", "cross-site") },
		func(r *http.Request) { r.Header.Del("Authorization") },
		func(r *http.Request) { r.Header.Set("Authorization", "Bearer core-secret") },
		func(r *http.Request) {
			r.Header.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("piwork:wrong")))
		},
	} {
		r := request()
		mutate(r)
		r.Header.Set("X-Forwarded-For", "127.0.0.1")
		w := httptest.NewRecorder()
		p.ServeHTTP(w, r)
		if w.Code < 400 || calls.Load() != before {
			t.Fatal("unauthorized request contacted Core", w.Code, calls.Load(), before)
		}
	}
	for _, host := range []string{"127.0.0.1:17890", "attacker.invalid:17890"} {
		r := httptest.NewRequest("GET", "/proxy.pac", nil)
		r.RemoteAddr = "172.19.0.1:45000"
		r.Host = host
		w := httptest.NewRecorder()
		p.ServeHTTP(w, r)
		want := 200
		if strings.HasPrefix(host, "attacker") {
			want = 403
		}
		if w.Code != want {
			t.Fatal("PAC authority was not checked", host, w.Code)
		}
	}
	p.containerMode = false
	r = request()
	r.Header.Set("X-Forwarded-For", "127.0.0.1")
	w = httptest.NewRecorder()
	p.ServeHTTP(w, r)
	if w.Code != 403 || calls.Load() != before {
		t.Fatal("forwarded header enabled native peer bypass", w.Code, calls.Load())
	}
}

func TestContainerProxyInvalidModeFailsBeforeContactingCore(t *testing.T) {
	t.Setenv("PIWORK_CLI_CONTAINER_MODE", "invalid")
	var calls atomic.Int32
	core := nonLoopbackCore(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) { calls.Add(1) }))
	defer core.Close()
	api, _ := client.New(core.URL, "credential")
	var stdout, stderr bytes.Buffer
	if code := runUserProxy(api, nil, false, &stdout, &stderr); code != 2 || calls.Load() != 0 || stdout.Len() != 0 {
		t.Fatal(code, calls.Load(), stdout.String())
	}
}
