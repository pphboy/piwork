//go:build integration

package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"piwork/internal/internaltls"
)

func TestNativeServiceInteractionIdentityAndDurableEventReplay(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	login, err := a.Identity.Authenticate(ctx, strings.TrimPrefix(auth, "Bearer "))
	if err != nil {
		t.Fatal(err)
	}
	principal := login.Principal()
	owner := serviceActor{User: &principal}
	script := `const fs=require('node:fs'),http=require('node:http'),https=require('node:https');
const c=JSON.parse(fs.readFileSync('/etc/piwork/interaction/config.json','utf8'));
fs.mkdirSync('/var/data/workspace/.pi/services',{recursive:true});fs.writeFileSync('/var/data/workspace/.pi/services/observer.json',JSON.stringify({contractVersion:1,serviceName:'observer',apiPortName:'api',mode:'pi-managed'}));
const file='/var/data/workspace/observer-outbox.json';
if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify({contractVersion:1,eventId:'native-page-event',origin:{workId:c.workId,serviceId:c.serviceId},serviceName:c.serviceName,type:'page.visited',occurredAt:new Date().toISOString(),stateVersion:'v1',actor:'user',payload:{pathname:'/review?token=must-not-store#fragment'}}));
let queries=0;
http.createServer((req,res)=>{res.setHeader('content-type','application/json');
if(req.url==='/health'){res.end('{}');return;}
if(req.url==='/stats'){res.end(JSON.stringify({queries}));return;}
if(req.url==='/pi/v1/capabilities'){if(req.headers.authorization!=='Bearer '+c.token){res.writeHead(401);res.end('{}');return;}queries++;res.end(JSON.stringify({contractVersion:1,logicalServiceName:'observer',codeVersion:'code1',stateVersion:'v1',queries:{},actions:{},events:{facts:['page.visited'],requestReasons:[]},jobs:false}));return;}
if(req.url==='/emit'){let chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{const override=JSON.parse(Buffer.concat(chunks).toString()||'{}');let event=JSON.parse(fs.readFileSync(file));if(override.origin)event.origin=override.origin;
const u=new URL(c.agentUrl+'/pi/v1/events');let body=JSON.stringify(event);const r=https.request(u,{method:'POST',agent:false,ca:fs.readFileSync(c.caPath),headers:{authorization:'Bearer '+(override.token||c.token),'content-type':'application/json','content-length':Buffer.byteLength(body)}},rr=>{let result=[];rr.on('data',x=>result.push(x));rr.on('end',()=>{res.writeHead(rr.statusCode);res.end(Buffer.concat(result));});});r.on('error',()=>{res.writeHead(503);res.end('{}');});r.end(body);});return;}
res.writeHead(404);res.end('{}');}).listen(8099,'0.0.0.0');`
	raw, _ := json.Marshal(map[string]any{"name": "observer", "image": map[string]string{"reference": a.options.Initialization.Runtime.AgentImage}, "command": "node", "args": []string{"-e", script}, "mounts": []any{map[string]any{"source": "workspace", "target": "/var/data/workspace", "readOnly": false}}, "ports": []any{map[string]any{"name": "api", "protocol": "tcp", "containerPort": 8099}}, "readiness": map[string]any{"kind": "http", "portName": "api", "path": "/health", "deadlineMs": 10000}})
	created, err := a.acceptServiceDefinition(ctx, owner, workID, "", 0, raw, "observer-create")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if a.closed {
			return
		}
		cleanup, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		if err := a.stopServiceRuntime(cleanup, workID, created.ServiceID, true); err != nil {
			t.Error(err)
		}
	})
	process := func(v acceptedServiceOperation) {
		t.Helper()
		op, err := a.Store.Operation(ctx, v.OperationID)
		if err != nil {
			t.Fatal(err)
		}
		if err = a.processServiceOperation(ctx, op); err != nil {
			t.Fatal(err)
		}
		op, err = a.Store.Operation(ctx, v.OperationID)
		if err != nil || op.State != "succeeded" {
			t.Fatal(op.State, op.ErrorJSON, err)
		}
	}
	process(created)
	currentActor := func() serviceActor {
		t.Helper()
		var generation int64
		var instance string
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow("SELECT generation,instance_id FROM runtime_generations WHERE work_id=? AND state='ready' ORDER BY generation DESC LIMIT 1", workID).Scan(&generation, &instance)
		}); err != nil {
			t.Fatal(err)
		}
		scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
		return serviceActor{Runtime: &scope}
	}
	identity := func() serviceInteractionIdentity {
		t.Helper()
		var v serviceInteractionIdentity
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			v, err = readInteractionIdentity(tx, workID, created.ServiceID)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return v
	}
	emit := func(body any) (int, map[string]any) {
		t.Helper()
		network, err := a.dockerRuntime.EnsureNetwork(ctx, workID)
		if err != nil {
			t.Fatal(err)
		}
		address, err := a.dockerRuntime.ContainerAddress(ctx, serviceContainerIdentity(workID, created.ServiceID, 0), network.Name)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(body)
		request, err := http.NewRequestWithContext(ctx, "POST", "http://"+address+":8099/emit", strings.NewReader(string(raw)))
		if err != nil {
			t.Fatal(err)
		}
		response, err := http.DefaultClient.Do(request)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		data, _ := io.ReadAll(response.Body)
		var result map[string]any
		if json.Unmarshal(data, &result) != nil {
			t.Fatal(string(data))
		}
		return response.StatusCode, result
	}
	actor := currentActor()
	bindings, err := a.serviceInteractionBindings(ctx, actor, workID)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(bindings)
	if !strings.Contains(string(encoded), identity().Token) {
		t.Fatal("current private authority missing")
	}
	if _, err := a.serviceInteractionBindings(ctx, owner, workID); err == nil {
		t.Fatal("user read private bindings")
	}
	status, receipt := emit(map[string]any{})
	if status != 201 || receipt["requestId"] != nil {
		t.Fatal(status, receipt)
	}
	if status, result := emit(map[string]any{}); status != 200 || result["reused"] != true {
		t.Fatal(status, result)
	}
	if status, _ := emit(map[string]any{"origin": map[string]string{"workId": workID, "serviceId": "service-foreign-1111111111"}}); status != 409 {
		t.Fatal("cross Service accepted", status)
	}
	if status, _ := emit(map[string]any{"origin": map[string]string{"workId": "work-foreign-111111111", "serviceId": created.ServiceID}}); status != 409 {
		t.Fatal("cross Work accepted", status)
	}
	first := identity()
	restart, err := a.acceptServiceAction(ctx, owner, workID, created.ServiceID, "restart", "observer-restart")
	if err != nil {
		t.Fatal(err)
	}
	process(restart)
	second := identity()
	if first.Token == second.Token || first.ContainerID == second.ContainerID || first.ServiceID != second.ServiceID {
		t.Fatal("incorrect restart identity")
	}
	if status, _ := emit(map[string]any{"token": first.Token}); status != 401 {
		t.Fatal("old instance token accepted", status)
	}
	if status, result := emit(map[string]any{}); status != 200 || result["reused"] != true {
		t.Fatal("same entity outbox was not deduplicated", status, result)
	}
	path := "/api/v1/works/" + workID
	if status, _ := packageHTTPCall(t, base, path+"/configuration/agents", "PUT", auth, map[string]any{"agentsMd": "# Agent-only Apply identity test"}); status != 200 {
		t.Fatal(status)
	}
	status, accepted := packageHTTPCall(t, base, path+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "observer-apply"})
	if status != 202 {
		t.Fatal(status, accepted)
	}
	waitWorkOperation(t, ctx, a, accepted["operationId"].(string))
	if identity() != second {
		t.Fatal("Agent Apply replaced running Service identity")
	}
	if status, result := emit(map[string]any{}); status != 200 || result["reused"] != true {
		t.Fatal("Apply lost original receipt", status, result)
	}
	if _, err := a.serviceInteractionBindings(ctx, actor, workID); err == nil {
		t.Fatal("previous Agent generation read private identity")
	}
	client, _, err := a.agentRoutes.Admission(*currentActor().Runtime, *func() *string {
		work, err := a.Store.Work(ctx, workID, false)
		if err != nil {
			t.Fatal(err)
		}
		return work.ActiveContextID
	}())
	if err != nil {
		t.Fatal(err)
	}
	sessions, err := client.ListSessions(ctx, 100, "")
	if err != nil || len(sessions.Sessions) != 0 {
		t.Fatal("ordinary fact triggered a model", sessions, err)
	}
	if err := a.stopServiceRuntime(ctx, workID, created.ServiceID, false); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		_, err := readInteractionIdentity(tx, workID, created.ServiceID)
		if !errors.Is(err, sql.ErrNoRows) {
			return errors.New("stopped identity retained")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	t.Log("Go-owned exact Service identities, verified private round trip, durable scoped fact receipt, rotated token/outbox replay, Agent Apply and revocation passed")
}
