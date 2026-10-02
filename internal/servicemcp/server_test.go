package servicemcp

import (
	"context"
	"encoding/json"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"net"
	"os"
	"piwork/internal/rpc/servicesv1"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

type mcpFixture struct {
	Cases []struct {
		Name    string
		Args    json.RawMessage
		Request struct {
			Method  string
			Request json.RawMessage
		}
		Result struct {
			Content           []struct{ Type, Text string }
			StructuredContent json.RawMessage
		}
	}
}

func frozen(t *testing.T) mcpFixture {
	t.Helper()
	raw, err := os.ReadFile("testdata/ts-contracts.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture mcpFixture
	if json.Unmarshal(raw, &fixture) != nil {
		t.Fatal("invalid fixture")
	}
	return fixture
}
func responseForMethod(method string) proto.Message {
	switch method {
	case "GetDeploymentContext":
		return &servicesv1.DeploymentContext{}
	case "ListServices":
		return &servicesv1.ListServicesResponse{}
	case "GetService":
		return &servicesv1.ServiceView{}
	case "GetOperation":
		return &servicesv1.OperationView{}
	case "ReadServiceLogs":
		return &servicesv1.ServiceLogs{}
	default:
		return &servicesv1.Acceptance{}
	}
}

func TestMCPToolsDefaultsRPCAndJSONProjectionMatchTS(t *testing.T) {
	fixture := frozen(t)
	listener := bufconn.Listen(1 << 20)
	var mu sync.Mutex
	var current int
	var recorded proto.Message
	var method string
	var remaining time.Duration
	rpc := grpc.NewServer(grpc.UnaryInterceptor(func(ctx context.Context, request any, info *grpc.UnaryServerInfo, _ grpc.UnaryHandler) (any, error) {
		mu.Lock()
		defer mu.Unlock()
		recorded = proto.Clone(request.(proto.Message))
		method = info.FullMethod[strings.LastIndex(info.FullMethod, "/")+1:]
		deadline, _ := ctx.Deadline()
		remaining = time.Until(deadline)
		response := responseForMethod(method)
		if err := protojson.Unmarshal(fixture.Cases[current].Result.StructuredContent, response); err != nil {
			t.Error(err)
		}
		return response, nil
	}))
	servicesv1.RegisterWorkServicesServer(rpc, &servicesv1.UnimplementedWorkServicesServer{})
	go rpc.Serve(listener)
	defer rpc.Stop()
	connection, err := grpc.NewClient("passthrough:///fixture", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	server, err := NewServer(servicesv1.NewWorkServicesClient(connection))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	session, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer session.Close()
	client, err := mcp.NewClient(&mcp.Implementation{Name: "go-migration-test", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	listed, err := client.ListTools(ctx, nil)
	if err != nil || len(listed.Tools) != 12 {
		t.Fatal("discovery failed", err)
	}
	var expected []toolDefinition
	if json.Unmarshal(toolBytes, &expected) != nil {
		t.Fatal("invalid tool declarations")
	}
	names := []string{}
	for _, tool := range listed.Tools {
		names = append(names, tool.Name)
		raw, _ := json.Marshal(tool.InputSchema)
		var schema map[string]any
		if json.Unmarshal(raw, &schema) != nil || schema["additionalProperties"] != false {
			t.Fatal("tool root is not strict", tool.Name)
		}
	}
	expectedNames := []string{}
	for _, tool := range expected {
		expectedNames = append(expectedNames, tool.Name)
	}
	sort.Strings(expectedNames)
	if !reflect.DeepEqual(names, expectedNames) {
		t.Fatal("tools differ", names)
	}
	for index, item := range fixture.Cases {
		t.Run(item.Name, func(t *testing.T) {
			mu.Lock()
			current = index
			recorded = nil
			mu.Unlock()
			result, err := client.CallTool(ctx, &mcp.CallToolParams{Name: item.Name, Arguments: item.Args})
			if err != nil || result.IsError {
				t.Fatal("tool call failed", err, result)
			}
			mu.Lock()
			request, requestMethod, deadline := recorded, method, remaining
			mu.Unlock()
			if request == nil {
				t.Fatal("tool did not reach typed gRPC")
			}
			expectedMethod := strings.ToUpper(item.Request.Method[:1]) + item.Request.Method[1:]
			if requestMethod != expectedMethod {
				t.Fatal("wrong RPC", requestMethod)
			}
			raw, err := (protojson.MarshalOptions{EmitDefaultValues: true}).Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			var got, want any
			if json.Unmarshal(raw, &got) != nil || json.Unmarshal(item.Request.Request, &want) != nil || !reflect.DeepEqual(got, want) {
				t.Fatal("request/defaults differ", string(raw), string(item.Request.Request))
			}
			if deadline <= 0 || deadline > 10*time.Second {
				t.Fatal("RPC has no bounded deadline", deadline)
			}
			if len(result.Content) != 1 {
				t.Fatal("text result missing")
			}
			text, ok := result.Content[0].(*mcp.TextContent)
			if !ok {
				t.Fatal("result is not text")
			}
			if json.Unmarshal([]byte(text.Text), &got) != nil || json.Unmarshal(item.Result.StructuredContent, &want) != nil || !reflect.DeepEqual(got, want) {
				t.Fatal("text projection differs", text.Text)
			}
			structured, err := json.Marshal(result.StructuredContent)
			if err != nil {
				t.Fatal(err)
			}
			if json.Unmarshal(structured, &got) != nil || !reflect.DeepEqual(got, want) {
				t.Fatal("structuredContent differs", string(structured))
			}
		})
	}
	// Reject unknown/forged platform identity, missing mutation key, unsafe JSON
	// integers and strict nested inputs before any RPC can be sent.
	invalid := []struct {
		name string
		args json.RawMessage
	}{
		{"deployment_context", []byte(`{"workId":"work-other"}`)},
		{"service_create", []byte(`{"definition":{"name":"demo","command":"python","image":{"reference":"python","dockerId":"private"}},"idempotencyKey":"key"}`)},
		{"service_create", []byte(`{"definition":{"name":"demo","command":"python","image":{"reference":"python"}}}`)},
		{"service_logs", []byte(`{"serviceId":"one","tailLines":201}`)},
		{"service_update", []byte(`{"serviceId":"one","expectedRevision":9007199254740992,"definition":{},"idempotencyKey":"key"}`)},
		{"service_get", []byte(`{"serviceId":"one","serviceId":"other"}`)},
		{"service_list", []byte(`null`)},
		{"service_get", mustRaw(t, map[string]string{"serviceId": strings.Repeat("😀", 129)})},
	}
	for _, item := range invalid {
		mu.Lock()
		recorded = nil
		mu.Unlock()
		result, err := client.CallTool(ctx, &mcp.CallToolParams{Name: item.name, Arguments: item.args})
		if err != nil {
			t.Fatal(err)
		}
		if !result.IsError {
			t.Fatal("invalid tool accepted", string(item.args))
		}
		mu.Lock()
		called := recorded != nil
		mu.Unlock()
		if called {
			t.Fatal("invalid tool reached gRPC")
		}
	}
}

func mustRaw(t *testing.T, value any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}
