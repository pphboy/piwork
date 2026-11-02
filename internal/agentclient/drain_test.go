package agentclient

import (
	"context"
	"errors"
	"testing"
	"time"

	"google.golang.org/grpc"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type drainRPCFixture struct {
	agentv1.AgentServiceClient
	response *agentv1.DrainResponse
	failure  error
	request  *agentv1.DrainRequest
	calls    int
}

func (f *drainRPCFixture) Drain(_ context.Context, request *agentv1.DrainRequest, _ ...grpc.CallOption) (*agentv1.DrainResponse, error) {
	f.calls++
	f.request = request
	return f.response, f.failure
}
func TestDrainPreservesOriginalScopeAndUnconfirmedReceipt(t *testing.T) {
	scope := internaltls.Scope{InstallationID: "install", WorkID: "work", Generation: 7, InstanceID: "instance"}
	for _, outcome := range []string{"confirmed", "unconfirmed", "failed"} {
		t.Run(outcome, func(t *testing.T) {
			fixture := &drainRPCFixture{response: &agentv1.DrainResponse{Drained: outcome == "confirmed"}}
			if outcome == "failed" {
				fixture.failure = errors.New("connection lost")
			}
			client := &Client{scope: scope, rpc: fixture}
			drained, err := client.Drain(context.Background(), 30*time.Second)
			if drained != (outcome == "confirmed") || (err != nil) != (outcome == "failed") {
				t.Fatal("RPC result changed", drained, err)
			}
			if fixture.calls != 1 || fixture.request.WorkId != scope.WorkID || fixture.request.Generation != 7 || fixture.request.InstanceId != scope.InstanceID || fixture.request.TimeoutMs != 30000 {
				t.Fatal("RPC scope/budget changed", fixture.request)
			}
		})
	}
}
