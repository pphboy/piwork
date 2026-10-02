//go:build integration

package dockerengine

import (
	"context"
	"encoding/json"
	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/api/types/mount"
	"github.com/moby/moby/api/types/network"
	"github.com/moby/moby/client"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"net"
	"os"
	"path/filepath"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/testsupport"
	goruntime "runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// Runs the real TS MCP stdio client and native Go subprocess in the retained
// image, against an authenticated Go protocol fixture (not a business Core).
func TestRealTSMCPClientNativeStdioAndCoreMutualTLS(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "no-host-tools"))
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	endpoint, err := SelectEndpoint(SelectionOptions{DockerHost: host, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	scope, err := testsupport.NewScope()
	if err != nil {
		t.Fatal(err)
	}
	t.Log("MCP installation:", scope.ID())
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := scope.Cleanup(ctx, engine.api); err != nil {
			t.Error(err)
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	image, nativeImage := migrationAgentImage(t, engine, ctx)
	store, err := corestore.Open(ctx, corestore.Options{Directory: t.TempDir(), InstallationID: scope.ID()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager, err := internaltls.Open(filepath.Join(t.TempDir(), "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	identity := internaltls.Scope{InstallationID: scope.ID(), WorkID: "work-mcp-fixture", Generation: 1, InstanceID: "agent-mcp-fixture"}
	certs, err := manager.EnsureGeneration(ctx, identity)
	if err != nil {
		t.Fatal(err)
	}
	tlsConfig, err := manager.CoreServerConfig(ctx, func(candidate internaltls.Scope) bool { return candidate == identity })
	if err != nil {
		t.Fatal(err)
	}
	labels, _ := scope.Labels()
	bridge, err := engine.api.NetworkCreate(ctx, scope.ID()+"-mcp", client.NetworkCreateOptions{Driver: "bridge", Labels: labels})
	if err != nil {
		t.Fatal(err)
	}
	view, err := engine.api.NetworkInspect(ctx, bridge.ID, client.NetworkInspectOptions{})
	if err != nil || len(view.Network.IPAM.Config) != 1 {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(view.Network.IPAM.Config[0].Gateway.String(), "0"))
	if err != nil {
		t.Fatal(err)
	}
	_, source, _, _ := goruntime.Caller(0)
	repository := filepath.Join(filepath.Dir(source), "..", "..")
	binary := filepath.Join(repository, "dist/go/piwork-service-mcp")
	if _, err := os.Stat(binary); !nativeImage && err != nil {
		t.Fatal("make build-go required", err)
	}
	fixtureBytes, err := os.ReadFile(filepath.Join(repository, "internal/servicemcp/testdata/ts-contracts.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Cases []struct {
			Name    string
			Args    json.RawMessage
			Request struct{ Method string }
			Result  struct{ StructuredContent json.RawMessage }
		}
	}
	if json.Unmarshal(fixtureBytes, &fixture) != nil {
		t.Fatal("invalid MCP oracle")
	}
	responses := map[string]json.RawMessage{}
	for _, item := range fixture.Cases {
		method := strings.ToUpper(item.Request.Method[:1]) + item.Request.Method[1:]
		responses[method] = item.Result.StructuredContent
	}
	var mutex sync.Mutex
	count := map[string]int{}
	lostKeys := []string{}
	blockedCalled := false
	rpc := grpc.NewServer(grpc.Creds(credentials.NewTLS(tlsConfig)), grpc.ChainUnaryInterceptor(internaltls.ServiceUnaryInterceptor(scope.ID(), func(candidate internaltls.Scope) bool { return candidate == identity }), func(ctx context.Context, request any, info *grpc.UnaryServerInfo, _ grpc.UnaryHandler) (any, error) {
		if principal, ok := internaltls.ServicePrincipal(ctx); !ok || principal != identity {
			return nil, status.Error(codes.Unauthenticated, "bad fixture principal")
		}
		method := info.FullMethod[strings.LastIndex(info.FullMethod, "/")+1:]
		mutex.Lock()
		count[method]++
		mutex.Unlock()
		if request, ok := request.(*servicesv1.CreateServiceRequest); ok && request.IdempotencyKey == "lost-response" {
			mutex.Lock()
			lostKeys = append(lostKeys, request.IdempotencyKey)
			first := len(lostKeys) == 1
			mutex.Unlock()
			if first {
				return nil, status.Error(codes.Unavailable, "private credential /core/private/fixture")
			}
		}
		if request, ok := request.(*servicesv1.ServiceIdRequest); ok && request.ServiceId == "blocked" {
			mutex.Lock()
			blockedCalled = true
			mutex.Unlock()
			<-ctx.Done()
			return nil, status.Error(codes.Canceled, "private interrupted request")
		}
		var response proto.Message
		switch method {
		case "GetDeploymentContext":
			response = &servicesv1.DeploymentContext{}
		case "ListServices":
			response = &servicesv1.ListServicesResponse{}
		case "GetService":
			response = &servicesv1.ServiceView{}
		case "GetOperation":
			response = &servicesv1.OperationView{}
		case "ReadServiceLogs":
			response = &servicesv1.ServiceLogs{}
		default:
			response = &servicesv1.Acceptance{}
		}
		if err := protojson.Unmarshal(responses[method], response); err != nil {
			return nil, status.Error(codes.Internal, "invalid fixture")
		}
		return response, nil
	}))
	servicesv1.RegisterWorkServicesServer(rpc, &servicesv1.UnimplementedWorkServicesServer{})
	go rpc.Serve(listener)
	defer rpc.Stop()
	config, err := manager.WriteServiceControlConfig(ctx, identity, listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	script := `import assert from 'node:assert/strict';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';const fixture=` + string(fixtureBytes) + `;const transport=new StdioClientTransport({command:'/usr/local/bin/piwork-service-mcp',stderr:'pipe'});let diagnostic='';transport.stderr?.on('data',chunk=>diagnostic+=chunk);const client=new Client({name:'retained-ts-mcp-fixture',version:'1'});await client.connect(transport);const tools=(await client.listTools()).tools;assert.equal(tools.length,12);for(const tool of tools){assert.equal(tool.inputSchema.additionalProperties,false);}for(const item of fixture.cases){const result=await client.callTool({name:item.name,arguments:item.args});assert.ok(!result.isError,JSON.stringify(result));assert.deepEqual(result.structuredContent,item.result.structuredContent);assert.deepEqual(JSON.parse(result.content[0].text),result.structuredContent);} `
	script += `const invalid=await client.callTool({name:'deployment_context',arguments:{workId:'work-other'}});assert.equal(invalid.isError,true);const create={definition:{name:'counter',image:{reference:'python:3.13-slim'},command:'python3'},idempotencyKey:'lost-response'};const lost=await client.callTool({name:'service_create',arguments:create});assert.equal(lost.isError,true);assert.ok(!JSON.stringify(lost).includes('private'));const retry=await client.callTool({name:'service_create',arguments:create});assert.equal(retry.structuredContent.operationId,'operation-fixture');const pending=client.callTool({name:'service_get',arguments:{serviceId:'blocked'}}).catch(()=>null);await new Promise(resolve=>setTimeout(resolve,300));const started=performance.now();await client.close();await pending;const shutdownMs=performance.now()-started;assert.ok(shutdownMs<5000);assert.equal(diagnostic,'');console.log(JSON.stringify({tools:tools.length,cases:fixture.cases.length,shutdownMs,lostKey:create.idempotencyKey}));`
	scriptPath := filepath.Join(t.TempDir(), "fixture.mjs")
	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		t.Fatal(err)
	}
	mounts := []mount.Mount{}
	for source, target := range map[string]string{binary: "/usr/local/bin/piwork-service-mcp", config: "/etc/piwork/service-control.json", certs.CACertificatePath: "/etc/piwork/control/installation-ca.crt", certs.ServiceClientCertificatePath: "/etc/piwork/control/agent-service-client.crt", certs.ServiceClientPrivateKeyPath: "/etc/piwork/control/agent-service-client.key", scriptPath: "/workspace/native-mcp-fixture.mjs"} {
		if nativeImage && target == "/usr/local/bin/piwork-service-mcp" {
			continue
		}
		mounts = append(mounts, mount.Mount{Type: mount.TypeBind, Source: source, Target: target, ReadOnly: true})
	}
	pids := int64(128)
	created, err := engine.api.ContainerCreate(ctx, client.ContainerCreateOptions{Name: scope.ID() + "-mcp-client", Config: &container.Config{Image: image.ID, User: "10001:10001", Entrypoint: []string{"node"}, Cmd: []string{"/workspace/native-mcp-fixture.mjs"}, WorkingDir: "/workspace", Labels: labels}, HostConfig: &container.HostConfig{ReadonlyRootfs: true, CapDrop: []string{"ALL"}, SecurityOpt: []string{"no-new-privileges:true"}, NetworkMode: container.NetworkMode(bridge.ID), Mounts: mounts, Resources: container.Resources{Memory: 512 << 20, NanoCPUs: 1e9, PidsLimit: &pids}}, NetworkingConfig: &network.NetworkingConfig{EndpointsConfig: map[string]*network.EndpointSettings{bridge.ID: {}}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.api.ContainerStart(ctx, created.ID, client.ContainerStartOptions{}); err != nil {
		t.Fatal(err)
	}
	var exit int
	for {
		view, err := engine.api.ContainerInspect(ctx, created.ID, client.ContainerInspectOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if !view.Container.State.Running {
			exit = view.Container.State.ExitCode
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("MCP fixture did not stop", ctx.Err())
		case <-time.After(25 * time.Millisecond):
		}
	}
	logs, err := engine.api.ContainerLogs(ctx, created.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Tail: "100"})
	if err != nil {
		t.Fatal(err)
	}
	defer logs.Close()
	output, diagnostic := newTail(65536), newTail(65536)
	if Demultiplex(ctx, logs, output, diagnostic) != nil {
		t.Fatal("fixture log stream failed")
	}
	if exit != 0 || len(diagnostic.bytes) != 0 {
		t.Fatal("actual TS/Go MCP fixture failed", exit, string(diagnostic.bytes), string(output.bytes))
	}
	mutex.Lock()
	defer mutex.Unlock()
	for _, method := range []string{"GetDeploymentContext", "CreateService", "ListServices", "GetService", "UpdateService", "StartService", "StopService", "RestartService", "RemoveService", "RetryService", "GetOperation", "ReadServiceLogs"} {
		if count[method] == 0 {
			t.Fatal("RPC missing", method)
		}
	}
	if len(lostKeys) != 2 || lostKeys[0] != lostKeys[1] || !blockedCalled {
		t.Fatal("lost key or cancellation behavior differs", lostKeys, blockedCalled)
	}
	t.Log("real TS stdio client result:", string(output.bytes))
}
