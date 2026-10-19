package cli

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

type hostedServiceFixture struct {
	pool         *HostedServicePool
	transport    *client.HandlerTransport
	generation   atomic.Int64
	streamClosed chan struct{}
}

func freeServicePorts(t *testing.T, count int) int {
	t.Helper()
	for attempt := 0; attempt < 100; attempt++ {
		first, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		port := first.Addr().(*net.TCPAddr).Port
		listeners := []net.Listener{first}
		for next := 1; next < count && port+next < 65536; next++ {
			l, err := net.Listen("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port+next)))
			if err != nil {
				break
			}
			listeners = append(listeners, l)
		}
		for _, l := range listeners {
			_ = l.Close()
		}
		if len(listeners) == count {
			return port
		}
	}
	t.Fatal("no free bounded Service range")
	return 0
}

func newHostedServiceFixture(t *testing.T, ports int) *hostedServiceFixture {
	t.Helper()
	f := &hostedServiceFixture{streamClosed: make(chan struct{}, 10)}
	f.generation.Store(1)
	first := freeServicePorts(t, ports)
	var err error
	f.pool, err = NewHostedServicePool(context.Background(), HostedServiceOptions{Origin: "http://127.0.0.1:7171", ListenHost: "127.0.0.1", StateDirectory: filepath.Join(t.TempDir(), "origins"), FirstPort: first, LastPort: first + ports - 1})
	if err != nil {
		t.Fatal(err)
	}
	f.transport = client.NewHandlerTransport(context.Background(), http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/v1/me":
			_, _ = io.WriteString(w, `{"id":"user-1","account":"owner","role":"user"}`)
		case strings.HasPrefix(r.URL.Path, "/api/v1/works/work-1/services/"):
			id := strings.TrimPrefix(r.URL.Path, "/api/v1/works/work-1/services/")
			if r.Header.Get("Authorization") != "Bearer test-core-token" {
				t.Error("metadata credential missing")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"access": map[string]any{"hostname": id + ".w-12345678.work", "defaultUrl": "http://" + id + ".w-12345678.work", "ports": []map[string]int{{"port": 80}}}})
		case r.URL.Path == "/api/v1/service-access/resolve":
			hostname := r.URL.Query().Get("hostname")
			if r.Header.Get("X-Piwork-Gateway-Token") != "test-core-token" {
				t.Error("resolution credential missing")
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"hostname": hostname, "workId": "work-1", "serviceId": strings.Split(hostname, ".")[0], "port": 80, "generation": strconv.FormatInt(f.generation.Load(), 10)})
		case strings.HasPrefix(r.URL.Path, "/api/v1/service-gateway/"):
			parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/api/v1/service-gateway/"), "/", 3)
			if len(parts) != 3 || r.Header.Get("X-Piwork-Gateway-Token") != "test-core-token" || r.Header.Get("X-Piwork-Gateway-Generation") != strconv.FormatInt(f.generation.Load(), 10) {
				w.WriteHeader(409)
				return
			}
			switch parts[2] {
			case "set":
				http.SetCookie(w, &http.Cookie{Name: "same", Value: strings.Split(parts[0], ".")[0], Path: "/", Domain: ".work", HttpOnly: true})
				http.SetCookie(w, &http.Cookie{Name: "path", Value: "only", Path: "/deep"})
				http.SetCookie(w, &http.Cookie{Name: "__Host-piwork-route", Value: "evil", Path: "/", Secure: true})
				w.Header().Set("Location", "http://"+parts[0]+"/next?q=1")
				w.Header().Set("X-Frame-Options", "DENY")
			case "delete":
				http.SetCookie(w, &http.Cookie{Name: "same", Value: "", Path: "/", Domain: ".work", MaxAge: -1})
			case "auth":
				if r.Header.Get("Authorization") != "Basic app-secret" && r.Header.Get("Authorization") != "Bearer application" {
					w.WriteHeader(401)
					_, _ = io.WriteString(w, "app login required")
					return
				}
			case "events":
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: first\n\n")
				w.(http.Flusher).Flush()
				<-r.Context().Done()
				f.streamClosed <- struct{}{}
				return
			case "echo":
				if r.Header.Get("Origin") != "http://"+parts[0] {
					t.Error("upgrade Origin lost")
				}
				conn, b, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Error(err)
					return
				}
				defer conn.Close()
				_, _ = io.WriteString(conn, "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
				_, _ = io.Copy(conn, b)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"cookie": r.Header.Get("Cookie"), "authorization": r.Header.Get("Authorization"), "query": r.URL.RawQuery})
		default:
			t.Error("unexpected hosted Core route", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(func() { f.pool.Close(); f.transport.Close() })
	return f
}

func (f *hostedServiceFixture) desktop(t *testing.T, session string) *HostedDesktop {
	t.Helper()
	directory := t.TempDir()
	h, err := NewHostedDesktop(HostedDesktopOptions{Origin: f.pool.options.Origin, SessionID: session, CSRF: "csrf", CookieName: "web-session", StateDirectory: filepath.Join(directory, "session"), RecordDirectory: filepath.Join(directory, "user"), Credential: client.Credential{Version: 1, CoreURL: f.pool.options.Origin, Token: "test-core-token", ExpiresAt: time.Now().Add(time.Hour).UTC().Format(time.RFC3339Nano), User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}, Transport: f.transport, Services: f.pool})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(h.Close)
	return h
}

type hostedEntry struct{ EntryID, EntryURL, Origin string }

func hostedEntryCreate(t *testing.T, h *HostedDesktop, session, service string) (hostedEntry, int) {
	t.Helper()
	r := httptest.NewRequest("POST", h.desktop.origin+"/_desktop/api/service-entries", strings.NewReader(fmt.Sprintf(`{"workId":"work-1","serviceId":%q}`, service)))
	r.Header.Set("Cookie", "web-session="+session)
	r.Header.Set("Origin", h.desktop.origin)
	r.Header.Set("X-Piwork-Csrf", "csrf")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	var entry hostedEntry
	_ = json.Unmarshal(w.Body.Bytes(), &entry)
	return entry, w.Code
}
func serviceCall(t *testing.T, method, address, cookie, body string) *http.Response {
	t.Helper()
	r, err := http.NewRequest(method, address, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(address)
	r.Header.Set("Origin", parsed.Scheme+"://"+parsed.Host)
	r.Header.Set("Cookie", cookie)
	r.Header.Set("Content-Type", "application/json")
	c := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 4 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := c.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close(); c.CloseIdleConnections() })
	return response
}
func serviceRedeem(t *testing.T, entry hostedEntry) string {
	t.Helper()
	parsed, _ := url.Parse(entry.EntryURL)
	response := serviceCall(t, "POST", entry.Origin+desktopServiceReserved+"redeem", "", `{"ticket":"`+strings.TrimPrefix(parsed.Fragment, "ticket=")+`"}`)
	if response.StatusCode != 200 || len(response.Cookies()) != 1 || !response.Cookies()[0].HttpOnly || response.Cookies()[0].Secure {
		t.Fatal("HTTP IP ticket exchange failed", response.StatusCode)
	}
	return response.Cookies()[0].Name + "=" + response.Cookies()[0].Value
}
func responseText(t *testing.T, r *http.Response) string {
	t.Helper()
	b, err := io.ReadAll(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	r.Body.Close()
	return string(b)
}

func TestHostedServiceCookiePartitionAndGrantBoundaries(t *testing.T) {
	f := newHostedServiceFixture(t, 2)
	h := f.desktop(t, "first")
	a, status := hostedEntryCreate(t, h, "first", "notes")
	if status != 200 {
		t.Fatal("create", status)
	}
	b, status := hostedEntryCreate(t, h, "first", "other")
	if status != 200 || a.Origin == b.Origin {
		t.Fatal("Service origins shared", status)
	}
	if r := serviceCall(t, "GET", a.Origin+"/", "web-session=first", ""); r.StatusCode != 401 {
		t.Fatal("main cookie authorized Service", r.StatusCode)
	}
	grantA := serviceRedeem(t, a)
	grantB := serviceRedeem(t, b)
	parsed, _ := url.Parse(a.EntryURL)
	if r := serviceCall(t, "POST", a.Origin+desktopServiceReserved+"redeem", "", `{"ticket":"`+strings.TrimPrefix(parsed.Fragment, "ticket=")+`"}`); r.StatusCode != 401 {
		t.Fatal("ticket replay accepted", r.StatusCode)
	}
	if r := serviceCall(t, "GET", b.Origin+"/", grantA, ""); r.StatusCode != 401 {
		t.Fatal("cross-Service grant accepted", r.StatusCode)
	}
	for _, item := range []struct {
		entry        hostedEntry
		grant, value string
	}{{a, grantA, "notes"}, {b, grantB, "other"}} {
		r := serviceCall(t, "GET", item.entry.Origin+"/set", item.grant, "")
		if r.StatusCode != 200 || len(r.Cookies()) != 0 || r.Header.Get("Location") != item.entry.Origin+"/next?q=1" || r.Header.Get("X-Frame-Options") != "DENY" {
			t.Fatal("upstream headers changed", r.StatusCode, r.Header)
		}
		body := responseText(t, serviceCall(t, "GET", item.entry.Origin+"/deep/value?q=hello", item.grant+"; same=forged; piwork-web=forged", ""))
		if !strings.Contains(body, "same="+item.value) || !strings.Contains(body, "path=only") || strings.Contains(body, "forged") || !strings.Contains(body, "q=hello") {
			t.Fatal("jar partition/path/query failed", body)
		}
	}
	_ = responseText(t, serviceCall(t, "GET", a.Origin+"/delete", grantA, ""))
	if body := responseText(t, serviceCall(t, "GET", a.Origin+"/", grantA, "")); strings.Contains(body, "same=") || strings.Contains(body, "path=") {
		t.Fatal("jar deletion/path failed", body)
	}
	if r := serviceCall(t, "GET", a.Origin+"/auth", grantA, ""); r.StatusCode != 401 || !strings.Contains(responseText(t, r), "app login required") {
		t.Fatal("application 401 changed", r.StatusCode)
	}
	h2 := f.desktop(t, "second")
	a2, status := hostedEntryCreate(t, h2, "second", "notes")
	if status != 200 || a2.Origin != a.Origin {
		t.Fatal("logical origin not reused", status)
	}
	grant2 := serviceRedeem(t, a2)
	if body := responseText(t, serviceCall(t, "GET", a2.Origin+"/deep/", grant2, "")); strings.Contains(body, "same=") || strings.Contains(body, "path=") {
		t.Fatal("browser jars shared", body)
	}
	h.Close()
	if r := serviceCall(t, "GET", a.Origin+"/", grantA, ""); r.StatusCode != 401 {
		t.Fatal("closed session grant survived", r.StatusCode)
	}
	if r := serviceCall(t, "GET", a.Origin+"/", grant2, ""); r.StatusCode != 200 {
		t.Fatal("other browser revoked", r.StatusCode)
	}
}

func TestHostedServiceStreamsAndPinnedOriginSurviveRevocation(t *testing.T) {
	f := newHostedServiceFixture(t, 1)
	h := f.desktop(t, "session")
	entry, status := hostedEntryCreate(t, h, "session", "notes")
	if status != 200 {
		t.Fatal(status)
	}
	grant := serviceRedeem(t, entry)
	stream := serviceCall(t, "GET", entry.Origin+"/events", grant, "")
	reader := bufio.NewReader(stream.Body)
	if line, err := reader.ReadString('\n'); err != nil || line != "data: first\n" {
		t.Fatal("SSE flush lost", line, err)
	}
	f.generation.Add(1)
	select {
	case <-f.streamClosed:
	case <-time.After(2 * time.Second):
		t.Fatal("Service generation revocation exceeded two seconds")
	}
	if r := serviceCall(t, "GET", entry.Origin+"/", grant, ""); r.StatusCode == 200 {
		t.Fatal("old grant revived")
	}
	newer, status := hostedEntryCreate(t, h, "session", "notes")
	if status != 200 || newer.Origin != entry.Origin {
		t.Fatal("same logical Service lost origin", status)
	}
	newGrant := serviceRedeem(t, newer)
	u, _ := url.Parse(newer.Origin)
	conn, err := net.Dial("tcp", u.Host)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(4 * time.Second))
	_, _ = fmt.Fprintf(conn, "GET /echo HTTP/1.1\r\nHost: %s\r\nOrigin: %s\r\nCookie: %s\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n", u.Host, newer.Origin, newGrant)
	socket := bufio.NewReader(conn)
	response, err := http.ReadResponse(socket, &http.Request{Method: "GET"})
	if err != nil || response.StatusCode != 101 {
		t.Fatal("WebSocket upgrade failed", err)
	}
	_, _ = io.WriteString(conn, "echo")
	data := make([]byte, 4)
	if _, err := io.ReadFull(socket, data); err != nil || string(data) != "echo" {
		t.Fatal("WebSocket duplex lost", err)
	}
	h.Close()
	f.pool.Close()
	_ = conn.Close()
	options := f.pool.options
	pool, err := NewHostedServicePool(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	f.pool = pool
	t.Cleanup(pool.Close)
	h = f.desktop(t, "after-restart")
	if _, status := hostedEntryCreate(t, h, "after-restart", "other"); status != 503 {
		t.Fatal("retired origin reassigned to another app", status)
	}
	reopened, status := hostedEntryCreate(t, h, "after-restart", "notes")
	if status != 200 || reopened.Origin != entry.Origin {
		t.Fatal("durable origin pin lost", status)
	}
	if r := serviceCall(t, "GET", reopened.Origin+"/", newGrant, ""); r.StatusCode != 401 {
		t.Fatal("pre-restart grant survived", r.StatusCode)
	}
}

func TestHostedConcurrentEntryCreationUsesOnePinnedOrigin(t *testing.T) {
	f := newHostedServiceFixture(t, 1)
	h := f.desktop(t, "concurrent")
	type outcome struct {
		entry  hostedEntry
		status int
	}
	done := make(chan outcome, 8)
	for i := 0; i < 8; i++ {
		go func() {
			entry, status := hostedEntryCreate(t, h, "concurrent", "notes")
			done <- outcome{entry, status}
		}()
	}
	var first hostedEntry
	for i := 0; i < 8; i++ {
		value := <-done
		if value.status != 200 {
			t.Fatal("parallel entry rejected", value.status)
		}
		if i == 0 {
			first = value.entry
		}
		if value.entry.EntryID != first.EntryID || value.entry.Origin != first.Origin || strings.HasSuffix(value.entry.Origin, ":0") {
			t.Fatal("parallel creation produced distinct or unbound entries")
		}
	}
	f.pool.mu.Lock()
	pins, slots, refs := len(f.pool.bindings), len(f.pool.slots), 0
	for _, slot := range f.pool.slots {
		refs += len(slot.entries)
	}
	f.pool.mu.Unlock()
	if pins != 1 || slots != 1 || refs != 1 {
		t.Fatal("parallel creation leaked capacity", pins, slots, refs)
	}
	if _, status := hostedEntryCreate(t, h, "concurrent", "other"); status != 503 {
		t.Fatal("bounded origin capacity not enforced", status)
	}
}
