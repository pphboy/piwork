package servicemcp

import (
	"context"
	"encoding/json"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
	"piwork/internal/rpc/servicesv1"
)

func TestTemporaryModeNegotiatesAndNeverFallsBackToDurableService(t *testing.T) {
	listener := bufconn.Listen(1 << 20)
	var mu sync.Mutex
	supported, creates := false, 0
	var last *servicesv1.CreateTemporaryServiceRequest
	var plainRequest *servicesv1.CreateServiceRequest
	server := grpc.NewServer(grpc.UnaryInterceptor(func(_ context.Context, input any, info *grpc.UnaryServerInfo, _ grpc.UnaryHandler) (any, error) {
		mu.Lock()
		defer mu.Unlock()
		if strings.HasSuffix(info.FullMethod, "/GetDeploymentContext") {
			if supported {
				return &servicesv1.DeploymentContext{RunTemporaryServiceContractVersion: proto.Uint32(1)}, nil
			}
			return &servicesv1.DeploymentContext{}, nil
		}
		if strings.HasSuffix(info.FullMethod, "/CreateTemporaryService") {
			creates++
			last = proto.Clone(input.(proto.Message)).(*servicesv1.CreateTemporaryServiceRequest)
			return &servicesv1.Acceptance{ServiceId: "service-fixture"}, nil
		}
		if strings.HasSuffix(info.FullMethod, "/CreateService") {
			creates++
			plainRequest = proto.Clone(input.(proto.Message)).(*servicesv1.CreateServiceRequest)
			return &servicesv1.Acceptance{ServiceId: "service-fixture"}, nil
		}
		t.Fatalf("unexpected RPC: %s", info.FullMethod)
		return nil, nil
	}))
	servicesv1.RegisterWorkServicesServer(server, &servicesv1.UnimplementedWorkServicesServer{})
	go server.Serve(listener)
	defer server.Stop()
	connection, err := grpc.NewClient("passthrough:///fixture", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	mcpServer, err := NewServer(servicesv1.NewWorkServicesClient(connection))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := mcpServer.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer serverSession.Close()
	client, err := mcp.NewClient(&mcp.Implementation{Name: "temporary-fixture", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	arguments := json.RawMessage(`{"definition":{"name":"probe","command":"node","image":{"reference":"fixture"}},"idempotencyKey":"original-key","temporaryMode":"once"}`)
	owner := mcp.Meta{"piwork.run": map[string]any{"runId": "run-original", "generation": "2", "instanceId": "agent-current", "leaseId": "lease-original"}}
	call := func(args json.RawMessage, meta mcp.Meta) *mcp.CallToolResult {
		t.Helper()
		result, err := client.CallTool(ctx, &mcp.CallToolParams{Name: "service_create", Arguments: args, Meta: meta})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	createCount := func() int { mu.Lock(); defer mu.Unlock(); return creates }
	result := call(arguments, owner)
	if !result.IsError || !strings.Contains(result.Content[0].(*mcp.TextContent).Text, "unavailable") || createCount() != 0 {
		t.Fatal("old Core did not safely reject temporary mode", result)
	}
	mu.Lock()
	supported = true
	mu.Unlock()
	if result = call(arguments, nil); !result.IsError || createCount() != 0 {
		t.Fatal("missing trusted Run was accepted", result)
	}
	forged := json.RawMessage(`{"definition":{"name":"probe","command":"node","image":{"reference":"fixture"}},"idempotencyKey":"original-key","temporaryMode":"once","runId":"run-other"}`)
	if result = call(forged, owner); !result.IsError || createCount() != 0 {
		t.Fatal("model-supplied Run identity was accepted", result)
	}
	if result = call(arguments, owner); result.IsError {
		t.Fatal("negotiated temporary request failed", result)
	}
	mu.Lock()
	captured, count := last, creates
	mu.Unlock()
	if count != 1 || captured.GetTemporary().GetMode() != "once" || captured.GetTemporary().GetRunId() != "run-original" || captured.GetTemporary().GetGeneration() != 2 || captured.GetTemporary().GetInstanceId() != "agent-current" || captured.GetTemporary().GetLeaseId() != "lease-original" {
		t.Fatal("trusted request lost identity", captured)
	}
	mu.Lock()
	supported = false
	mu.Unlock()
	plain := json.RawMessage(`{"definition":{"name":"regular","command":"node","image":{"reference":"fixture"}},"idempotencyKey":"plain-key"}`)
	if result = call(plain, nil); result.IsError {
		t.Fatal("legacy durable create failed", result)
	}
	mu.Lock()
	count, ordinary := creates, plainRequest
	mu.Unlock()
	if count != 2 || ordinary == nil || ordinary.IdempotencyKey != "plain-key" {
		t.Fatal("legacy request did not use the ordinary RPC", ordinary)
	}
}
