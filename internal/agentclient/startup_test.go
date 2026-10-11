package agentclient

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type startupReadinessServer struct {
	agentv1.UnimplementedAgentServiceServer
	scope internaltls.Scope
}

func (s *startupReadinessServer) Readiness(context.Context, *agentv1.ReadinessRequest) (*agentv1.ReadinessResponse, error) {
	return &agentv1.ReadinessResponse{WorkId: s.scope.WorkID, Generation: uint64(s.scope.Generation), InstanceId: s.scope.InstanceID, ProtocolVersion: "v2", ContextContractVersion: 1, PackageContractVersion: 1, RunModelContractVersion: 1, WorkFeedbackContractVersion: 1, WorkHistorySchemaVersion: 5, ContextIdentity: "context-startup-fixture", InitializationComplete: true, AcceptingRuns: true}, nil
}

func TestStartupConfirmsDelayedMutualTLSListenerWithoutSecondBackoff(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
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
	scope := internaltls.Scope{InstallationID: store.InstallationID(), WorkID: "work-startup-fixture", Generation: 1, InstanceID: "agent-startup-fixture"}
	id, err := manager.EnsureGeneration(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := tls.LoadX509KeyPair(id.ServerCertificatePath, id.ServerPrivateKeyPath)
	if err != nil {
		t.Fatal(err)
	}
	ca, err := os.ReadFile(id.CACertificatePath)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(ca) {
		t.Fatal("CA fixture")
	}
	clientConfig, err := manager.AgentClientConfig(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	reserved, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := reserved.Addr().String()
	reserved.Close()
	conn, err := grpc.NewClient(address, grpc.WithTransportCredentials(credentials.NewTLS(clientConfig)), grpc.WithNoProxy())
	if err != nil {
		t.Fatal(err)
	}
	client := &Client{scope: scope, conn: conn, rpc: agentv1.NewAgentServiceClient(conn)}
	defer client.Close()
	server := grpc.NewServer(grpc.Creds(credentials.NewTLS(&tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{certificate}, ClientCAs: pool, ClientAuth: tls.RequireAndVerifyClientCert})))
	agentv1.RegisterAgentServiceServer(server, &startupReadinessServer{scope: scope})
	defer server.Stop()
	listening := make(chan time.Time, 1)
	startServer := time.AfterFunc(1200*time.Millisecond, func() {
		listener, err := net.Listen("tcp", address)
		if err != nil {
			t.Error(err)
			return
		}
		listening <- time.Now()
		go server.Serve(listener)
	})
	defer startServer.Stop()
	var listenerReady time.Time
	var retries int
	for {
		_, err := client.Readiness(ctx, "context-startup-fixture", false)
		if err == nil {
			break
		}
		if client.RetryReadinessConnection(err) {
			retries++
		}
		select {
		case <-ctx.Done():
			t.Fatal("listener was not confirmed", ctx.Err())
		case <-time.After(200 * time.Millisecond):
		}
	}
	select {
	case listenerReady = <-listening:
	default:
		t.Fatal("RPC succeeded before listener")
	}
	if elapsed := time.Since(listenerReady); elapsed > 500*time.Millisecond || retries < 2 {
		t.Fatal("startup retained default connection backoff", elapsed, retries)
	}
	for _, err := range []error{ErrReadiness, context.DeadlineExceeded, errors.New("generic failure"), status.Error(codes.PermissionDenied, "denied")} {
		if client.RetryReadinessConnection(err) {
			t.Fatal("non-connection error retried", err)
		}
	}
}
