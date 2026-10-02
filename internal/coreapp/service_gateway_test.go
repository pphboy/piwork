package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/identity"
)

func gatewayFixture(t *testing.T, handler http.Handler) (*Application, string, string, string) {
	t.Helper()
	upstream := httptest.NewServer(handler)
	t.Cleanup(upstream.Close)
	a, actor, workID := serviceAcceptFixture(t)
	host, portText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
	port, _ := strconv.Atoi(portText)
	raw, _ := json.Marshal(map[string]any{"name": "notes", "image": map[string]string{"reference": "fixture/app"}, "command": "app", "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": port}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health"}})
	accepted, err := a.acceptServiceDefinition(context.Background(), actor, workID, "", 0, raw, "gateway")
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='ready' WHERE id=?`, workID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='ready',applied_revision=1 WHERE work_id=?`, workID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(context.Background(), "admin", "development-fixture-pass", "gateway")
	if err != nil {
		t.Fatal(err)
	}
	a.serviceGateway.route = func(context.Context, string, string) (string, error) { return host, nil }
	work, _ := a.Store.Work(context.Background(), workID, false)
	service, _ := a.Store.Service(context.Background(), workID, accepted.ServiceID, false)
	access, err := a.serviceDomains().describe(context.Background(), work, service)
	if err != nil {
		t.Fatal(err)
	}
	return a, "http://" + a.listener.Addr().String(), login.Token, "/api/v1/service-gateway/" + access.Hostname + "/80"
}
func gatewayRequest(t *testing.T, base, token, path string, body []byte, headers http.Header) *http.Response {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	request, err := http.NewRequestWithContext(ctx, "POST", base+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header = headers.Clone()
	if request.Header == nil {
		request.Header = make(http.Header)
	}
	request.Header.Set(gatewayCredential, token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { response.Body.Close() })
	return response
}
func TestServiceGatewayPreservesHTTPAndApplicationAuthentication(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", "app=session; Path=/")
		w.Header().Add("Set-Cookie", "theme=light")
		w.Header().Set(gatewayMarker, "forged")
		w.Header().Set("X-Piwork-Gateway-Anything", "private")
		if r.URL.Path == "/app-error" {
			w.WriteHeader(401)
			io.WriteString(w, "login required")
			return
		}
		body, _ := io.ReadAll(r.Body)
		send(w, 200, map[string]any{"method": r.Method, "path": r.URL.RequestURI(), "host": r.Host, "authorization": r.Header.Get("Authorization"), "cookie": r.Header.Get("Cookie"), "gatewayToken": r.Header.Get(gatewayCredential), "forged": r.Header.Get("X-Piwork-Gateway-Forged"), "body": body})
	}))
	for _, auth := range []string{"Basic YXBwOnBhc3M=", "Bearer application-secret"} {
		headers := http.Header{"Authorization": {auth}, "Cookie": {"app=session"}, "X-Piwork-Gateway-Forged": {"private"}}
		response := gatewayRequest(t, base, token, path+"/%2e%2e/raw/%252e?x=%2f&x=%252e", []byte{0, 255, 7}, headers)
		var body struct {
			Method, Path, Host, Authorization, Cookie, GatewayToken, Forged string
			Body                                                            []byte
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 200 || body.Method != "POST" || body.Path != "/%2e%2e/raw/%252e?x=%2f&x=%252e" || body.Authorization != auth || body.Cookie != "app=session" || body.GatewayToken != "" || body.Forged != "" || !bytes.Equal(body.Body, []byte{0, 255, 7}) || len(response.Header.Values("Set-Cookie")) != 2 || response.Header.Get(gatewayMarker) != "" {
			t.Fatal("HTTP forwarding changed application semantics", response.StatusCode, body, response.Header)
		}
	}
	response := gatewayRequest(t, base, token, path+"/app-error", nil, nil)
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != 401 || string(body) != "login required" || response.Header.Get(gatewayMarker) != "" {
		t.Fatal("application 401 became platform failure")
	}
	for _, bad := range []string{"", "invalid"} {
		response := gatewayRequest(t, base, bad, path+"/", nil, nil)
		if response.StatusCode != 401 || response.Header.Get(gatewayMarker) != "1" {
			t.Fatal("platform credential not enforced")
		}
	}
	for _, bad := range []string{"/api/v1/service-gateway/127.0.0.1/80/", strings.Replace(path, "/80", "/65535", 1) + "/"} {
		response := gatewayRequest(t, base, token, bad, nil, nil)
		if response.StatusCode != 404 || response.Header.Get(gatewayMarker) != "1" {
			t.Fatal("arbitrary target accepted", response.StatusCode, bad)
		}
	}
	_, err := a.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "other", "development-fixture-pass", "admin")
	if err != nil {
		t.Fatal(err)
	}
	login, err := a.Identity.Login(context.Background(), "other", "development-fixture-pass", "foreign")
	if err != nil {
		t.Fatal(err)
	}
	foreign := gatewayRequest(t, base, login.Token, path+"/", nil, nil)
	if foreign.StatusCode != 404 {
		t.Fatal("foreign admin accessed application content", foreign.StatusCode)
	}
}

func TestServiceGatewaySSELimitsAndRevocation(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: first\n\n")
		http.NewResponseController(w).Flush()
		<-r.Context().Done()
	}))
	a.serviceGateway.userLimit = 1
	start := time.Now()
	response := gatewayRequest(t, base, token, path+"/events", nil, nil)
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if err != nil || line != "data: first\n" || time.Since(start) > time.Second {
		t.Fatal("SSE first segment buffered", line, err)
	}
	limited := gatewayRequest(t, base, token, path+"/events", nil, nil)
	if limited.StatusCode != 503 || limited.Header.Get(gatewayMarker) != "1" {
		t.Fatal("stream limit not enforced", limited.StatusCode)
	}
	if err := a.Identity.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	start = time.Now()
	_, err = io.ReadAll(reader)
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatal("revoked SSE did not close in two seconds", err, time.Since(start))
	}
}

func TestServiceGatewayWebSocketFramesAndRevocation(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/reject" {
			w.Header().Set("Set-Cookie", "app=denied")
			w.WriteHeader(403)
			io.WriteString(w, "app denied")
			return
		}
		conn, buffer, err := http.NewResponseController(w).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSet-Cookie: app=ok\r\nX-Piwork-Gateway-Error: forged\r\n\r\n")
		buffer.Flush()
		io.Copy(conn, buffer)
	}))
	headers := http.Header{"Connection": {"Upgrade"}, "Upgrade": {"websocket"}}
	denied := gatewayRequest(t, base, token, path+"/reject", nil, headers)
	body, _ := io.ReadAll(denied.Body)
	if denied.StatusCode != 403 || string(body) != "app denied" || denied.Header.Get(gatewayMarker) != "" || denied.Header.Get("Set-Cookie") != "app=denied" {
		t.Fatal("upgrade rejection was not passed through")
	}
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(base, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	frame := []byte{0x81, 0x82, 1, 2, 3, 4, 'h' ^ 1, 'i' ^ 2}
	request := "GET " + path + "/socket HTTP/1.1\r\nHost: " + strings.TrimPrefix(base, "http://") + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" + gatewayCredential + ": " + token + "\r\n\r\n"
	if _, err := conn.Write(append([]byte(request), frame...)); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil || response.StatusCode != 101 || response.Header.Get(gatewayMarker) != "" || response.Header.Get("Set-Cookie") != "app=ok" {
		t.Fatal("upgrade failed", response, err)
	}
	echoed := make([]byte, len(frame))
	if _, err := io.ReadFull(reader, echoed); err != nil || !bytes.Equal(echoed, frame) {
		t.Fatal("buffered WebSocket frame lost", echoed, err)
	}
	if _, err := conn.Write(frame); err != nil {
		t.Fatal(err)
	}
	if _, err := io.ReadFull(reader, echoed); err != nil || !bytes.Equal(echoed, frame) {
		t.Fatal("bidirectional frame lost", err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE service_heads SET enabled=0 WHERE name='notes'`)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	_, err = reader.ReadByte()
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatal("Service stop did not close WebSocket", err, time.Since(start))
	}
}

func TestServiceGatewaySlowRuntimeReviewAndHeaderLimit(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: first\n\n")
		http.NewResponseController(w).Flush()
		<-r.Context().Done()
	}))
	original := a.serviceGateway.route
	var blocked atomic.Bool
	a.serviceGateway.route = func(ctx context.Context, workID, serviceID string) (string, error) {
		if blocked.Load() {
			<-ctx.Done()
			return "", ctx.Err()
		}
		return original(ctx, workID, serviceID)
	}
	events := gatewayRequest(t, base, token, path+"/events", nil, nil)
	reader := bufio.NewReader(events.Body)
	if _, err := reader.ReadString('\n'); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	blocked.Store(true)
	_, err := io.ReadAll(reader)
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatal("slow Docker review exceeded qualification bound", err, time.Since(start))
	}
	blocked.Store(false)
	request, err := http.NewRequest("GET", base+path+"/", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set(gatewayCredential, token)
	request.Header.Set("X-Large", strings.Repeat("x", (32<<10)-20))
	recorder := httptest.NewRecorder()
	a.serviceGateway.serve(recorder, request)
	if recorder.Code != 400 || recorder.Header().Get(gatewayMarker) != "1" || !strings.Contains(recorder.Body.String(), "HEADERS_TOO_LARGE") {
		t.Fatal("oversized gateway headers accepted", recorder.Code, recorder.Body.String())
	}
}

func TestServiceGatewayConnectionReservationsAreBounded(t *testing.T) {
	g := &serviceGateway{totalLimit: 2, userLimit: 1, byUser: map[string]int{}}
	first, err := g.reserve("first")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.reserve("first"); err == nil {
		t.Fatal("per-user limit bypassed")
	}
	second, err := g.reserve("second")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := g.reserve("third"); err == nil {
		t.Fatal("global connection limit bypassed")
	}
	first()
	first()
	third, err := g.reserve("third")
	if err != nil {
		t.Fatal("idempotent release failed", err)
	}
	second()
	third()
	if g.active != 0 || len(g.byUser) != 0 {
		t.Fatal("connection counts leaked")
	}
}
