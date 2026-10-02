//go:build integration

package coreapp

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
)

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
