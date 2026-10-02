//go:build integration

package coreapp

import (
	"context"
	"crypto/tls"
	"net"
	"strconv"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
)

func TestNativeServiceRPCRejectsForeignStaleAndWrongRole(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	connect := func(config *tls.Config) servicesv1.WorkServicesClient {
		t.Helper()
		address := net.JoinHostPort("127.0.0.1", strconv.Itoa(a.serviceListener.Addr().(*net.TCPAddr).Port))
		connection, err := grpc.NewClient(address, grpc.WithTransportCredentials(credentials.NewTLS(config)), grpc.WithContextDialer(func(ctx context.Context, address string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, "tcp", address)
		}))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { connection.Close() })
		return servicesv1.NewWorkServicesClient(connection)
	}
	config, err := a.agentTLS.ServiceClientConfig(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	current := connect(config)
	call, cancel := context.WithTimeout(ctx, 3*time.Second)
	deployment, err := current.GetDeploymentContext(call, &servicesv1.Empty{})
	cancel()
	if err != nil || deployment.WorkId != workID || deployment.WorkspacePath != "/var/data/workspace" || deployment.ApiVersion != "v2" {
		t.Fatal("valid authenticated context", deployment, err)
	}
	request := &servicesv1.CreateServiceRequest{IdempotencyKey: "unauthorized-create", Definition: &servicesv1.ServiceDefinition{Name: "forbidden", Image: &servicesv1.ServiceImage{Reference: "fixture/app"}, Command: "app", WorkingDirectory: "/", CpuMillis: 250, MemoryBytes: 128 << 20, Enabled: true, RestartPolicy: "bounded"}}
	for _, claims := range []metadata.MD{
		metadata.Pairs("x-piwork-work-id", "work-foreign"),
		metadata.Pairs("x-piwork-generation", strconv.FormatInt(generation+1, 10)),
		metadata.Pairs("x-piwork-instance-id", "agent-foreign"),
		metadata.Pairs("work-id", workID, "work-id", "work-foreign"),
	} {
		call, cancel := context.WithTimeout(metadata.NewOutgoingContext(ctx, claims), 3*time.Second)
		_, err := current.CreateService(call, request)
		cancel()
		if err == nil {
			t.Fatal("certificate identity accepted conflicting metadata")
		}
	}
	withoutCertificate := config.Clone()
	withoutCertificate.Certificates = nil
	unauthenticated := connect(withoutCertificate)
	call, cancel = context.WithTimeout(ctx, 3*time.Second)
	_, err = unauthenticated.CreateService(call, request)
	cancel()
	if err == nil {
		t.Fatal("application without an Agent certificate deployed a service")
	}
	for _, identity := range []string{"agentd", instance} {
		call, cancel := context.WithTimeout(ctx, 3*time.Second)
		_, err := current.RemoveService(call, &servicesv1.MutateServiceRequest{ServiceId: identity, IdempotencyKey: "refuse-self-" + identity})
		cancel()
		if code := status.Code(err); code != codes.NotFound && code != codes.InvalidArgument {
			t.Fatal("Agent identity was treated as an application Service", code)
		}
	}
	for _, fixture := range []struct {
		name      string
		scope     internaltls.Scope
		wrongRole bool
	}{
		{"foreign-work", internaltls.Scope{InstallationID: scope.InstallationID, WorkID: "work-11111111-1111-1111-1111-111111111111", Generation: 1, InstanceID: "agent-foreign"}, false},
		{"future-generation", internaltls.Scope{InstallationID: scope.InstallationID, WorkID: workID, Generation: generation + 1, InstanceID: "agent-future"}, false},
		{"wrong-role", scope, true},
	} {
		t.Run(fixture.name, func(t *testing.T) {
			var config *tls.Config
			var err error
			if fixture.wrongRole {
				config, err = a.agentTLS.AgentClientConfig(ctx, fixture.scope)
			} else {
				config, err = a.agentTLS.ServiceClientConfig(ctx, fixture.scope)
			}
			if err != nil {
				t.Fatal(err)
			}
			client := connect(config)
			call, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			if _, err := client.CreateService(call, request); err == nil {
				t.Fatal("unauthorized identity wrote definition")
			}
		})
	}
	status, stopped := packageHTTPCall(t, base, "/api/v1/works/"+workID+"/stop", "POST", auth, map[string]string{"idempotencyKey": "stop-rpc-scope"})
	if status != 202 {
		t.Fatal(status, stopped)
	}
	call, cancel = context.WithTimeout(ctx, 3*time.Second)
	_, err = current.CreateService(call, request)
	cancel()
	if err == nil {
		t.Fatal("established RPC channel bypassed stopped Work fence")
	}
	waitWorkOperation(t, ctx, a, stopped["operationId"].(string))
	services, err := a.Store.Services(ctx, workID, true)
	if err != nil || len(services) != 0 {
		t.Fatal("denied RPC produced service state", services, err)
	}
}
