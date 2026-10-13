package coreapp

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/status"
)

func TestShutdownWorkloadGetsLiveBudgetDespiteBlockedControl(t *testing.T) {
	for _, blocked := range []string{"grpc", "http", "coordinator"} {
		t.Run(blocked, func(t *testing.T) {
			workload := make(chan error, 1)
			a, err := New(context.Background(), Options{
				DataDirectory: t.TempDir(), WorkDrainTimeout: 40 * time.Millisecond,
				WorkStopTimeout: 40 * time.Millisecond, ShutdownTimeout: 300 * time.Millisecond,
				Shutdown: func(ctx context.Context, _ *Application) error {
					workload <- ctx.Err()
					return ctx.Err()
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = a.Close(context.Background()) })
			entered := make(chan struct{})
			switch blocked {
			case "grpc":
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				server := grpc.NewServer(grpc.UnaryInterceptor(func(ctx context.Context, _ any, _ *grpc.UnaryServerInfo, _ grpc.UnaryHandler) (any, error) {
					close(entered)
					<-ctx.Done()
					return nil, status.Error(codes.Canceled, "controlled request ended")
				}))
				healthpb.RegisterHealthServer(server, health.NewServer())
				a.serviceServer = server
				t.Cleanup(server.Stop)
				go func() { _ = server.Serve(listener) }()
				connection, err := grpc.NewClient(listener.Addr().String(), grpc.WithTransportCredentials(insecure.NewCredentials()))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = connection.Close() })
				go func() {
					_, _ = healthpb.NewHealthClient(connection).Check(context.Background(), &healthpb.HealthCheckRequest{})
				}()
			case "http":
				server := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, request *http.Request) {
					close(entered)
					<-request.Context().Done()
				}))
				a.server = server.Config
				t.Cleanup(server.Close)
				go func() {
					response, err := http.Get(server.URL)
					if err == nil {
						response.Body.Close()
					}
				}()
			case "coordinator":
				gate := make(chan struct{})
				var release sync.Once
				t.Cleanup(func() { release.Do(func() { close(gate) }) })
				a.workWG.Add(1)
				go func() { defer a.workWG.Done(); close(entered); <-gate }()
			}
			select {
			case <-entered:
			case <-time.After(2 * time.Second):
				t.Fatal("controlled request did not enter")
			}
			started := time.Now()
			if err := a.Close(context.Background()); err == nil {
				t.Fatal("blocked control shutdown reported success")
			}
			if elapsed := time.Since(started); elapsed > time.Second {
				t.Fatal("shutdown exceeded its configured total budget", elapsed)
			}
			select {
			case err := <-workload:
				if err != nil {
					t.Fatal("control shutdown exhausted the Work stop budget before its first attempt", err)
				}
			default:
				t.Fatal("Work shutdown was never attempted")
			}
		})
	}
}
