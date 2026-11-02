package workruntime

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"piwork/internal/agentclient"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type shutdownDrainServer struct {
	agentv1.UnimplementedAgentServiceServer
	requests chan *agentv1.DrainRequest
}

func (s *shutdownDrainServer) Drain(_ context.Context, request *agentv1.DrainRequest) (*agentv1.DrainResponse, error) {
	s.requests <- request
	return &agentv1.DrainResponse{Drained: false}, nil
}

func TestDetachedShutdownRouteDrainsRealClientAfterAdmissionCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	addresses, err := net.InterfaceAddrs()
	if err != nil {
		t.Fatal(err)
	}
	var address string
	for _, candidate := range addresses {
		network, ok := candidate.(*net.IPNet)
		if ok && network.IP.To4() != nil && !network.IP.IsLoopback() && network.IP.IsGlobalUnicast() {
			address = network.IP.String()
			break
		}
	}
	if address == "" {
		t.Fatal("no local non-loopback IPv4 for actual Agent client contract")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(address, "7443"))
	if err != nil {
		t.Fatal("actual Agent transport listener unavailable", err)
	}
	defer listener.Close()
	store, err := corestore.Open(ctx, corestore.Options{Directory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	manager, err := internaltls.Open(filepath.Join(t.TempDir(), "runtime"), store)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	scope := internaltls.Scope{InstallationID: store.InstallationID(), WorkID: "work-shutdown", Generation: 7, InstanceID: "instance-shutdown"}
	identity, err := manager.EnsureGeneration(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := tls.LoadX509KeyPair(identity.ServerCertificatePath, identity.ServerPrivateKeyPath)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := os.ReadFile(identity.CACertificatePath)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		t.Fatal("invalid fixture CA")
	}
	server := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert})))
	rpc := &shutdownDrainServer{requests: make(chan *agentv1.DrainRequest, 1)}
	agentv1.RegisterAgentServiceServer(server, rpc)
	defer server.Stop()
	go func() { _ = server.Serve(listener) }()
	applicationCtx, cancelApplication := context.WithCancel(ctx)
	client, err := agentclient.Open(applicationCtx, manager, scope, address)
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	lifetime, cancelAdmission := context.WithCancel(context.Background())
	routes := &Routes{works: map[string]route{scope.WorkID: {scope: scope, contextID: "context-shutdown", client: client, lifetime: lifetime, cancel: cancelAdmission}}}
	retained := routes.DetachForShutdown()
	cancelApplication()
	if lifetime.Err() != context.Canceled {
		t.Fatal("old admission remained live")
	}
	if _, _, err := routes.Admission(scope, "context-shutdown"); err != ErrRouteUnavailable {
		t.Fatal("new admission survived shutdown", err)
	}
	original, ok := retained[scope.WorkID]
	if !ok || original.Scope != scope || original.ContextID != "context-shutdown" {
		t.Fatal("shutdown lost original transport")
	}
	drained, err := original.Client.Drain(ctx, 30*time.Second)
	if err != nil || drained {
		t.Fatal("detached transport lost actual unconfirmed receipt", drained, err)
	}
	select {
	case request := <-rpc.requests:
		if request.WorkId != scope.WorkID || request.Generation != 7 || request.InstanceId != scope.InstanceID || request.TimeoutMs != 30000 {
			t.Fatal("drain changed original runtime or budget", request)
		}
	default:
		t.Fatal("actual drain RPC was not received")
	}
	if err := original.Client.Close(); err != nil {
		t.Fatal(err)
	}
	if drained, err := original.Client.Drain(ctx, 30*time.Second); err == nil || drained {
		t.Fatal("closed shutdown transport remained usable")
	}
}
