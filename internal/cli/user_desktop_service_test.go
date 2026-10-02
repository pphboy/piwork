package cli

import (
	"bufio"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestNativeDesktopServiceEntryExchangesTicketAndIsolatesApplicationHeaders(t *testing.T) {
	const workID = "work-1"
	const serviceID = "service-1"
	const hostname = "notes.w-12345678.work"
	var applicationCalls atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/me":
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"user"}`)
		case r.URL.Path == "/api/v1/works/"+workID+"/services/"+serviceID:
			if r.Header.Get("Authorization") != "Bearer core-token" {
				t.Error("Service metadata lacked Core bearer")
			}
			_, _ = io.WriteString(w, `{"workId":"work-1","serviceId":"service-1","access":{"hostname":"notes.w-12345678.work","defaultUrl":"http://notes.w-12345678.work","ports":[{"port":80}]}}`)
		case r.URL.Path == "/api/v1/service-access/resolve":
			if r.Header.Get("X-Piwork-Gateway-Token") != "core-token" || r.URL.Query().Get("hostname") != hostname || r.URL.Query().Get("port") != "80" {
				t.Error("Service resolution omitted gateway credential or target")
			}
			_, _ = io.WriteString(w, `{"hostname":"notes.w-12345678.work","workId":"work-1","serviceId":"service-1","port":80}`)
		case strings.HasPrefix(r.URL.Path, "/api/v1/service-gateway/"+hostname+"/80/"):
			applicationCalls.Add(1)
			if r.Header.Get("X-Piwork-Gateway-Token") != "core-token" || strings.Contains(r.Header.Get("Cookie"), "piwork-route") || r.Header.Get("Authorization") != "Basic app-secret" {
				t.Error("Service gateway request leaked local cookie or lost app auth", r.Header)
			}
			switch {
			case strings.HasSuffix(r.URL.Path, "/echo"):
				if r.Header.Get("Origin") != "http://"+hostname {
					t.Error("Service WebSocket Origin was not mapped", r.Header.Get("Origin"))
				}
				conn, buffered, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.Close()
				_, _ = io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
				_, _ = io.Copy(conn, buffered)
			case strings.HasSuffix(r.URL.Path, "/platform"):
				w.Header().Set("X-Piwork-Gateway-Error", "1")
				w.WriteHeader(401)
			case strings.HasSuffix(r.URL.Path, "/app"):
				w.WriteHeader(401)
				_, _ = io.WriteString(w, "application auth required")
			default:
				w.Header().Add("Set-Cookie", "app=1; Path=/; Domain=.work; HttpOnly")
				w.Header().Add("Set-Cookie", "__Host-piwork-route=evil; Path=/; Secure")
				w.Header().Set("Location", "http://"+hostname+"/next")
				w.Header().Set("Content-Type", "text/html")
				_, _ = io.WriteString(w, "application")
			}
		default:
			t.Error("unexpected Core Service route", r.URL.String())
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	api, err := client.New(core.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	d := &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credentials", "credential.json")},
		port: 17891, origin: "http://desktop.localhost:17891", sessions: map[string]desktopSession{
			"local": {csrf: "csrf", end: time.Now().Add(time.Hour)},
		}, identity: desktopIdentity{coreURL: core.URL, credential: &client.Credential{
			Version: 1, CoreURL: core.URL, Token: "core-token", ExpiresAt: "2099-01-01T00:00:00Z",
			User: client.Identity{ID: "user-1", Account: "owner", Role: "user"},
		}, checked: true}}
	call := func(method, address, body string, headers http.Header) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, address, strings.NewReader(body))
		r.Header = headers.Clone()
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		return w
	}
	local := make(http.Header)
	local.Set("Cookie", d.cookieName()+"=local")
	local.Set("Origin", d.origin)
	local.Set("X-Piwork-Csrf", "csrf")
	local.Set("Content-Type", "application/json")
	created := call("POST", d.origin+"/_desktop/api/service-entries", `{"workId":"work-1","serviceId":"service-1"}`, local)
	if created.Code != 200 {
		t.Fatal("Desktop Service entry failed", created.Code, created.Body.String())
	}
	var entry struct{ EntryID, EntryURL, Origin string }
	if json.Unmarshal(created.Body.Bytes(), &entry) != nil || entry.EntryID == "" || entry.EntryURL == "" {
		t.Fatal("Service entry malformed", created.Body.String())
	}
	parsed, err := url.Parse(entry.EntryURL)
	if err != nil {
		t.Fatal(err)
	}
	renewed := call("POST", d.origin+"/_desktop/api/service-entries", `{"workId":"work-1","serviceId":"service-1"}`, local)
	var newEntry struct{ EntryID, EntryURL string }
	if renewed.Code != 200 || json.Unmarshal(renewed.Body.Bytes(), &newEntry) != nil || newEntry.EntryID != entry.EntryID || newEntry.EntryURL == entry.EntryURL {
		t.Fatal("Service entry did not reuse its local origin and rotate ticket", renewed.Code, renewed.Body.String())
	}
	service := entry.Origin
	if served := call("GET", service+desktopServiceReserved+"enter", "", nil); served.Code != 200 || !strings.Contains(served.Body.String(), "entry.js") {
		t.Fatal("Service entry page missing", served.Code)
	}
	serviceHeaders := make(http.Header)
	serviceHeaders.Set("Origin", service)
	serviceHeaders.Set("Content-Type", "application/json")
	if expired := call("POST", service+desktopServiceReserved+"redeem", `{"ticket":"`+strings.TrimPrefix(parsed.Fragment, "ticket=")+`"}`, serviceHeaders); expired.Code != 403 {
		t.Fatal("rotated Service ticket remained valid", expired.Code)
	}
	parsed, _ = url.Parse(newEntry.EntryURL)
	redeemed := call("POST", service+desktopServiceReserved+"redeem", `{"ticket":"`+strings.TrimPrefix(parsed.Fragment, "ticket=")+`"}`, serviceHeaders)
	if redeemed.Code != 200 || !strings.Contains(redeemed.Header().Get("Set-Cookie"), "HttpOnly; Secure; SameSite=Strict") {
		t.Fatal("Service ticket exchange failed", redeemed.Code, redeemed.Body.String())
	}
	if replay := call("POST", service+desktopServiceReserved+"redeem", `{"ticket":"`+strings.TrimPrefix(parsed.Fragment, "ticket=")+`"}`, serviceHeaders); replay.Code != 403 {
		t.Fatal("Service ticket replay accepted", replay.Code)
	}
	serviceHeaders.Del("Content-Type")
	serviceHeaders.Set("Authorization", "Basic app-secret")
	serviceHeaders.Set("Cookie", strings.SplitN(redeemed.Header().Get("Set-Cookie"), ";", 2)[0]+"; app=1")
	page := call("GET", service+"/", "", serviceHeaders)
	if page.Code != 200 || page.Body.String() != "application" || page.Header().Get("Location") != service+"/next" ||
		len(page.Header().Values("Set-Cookie")) != 1 || strings.Contains(strings.ToLower(page.Header().Get("Set-Cookie")), "domain=") {
		t.Fatal("Service application response was not isolated", page.Code, page.Body.String(), page.Header())
	}
	if appAuth := call("GET", service+"/app", "", serviceHeaders); appAuth.Code != 401 || !strings.Contains(appAuth.Body.String(), "application auth required") {
		t.Fatal("Service application 401 changed", appAuth.Code)
	}
	if samePath := call("GET", service+"/works/work-1/files/value", "", serviceHeaders); samePath.Code != 200 || samePath.Body.String() != "application" {
		t.Fatal("application path entered the platform file route", samePath.Code, samePath.Body.String())
	}
	listener := httptest.NewServer(d)
	conn, err := net.Dial("tcp", strings.TrimPrefix(listener.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	_ = conn.SetDeadline(time.Now().Add(4 * time.Second))
	_, err = io.WriteString(conn, "GET /echo HTTP/1.1\r\nHost: "+strings.TrimPrefix(service, "http://")+"\r\nOrigin: "+service+"\r\nCookie: "+serviceHeaders.Get("Cookie")+"\r\nAuthorization: Basic app-secret\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
	if err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	var head strings.Builder
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatal(err)
		}
		head.WriteString(line)
		if line == "\r\n" {
			break
		}
	}
	if !strings.Contains(head.String(), "101 Switching Protocols") {
		t.Fatal("Desktop WebSocket upgrade failed", head.String())
	}
	_, _ = io.WriteString(conn, "hello")
	echo := make([]byte, 5)
	if _, err := io.ReadFull(reader, echo); err != nil || string(echo) != "hello" {
		t.Fatal("Desktop WebSocket was not bidirectional", string(echo), err)
	}
	conn.Close()
	listener.Close()
	d.mu.Lock()
	stillAuthorized := d.identity.credential != nil
	d.mu.Unlock()
	if !stillAuthorized {
		t.Fatal("application 401 revoked Desktop Core session")
	}
	if platform := call("GET", service+"/platform", "", serviceHeaders); platform.Code != 401 || strings.Contains(platform.Body.String(), "core-token") {
		t.Fatal("platform 401 was not isolated", platform.Code, platform.Body.String())
	}
	d.mu.Lock()
	stillAuthorized = d.identity.credential != nil
	d.mu.Unlock()
	if stillAuthorized || applicationCalls.Load() != 5 {
		t.Fatal("platform revocation failed or gateway calls lost", applicationCalls.Load())
	}
}
