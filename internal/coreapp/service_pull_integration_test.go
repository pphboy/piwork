//go:build integration

package coreapp

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
)

func TestNativeServiceSlowPullAcceptanceStopAndShutdown(t *testing.T) {
	upstream := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if upstream == "" {
		upstream = "unix:///var/run/docker.sock"
	}
	if !strings.HasPrefix(upstream, "unix://") {
		t.Fatal("Unix Engine required")
	}
	socketDirectory, err := os.MkdirTemp("/tmp", "piwork-engine-fixture-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(socketDirectory) })
	socket := filepath.Join(socketDirectory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	transport := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", strings.TrimPrefix(upstream, "unix://"))
	}}
	proxy := &httputil.ReverseProxy{Transport: transport, Rewrite: func(r *httputil.ProxyRequest) { r.Out.URL.Scheme = "http"; r.Out.URL.Host = "engine" }}
	pulls := make(chan struct{}, 2)
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/images/create") && strings.HasPrefix(r.URL.Query().Get("fromImage"), "invalid.example/") {
			pulls <- struct{}{}
			<-r.Context().Done()
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(503)
			io.WriteString(w, `{"error":"fixture pull interrupted"}`)
			return
		}
		proxy.ServeHTTP(w, r)
	})}
	go server.Serve(listener)
	t.Cleanup(func() { server.Close(); transport.CloseIdleConnections() })
	t.Setenv("PIWORK_TEST_DOCKER_HOST", "unix://"+socket)
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	definition := map[string]any{"name": "pull", "image": map[string]string{"reference": "invalid.example/piwork-fixture:latest"}, "command": "app", "workingDirectory": "/"}
	start := time.Now()
	status, accepted := packageHTTPCall(t, base, path+"/services", "POST", auth, map[string]any{"definition": definition, "idempotencyKey": "slow-pull"})
	if status != 202 || time.Since(start) > time.Second {
		t.Fatal("HTTP acceptance waited for image pull", status, accepted, time.Since(start))
	}
	select {
	case <-pulls:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	status, stopped := packageHTTPCall(t, base, path+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-image-pull"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	operation, err := a.Store.Operation(ctx, accepted["operationId"].(string))
	if err != nil || operation.State != "superseded" {
		t.Fatal("pull completion escaped Work stop", operation.State, err)
	}
	status, removed := packageHTTPCall(t, base, path+"/services/"+accepted["serviceId"].(string)+"/remove", "POST", auth, map[string]string{"idempotencyKey": "remove-pull"})
	if status != 202 {
		t.Fatal(status, removed)
	}
	waitWorkOperation(t, ctx, a, removed["operationId"].(string))
	status, started := packageHTTPCall(t, base, path+"/start", "POST", auth, map[string]string{"idempotencyKey": "restart-after-pull"})
	if status != 202 {
		t.Fatal(status, started)
	}
	waitWorkOperation(t, ctx, a, started["operationId"].(string))
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
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	start = time.Now()
	rpcAccepted, err := servicesv1.NewWorkServicesClient(connection).CreateService(call, &servicesv1.CreateServiceRequest{IdempotencyKey: "rpc-slow-pull", Definition: &servicesv1.ServiceDefinition{Name: "rpcpull", Image: &servicesv1.ServiceImage{Reference: "invalid.example/piwork-fixture:latest"}, Command: "app", WorkingDirectory: "/", CpuMillis: 250, MemoryBytes: 128 << 20, Enabled: true, RestartPolicy: "bounded"}})
	cancel()
	if err != nil || rpcAccepted == nil || time.Since(start) > time.Second {
		t.Fatal("mTLS tool acceptance waited for image pull", rpcAccepted, err, time.Since(start))
	}
	select {
	case <-pulls:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	closeCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	start = time.Now()
	err = a.Close(closeCtx)
	cancel()
	if err != nil || time.Since(start) > 30*time.Second {
		t.Fatal("Core shutdown did not cancel Service pull", err, time.Since(start))
	}
	t.Log("HTTP and mTLS acceptance return while pull is blocked; Work Stop and Core Close cancel it without creating a container")
}
