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

	"piwork/internal/corestore"
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
	// This HTTP fixture has synthetic Work rows rather than a running Agent.
	// Production admission is exercised separately against actual route proofs.
	a.serviceGateway.admissionForTest = func(context.Context, corestore.WorkRecord) (uint64, bool) { return 1, true }
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

func TestServiceGatewayRejectsPersistedReadyWithoutCurrentAgentProof(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	a.serviceGateway.admissionForTest = nil
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		if _, err := tx.Exec(`INSERT INTO work_context_snapshots(snapshot_id,work_id,configuration_json,image_identity,created_by_user_id,created_at) SELECT 'old-context',id,'{}','old-image',owner_user_id,? FROM works WHERE id='work-service-fixture1'`, packageNow()); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE works SET active_context_id='old-context',observed_state='ready' WHERE id='work-service-fixture1'`); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES('work-service-fixture1',1,'old-instance','ready',0,?,?)`, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	response := gatewayRequest(t, base, token, path+"/", nil, nil)
	if response.StatusCode != 503 {
		t.Fatalf("persisted readiness bypassed current Agent proof: %d", response.StatusCode)
	}
}

func TestWorkReadRequiresCurrentAgentProofForReadyObservation(t *testing.T) {
	a, _, _, _ := gatewayFixture(t, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	const workID = "work-service-fixture1"
	work, err := a.Store.Work(context.Background(), workID, false)
	if err != nil {
		t.Fatal(err)
	}
	a.setWorkRoutesOnline("", 0)
	admitted := false
	a.serviceGateway.admissionForTest = func(context.Context, corestore.WorkRecord) (uint64, bool) { return 1, admitted }
	actor := identity.Principal{UserID: work.OwnerUserID, Role: "user"}
	for _, tc := range []struct {
		admitted bool
		want     string
	}{{false, "unknown"}, {true, "ready"}, {false, "unknown"}} {
		admitted = tc.admitted
		for _, path := range []string{"/api/v1/works", "/api/v1/works/" + workID} {
			response := httptest.NewRecorder()
			handled, err := a.workRead(response, httptest.NewRequest("GET", path, nil), actor)
			if !handled || err != nil || response.Code != 200 {
				t.Fatalf("read %s: %v %d", path, err, response.Code)
			}
			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if path == "/api/v1/works" {
				body = body["works"].([]any)[0].(map[string]any)
			}
			if body["observedState"] != tc.want {
				t.Fatalf("%s: got %v, want %s", path, body["observedState"], tc.want)
			}
		}
	}
}

func TestServiceGatewayAllowsVerifiedWorkWhileGlobalNotReadyAndRevokesEpoch(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		io.WriteString(w, "data: available\n\n")
		http.NewResponseController(w).Flush()
		<-r.Context().Done()
	}))
	var epoch atomic.Uint64
	epoch.Store(1)
	a.serviceGateway.admissionForTest = func(context.Context, corestore.WorkRecord) (uint64, bool) { return epoch.Load(), true }
	a.mu.Lock()
	a.status.Ready = false
	a.mu.Unlock()
	response := gatewayRequest(t, base, token, path+"/events", nil, nil)
	reader := bufio.NewReader(response.Body)
	line, err := reader.ReadString('\n')
	if response.StatusCode != 200 || err != nil || line != "data: available\n" {
		t.Fatalf("verified Work blocked by global state: status=%d line=%q err=%v", response.StatusCode, line, err)
	}
	epoch.Store(2)
	started := time.Now()
	_, err = io.ReadAll(reader)
	if err == nil || time.Since(started) > 2*time.Second {
		t.Fatalf("old Engine stream did not close: %v after %s", err, time.Since(started))
	}
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

func TestServiceGatewayClosesExistingStreamOnCoreShutdown(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: open\n\n")
		_ = http.NewResponseController(w).Flush()
		<-r.Context().Done()
	}))
	response := gatewayRequest(t, base, token, path+"/events", nil, nil)
	reader := bufio.NewReader(response.Body)
	if line, err := reader.ReadString('\n'); err != nil || line != "data: open\n" {
		t.Fatal("stream did not open", line, err)
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- a.Close(shutdown) }()
	started := time.Now()
	if _, err := io.ReadAll(reader); err == nil || time.Since(started) > 2*time.Second {
		t.Fatal("Core shutdown did not revoke stream", err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
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

func TestServiceGatewayWebSocketClosesWhenEngineProofIsRevoked(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, buffer, err := http.NewResponseController(w).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n")
		_ = buffer.Flush()
		_, _ = io.Copy(conn, buffer)
	}))
	var epoch atomic.Uint64
	var admitted atomic.Bool
	epoch.Store(1)
	admitted.Store(true)
	a.serviceGateway.admissionForTest = func(context.Context, corestore.WorkRecord) (uint64, bool) { return epoch.Load(), admitted.Load() }
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(base, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	request := "GET " + path + "/socket HTTP/1.1\r\nHost: " + strings.TrimPrefix(base, "http://") + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n" + gatewayCredential + ": " + token + "\r\n\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		t.Fatal(err)
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, nil)
	if err != nil || response.StatusCode != 101 {
		t.Fatal("WebSocket admission failed", response, err)
	}
	admitted.Store(false)
	epoch.Store(2)
	started := time.Now()
	if _, err := reader.ReadByte(); err == nil || time.Since(started) > 2*time.Second {
		t.Fatal("Engine proof loss did not close WebSocket", err)
	}
	denied := gatewayRequest(t, base, token, path+"/", nil, nil)
	if denied.StatusCode != 503 {
		t.Fatal("new connection bypassed revoked Engine proof", denied.StatusCode)
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

func TestServiceGatewayFencesStoppedAndRestartedGeneration(t *testing.T) {
	a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = io.WriteString(w, "owned content") }))
	hostname := strings.Split(strings.TrimPrefix(path, "/api/v1/service-gateway/"), "/")[0]
	request, _ := http.NewRequest("GET", base+"/api/v1/service-access/resolve?hostname="+hostname+"&port=80", nil)
	request.Header.Set(gatewayCredential, token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var resolution struct{ Generation, WorkID string }
	if json.NewDecoder(response.Body).Decode(&resolution) != nil || resolution.Generation == "" {
		t.Fatal("missing authorization generation")
	}
	response.Body.Close()
	accepted := gatewayRequest(t, base, token, path+"/", nil, http.Header{"X-Piwork-Gateway-Generation": {resolution.Generation}})
	if accepted.StatusCode != 200 {
		t.Fatal("current generation denied", accepted.StatusCode)
	}
	accepted.Body.Close()
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET control_version=control_version+2 WHERE id=?`, resolution.WorkID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	old := gatewayRequest(t, base, token, path+"/", nil, http.Header{"X-Piwork-Gateway-Generation": {resolution.Generation}})
	if old.StatusCode == 200 {
		t.Fatal("old entry revived after stop/start")
	}
	old.Body.Close()
	// Independent CLI clients without the optional fencing header retain their
	// normal current-owner authorization contract.
	current := gatewayRequest(t, base, token, path+"/", nil, nil)
	if current.StatusCode != 200 {
		t.Fatal("normal owner client regressed", current.StatusCode)
	}
}

func TestServiceGatewayControlAcceptanceFencesUnchangedAddressAndRevision(t *testing.T) {
	for _, actions := range [][]string{{"restart"}, {"disable", "enable"}} {
		t.Run(strings.Join(actions, "-"), func(t *testing.T) {
			a, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = io.WriteString(w, "current app") }))
			hostname := strings.Split(strings.TrimPrefix(path, "/api/v1/service-gateway/"), "/")[0]
			resolve := func() struct{ Generation, WorkID, ServiceID string } {
				r, _ := http.NewRequest("GET", base+"/api/v1/service-access/resolve?hostname="+hostname+"&port=80", nil)
				r.Header.Set(gatewayCredential, token)
				response, err := http.DefaultClient.Do(r)
				if err != nil {
					t.Fatal(err)
				}
				defer response.Body.Close()
				var value struct{ Generation, WorkID, ServiceID string }
				if response.StatusCode != 200 || json.NewDecoder(response.Body).Decode(&value) != nil || value.Generation == "" {
					t.Fatal("resolution failed", response.StatusCode)
				}
				return value
			}
			prior := resolve()
			session, err := a.Identity.Authenticate(context.Background(), token)
			if err != nil {
				t.Fatal(err)
			}
			principal := session.Principal()
			for _, action := range actions {
				if _, err := a.acceptServiceAction(context.Background(), serviceActor{User: &principal}, prior.WorkID, prior.ServiceID, action, "gateway-control-"+action); err != nil {
					t.Fatal(err)
				}
			}
			current := resolve()
			if current.Generation == prior.Generation {
				t.Fatal("control intent retained stale authorization epoch")
			}
			stale := gatewayRequest(t, base, token, path+"/", nil, http.Header{"X-Piwork-Gateway-Generation": {prior.Generation}})
			if stale.StatusCode == 200 {
				t.Fatal("old entry survived fast control acceptance")
			}
			stale.Body.Close()
			// Replaying the accepted command must not rotate again or cause another stop.
			last := actions[len(actions)-1]
			if _, err := a.acceptServiceAction(context.Background(), serviceActor{User: &principal}, prior.WorkID, prior.ServiceID, last, "gateway-control-"+last); err != nil {
				t.Fatal(err)
			}
			if repeated := resolve(); repeated.Generation != current.Generation {
				t.Fatal("idempotent replay advanced the epoch")
			}
		})
	}
}

func TestServiceGatewayValidatesCanonicalPrefixAndFiltersForwardedAuthority(t *testing.T) {
	_, base, token, path := gatewayFixture(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		send(w, 200, map[string]string{"prefix": r.Header.Get("X-Forwarded-Prefix"), "forwarded": r.Header.Get("Forwarded"), "host": r.Header.Get("X-Forwarded-Host"), "uri": r.URL.RequestURI()})
	}))
	hostname := strings.Split(strings.TrimPrefix(path, "/api/v1/service-gateway/"), "/")[0]
	request, _ := http.NewRequest("GET", base+"/api/v1/service-access/resolve?hostname="+hostname+"&port=80", nil)
	request.Header.Set(gatewayCredential, token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	var target struct {
		WorkID, ServiceID string
		Port              int
	}
	if err = json.NewDecoder(response.Body).Decode(&target); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	prefix := "/services/" + target.WorkID + "/" + target.ServiceID + "/" + strconv.Itoa(target.Port)
	for _, values := range [][]string{{prefix}, {prefix + "/"}, {prefix, "/forged"}, {"/services/foreign/notes/80"}} {
		response := gatewayRequest(t, base, token, path+"/api/v1?q=%2f", nil, http.Header{"X-Forwarded-Prefix": values, "Forwarded": {"host=evil"}, "X-Forwarded-Host": {"evil"}})
		if len(values) != 1 || values[0] != prefix {
			if response.StatusCode != 400 {
				t.Fatal("invalid prefix accepted", response.StatusCode)
			}
			continue
		}
		var body map[string]string
		json.NewDecoder(response.Body).Decode(&body)
		if response.StatusCode != 200 || body["prefix"] != prefix || body["forwarded"] != "" || body["host"] != "" || body["uri"] != "/api/v1?q=%2f" {
			t.Fatal("prefix/authority changed", response.StatusCode, body)
		}
	}
}
