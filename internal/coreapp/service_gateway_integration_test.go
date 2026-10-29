//go:build integration

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
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/webapp"
)

func TestNativeRetainedWorkAndServiceWhileDefaultImageBlocked(t *testing.T) {
	// The fixture intentionally removes host tools from PATH after this lookup.
	node, nodeErr := exec.LookPath("node")
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	script := `const http=require('http'),crypto=require('crypto');const server=http.createServer((req,res)=>{if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: retained\n\n');return;}res.end('retained-service');});server.on('upgrade',(req,socket,head)=>{const key=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: '+key+'\r\n\r\n');if(head.length)socket.write(head);socket.on('data',c=>socket.write(c));});server.listen(8099,'0.0.0.0');`
	definition := map[string]any{"name": "retained", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "workingDirectory": "/", "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/", "deadlineMs": 10000}}
	status, accepted := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "retained-service"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	serviceID := accepted["serviceId"].(string)
	status, view := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/services/"+serviceID, "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, view)
	}
	hostname := view["access"].(map[string]any)["hostname"].(string)
	directory, dockerOptions, helper := a.options.DataDirectory, a.options.DockerOptions, a.options.PackageHelperImage
	shutdown, cancel := context.WithTimeout(ctx, 45*time.Second)
	if err := a.Close(shutdown); err != nil {
		cancel()
		t.Fatal(err)
	}
	cancel()
	next, err := New(context.Background(), Options{DataDirectory: directory, DockerOptions: dockerOptions, AgentGRPCListen: "0.0.0.0:0", PackageHelperImage: helper})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		shutdown, cancel := context.WithTimeout(context.Background(), 45*time.Second)
		defer cancel()
		if err := next.Close(shutdown); err != nil {
			t.Error(err)
		}
	})
	blocked := make(chan struct{})
	var once sync.Once
	next.preparation.pullForTest = func(ctx context.Context, _ string) (dockerengine.PreparedImage, error) {
		once.Do(func() { close(blocked) })
		<-ctx.Done()
		return dockerengine.PreparedImage{}, ctx.Err()
	}
	address, err := next.Listen(ListenAddress{"127.0.0.1", 0})
	if err != nil {
		t.Fatal(err)
	}
	base = address.URL()
	select {
	case <-blocked:
	case <-ctx.Done():
		t.Fatal("default image was not blocked")
	}
	client := &http.Client{Timeout: time.Second}
	serviceURL := base + "/api/v1/service-gateway/" + hostname + "/80/"
	for {
		request, _ := http.NewRequestWithContext(ctx, "GET", serviceURL, nil)
		request.Header.Set(gatewayCredential, strings.TrimPrefix(auth, "Bearer "))
		response, err := client.Do(request)
		if err == nil {
			body, _ := io.ReadAll(response.Body)
			response.Body.Close()
			if response.StatusCode == 200 && string(body) == "retained-service" {
				break
			}
		}
		select {
		case <-ctx.Done():
			t.Fatal("retained Service did not recover while defaults were blocked", next.Status(), next.Preparation())
		case <-time.After(100 * time.Millisecond):
		}
	}
	if next.Status().Ready {
		t.Fatal("blocked default unexpectedly made Core ready")
	}
	if status, sessions := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/sessions", "GET", auth, nil); status != 200 || sessions["sessions"] == nil {
		t.Fatal("retained Agent unavailable while default image blocked", status, sessions)
	}
	if status, result := packageHTTPCall(t, base, "/api/v1/works", "POST", auth, map[string]any{"name": "blocked default", "idempotencyKey": "blocked-default"}); status != 503 || result["code"] != "RUNTIME_UNAVAILABLE" {
		t.Fatal("default Work create was not rejected", status, result)
	}
	func() {
		var original string
		if err := next.Store.Write(ctx, func(tx *sql.Tx) error {
			if err := tx.QueryRow(`SELECT runtime_id FROM resource_bindings WHERE work_id=? AND resource_kind='service' AND logical_id=?`, workID, workID+"/"+serviceID).Scan(&original); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE resource_bindings SET runtime_id='fixture-wrong-binding' WHERE work_id=? AND resource_kind='service' AND logical_id=?`, workID, workID+"/"+serviceID)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		defer func() {
			if err := next.Store.Write(context.Background(), func(tx *sql.Tx) error {
				_, err := tx.Exec(`UPDATE resource_bindings SET runtime_id=? WHERE work_id=? AND resource_kind='service' AND logical_id=?`, original, workID, workID+"/"+serviceID)
				return err
			}); err != nil {
				t.Error(err)
			}
		}()
		request, _ := http.NewRequestWithContext(ctx, "GET", serviceURL, nil)
		request.Header.Set(gatewayCredential, strings.TrimPrefix(auth, "Bearer "))
		response, err := client.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode == 200 {
			t.Fatal("Service with a mismatched binding was admitted")
		}
	}()
	gatewayPath := "/api/v1/service-gateway/" + hostname + "/80"
	token := strings.TrimPrefix(auth, "Bearer ")
	events := gatewayRequest(t, base, token, gatewayPath+"/events", nil, nil)
	if line, err := bufio.NewReader(events.Body).ReadString('\n'); err != nil || line != "data: retained\n" {
		t.Fatal("SSE was blocked by default preparation", line, err)
	}
	events.Body.Close()
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(base, "http://"), 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	frame := []byte{0x81, 0x82, 1, 2, 3, 4, 'h' ^ 1, 'i' ^ 2}
	request := "GET " + gatewayPath + "/socket HTTP/1.1\r\nHost: " + strings.TrimPrefix(base, "http://") + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: aGVsbG8=\r\nSec-WebSocket-Version: 13\r\n" + gatewayCredential + ": " + token + "\r\n\r\n"
	if _, err := conn.Write(append([]byte(request), frame...)); err != nil {
		t.Fatal(err)
	}
	wsReader := bufio.NewReader(conn)
	upgrade, err := http.ReadResponse(wsReader, nil)
	if err != nil || upgrade.StatusCode != 101 {
		t.Fatal("WebSocket was blocked by default preparation", upgrade, err)
	}
	echoed := make([]byte, len(frame))
	if _, err := io.ReadFull(wsReader, echoed); err != nil || !bytes.Equal(frame, echoed) {
		t.Fatal("WebSocket traffic was blocked by default preparation", err)
	}
	if os.Getenv("PIWORK_TEST_STARTUP_BROWSER") == "1" {
		if nodeErr != nil {
			t.Fatal("Node is required for the browser integration", nodeErr)
		}
		server := httptest.NewUnstartedServer(nil)
		origin := "http://" + server.Listener.Addr().String()
		web, err := webapp.New(ctx, webapp.Options{Origin: origin, CoreURL: base, SetupSecret: "startup-test", DataDirectory: directory})
		if err != nil {
			server.Close()
			t.Fatal(err)
		}
		server.Config.Handler = web
		server.Start()
		defer server.Close()
		defer web.Close()
		script := filepath.Join("..", "..", "apps", "desktop-webui", "test", "startup-partial-real-core.mjs")
		command := exec.CommandContext(ctx, node, script, origin, workID, serviceID)
		output, err := command.CombinedOutput()
		if err != nil {
			t.Fatalf("browser integration: %v\n%s", err, output)
		}
		t.Log(strings.TrimSpace(string(output)))
	}
}

func TestNativeServiceGatewayAndPublicReadParity(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	script := `const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto');const file='/var/data/workspace/gateway-counter.txt';console.log('password=application-secret');const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}if(req.url==='/events'){res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\n\n');return;}if(req.url.startsWith('/echo')){const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{res.setHeader('set-cookie',['app=ok; Path=/','theme=light']);res.end(JSON.stringify({path:req.url,host:req.headers.host,authorization:req.headers.authorization,cookie:req.headers.cookie,platform:req.headers['x-piwork-gateway-token']||null,body:Buffer.concat(chunks).toString('hex')}));});return;}let n=fs.existsSync(file)?Number(fs.readFileSync(file,'utf8')):0;fs.writeFileSync(file,String(++n));res.end(JSON.stringify({count:n}));});server.on('upgrade',(req,socket,head)=>{const key=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: '+key+'\r\n\r\n');if(head.length)socket.write(head);socket.on('data',c=>socket.write(c));});server.listen(8099,'0.0.0.0');process.on('SIGTERM',()=>{server.closeAllConnections();server.close(()=>process.exit(0));});`
	definition := map[string]any{"name": "gateway", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "mounts": []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}}, "workingDirectory": "/var/data/workspace", "ports": []any{map[string]any{"name": "web", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "web", "path": "/health", "deadlineMs": 10000}}
	path := "/api/v1/works/" + workID
	start := time.Now()
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "gateway-create"})
	if status != 202 || time.Since(start) > time.Second {
		t.Fatal("deployment acceptance waited for readiness", status, accepted, time.Since(start))
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	serviceID := accepted["serviceId"].(string)
	status, view := packageHTTPCall(t, base, path+"/services/"+serviceID, "GET", auth, nil)
	if status != 200 {
		t.Fatal(status, view)
	}
	access := view["access"].(map[string]any)
	hostname := access["hostname"].(string)
	gatewayPath := "/api/v1/service-gateway/" + hostname + "/80"
	token := strings.TrimPrefix(auth, "Bearer ")
	response := gatewayRequest(t, base, token, gatewayPath+"/echo?q=%2f&q=%252e", []byte{0, 255, 7}, http.Header{"Authorization": {"Bearer application-token"}, "Cookie": {"app=session"}})
	var echo map[string]any
	if err := json.NewDecoder(response.Body).Decode(&echo); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || echo["path"] != "/echo?q=%2f&q=%252e" || echo["host"] != hostname || echo["authorization"] != "Bearer application-token" || echo["cookie"] != "app=session" || echo["platform"] != nil || echo["body"] != "00ff07" || len(response.Header.Values("Set-Cookie")) != 2 {
		t.Fatal("native forwarding", echo, response.Header)
	}
	count := func(want float64) {
		t.Helper()
		response := gatewayRequest(t, base, token, gatewayPath+"/", nil, nil)
		var body map[string]any
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body["count"] != want {
			t.Fatal("native gateway persistent counter", body, err)
		}
	}
	count(1)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	config, err := a.agentTLS.ServiceClientConfig(ctx, internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance})
	if err != nil {
		t.Fatal(err)
	}
	connection, err := grpc.NewClient(net.JoinHostPort("127.0.0.1", strconv.Itoa(a.serviceListener.Addr().(*net.TCPAddr).Port)), grpc.WithTransportCredentials(credentials.NewTLS(config)))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	rpc := servicesv1.NewWorkServicesClient(connection)
	rpcView, err := rpc.GetService(ctx, &servicesv1.ServiceIdRequest{ServiceId: serviceID})
	if err != nil {
		t.Fatal(err)
	}
	if rpcView.Access.Hostname != hostname || rpcView.Access.Status != access["status"] || rpcView.Access.GetDefaultUrl() != access["defaultUrl"] || rpcView.Definition.Name != view["name"] || rpcView.DesiredRevision != 1 || rpcView.AppliedRevision == nil || *rpcView.AppliedRevision != 1 || len(rpcView.Endpoints) != 1 || rpcView.Endpoints[0].Host != "svc-gateway" {
		t.Fatal("HTTP and mTLS RPC projections differ", rpcView, view)
	}
	status, logs := packageHTTPCall(t, base, path+"/services/"+serviceID+"/logs", "GET", auth, nil)
	if status != 200 || logs["status"] != "available" || strings.Contains(logs["text"].(string), "application-secret") || !strings.Contains(logs["text"].(string), "[redacted]") {
		t.Fatal("unsafe bounded logs", status, logs)
	}
	rpcLogs, err := rpc.ReadServiceLogs(ctx, &servicesv1.ReadServiceLogsRequest{ServiceId: serviceID, TailLines: 100})
	if err != nil || rpcLogs.Text != logs["text"] || rpcLogs.Status != logs["status"] {
		t.Fatal("HTTP and RPC logs differ", rpcLogs, err)
	}
	_, err = a.Identity.CreateUser(ctx, identity.OperatorPrincipal(), "foreignadmin", "development-fixture-pass", "admin")
	if err != nil {
		t.Fatal(err)
	}
	other, err := a.Identity.Login(ctx, "foreignadmin", "development-fixture-pass", "other")
	if err != nil {
		t.Fatal(err)
	}
	status, _ = packageHTTPCall(t, base, path+"/services/"+serviceID, "GET", "Bearer "+other.Token, nil)
	if status != 200 {
		t.Fatal("admin metadata unavailable", status)
	}
	status, _ = packageHTTPCall(t, base, path+"/services/"+serviceID+"/logs", "GET", "Bearer "+other.Token, nil)
	if status != 403 {
		t.Fatal("admin read another owner's logs", status)
	}
	start = time.Now()
	events := gatewayRequest(t, base, token, gatewayPath+"/events", nil, nil)
	reader := bufio.NewReader(events.Body)
	line, err := reader.ReadString('\n')
	if err != nil || line != "data: first\n" || time.Since(start) > time.Second {
		t.Fatal("native SSE buffering", line, err)
	}
	conn, err := net.DialTimeout("tcp", strings.TrimPrefix(base, "http://"), time.Second)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(5 * time.Second))
	frame := []byte{0x81, 0x82, 1, 2, 3, 4, 'h' ^ 1, 'i' ^ 2}
	request := "GET " + gatewayPath + "/socket HTTP/1.1\r\nHost: " + strings.TrimPrefix(base, "http://") + "\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: aGVsbG8=\r\nSec-WebSocket-Version: 13\r\n" + gatewayCredential + ": " + token + "\r\n\r\n"
	conn.Write(append([]byte(request), frame...))
	wsReader := bufio.NewReader(conn)
	upgrade, err := http.ReadResponse(wsReader, nil)
	if err != nil || upgrade.StatusCode != 101 {
		t.Fatal("native WebSocket upgrade", upgrade, err)
	}
	echoed := make([]byte, len(frame))
	if _, err := io.ReadFull(wsReader, echoed); err != nil || !bytes.Equal(frame, echoed) {
		t.Fatal("native buffered frame", echoed, err)
	}
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "gateway-stop"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	start = time.Now()
	_, err = io.ReadAll(reader)
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatal("native Work stop retained SSE", err, time.Since(start))
	}
	start = time.Now()
	_, err = wsReader.ReadByte()
	if err == nil || time.Since(start) > 2*time.Second {
		t.Fatal("native Work stop retained WebSocket", err, time.Since(start))
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	status, started := packageHTTPCall(t, base, path+"/start", "POST", auth, map[string]string{"idempotencyKey": "gateway-start"})
	if status != 202 {
		t.Fatal(status, started)
	}
	waitWorkOperation(t, ctx, a, started["operationId"].(string))
	count(2)
	t.Log("real Docker service: Core gateway HTTP/SSE/WebSocket, persisted counter, owner-only logs, mTLS read parity and Work stop revocation passed")
}
