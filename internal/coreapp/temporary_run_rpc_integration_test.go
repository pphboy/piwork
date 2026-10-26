//go:build integration

package coreapp

import (
	"context"
	"net"
	"strconv"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/status"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/servicesv1"
)

func TestNativeTemporaryRunLeaseUsesAuthenticatedCurrentRun(t *testing.T) {
	a, base, auth, workID, ctx := nativeApplyFixture(t)
	path := "/api/v1/works/" + workID
	_, session := packageHTTPCall(t, base, path+"/sessions", "POST", auth, map[string]string{"idempotencyKey": "lease-session"})
	statusCode, accepted := packageHTTPCall(t, base, path+"/runs", "POST", auth, map[string]string{"sessionId": session["sessionId"].(string), "submissionKey": "lease-run", "prompt": "wait for abort"})
	if statusCode != 202 {
		t.Fatal("Run not accepted", statusCode, accepted)
	}
	runID := accepted["run"].(map[string]any)["runId"].(string)
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instance}
	tlsConfig, err := a.agentTLS.ServiceClientConfig(ctx, scope)
	if err != nil {
		t.Fatal(err)
	}
	address := net.JoinHostPort("127.0.0.1", strconv.Itoa(a.serviceListener.Addr().(*net.TCPAddr).Port))
	connection, err := grpc.NewClient(address, grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)), grpc.WithContextDialer(func(ctx context.Context, address string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "tcp", address)
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	client := servicesv1.NewWorkServicesClient(connection)
	capabilities, err := client.GetDeploymentContext(ctx, &servicesv1.Empty{})
	if err != nil || capabilities.GetRunTemporaryServiceContractVersion() != 1 {
		t.Fatal("temporary capability was not advertised", err)
	}
	var lease *servicesv1.TemporaryRunLease
	deadline := time.Now().Add(10 * time.Second)
	for {
		lease, err = client.OpenTemporaryRunLease(ctx, &servicesv1.TemporaryRunRequest{RunId: runID})
		if err == nil || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if err != nil || lease.GetLeaseId() == "" {
		t.Fatal("current Run could not obtain lease", err)
	}
	replay, err := client.OpenTemporaryRunLease(ctx, &servicesv1.TemporaryRunRequest{RunId: runID})
	if err != nil || replay.GetLeaseId() != lease.GetLeaseId() {
		t.Fatal("lease replay changed identity", err)
	}
	if _, err := client.OpenTemporaryRunLease(ctx, &servicesv1.TemporaryRunRequest{RunId: "run-foreign"}); err == nil {
		t.Fatal("forged Run obtained lease")
	}
	create := &servicesv1.CreateTemporaryServiceRequest{IdempotencyKey: "rpc-temp-create", Definition: &servicesv1.ServiceDefinition{Name: "rpc-probe", Image: &servicesv1.ServiceImage{Reference: a.options.Initialization.Runtime.AgentImage}, Command: "node", Args: []string{"-e", "process.exit(0)"}, WorkingDirectory: "/", CpuMillis: 250, Enabled: true, RestartPolicy: "bounded"}, Temporary: &servicesv1.TemporaryServiceRequest{Mode: "once", RunId: runID, Generation: uint64(generation), InstanceId: instance, LeaseId: lease.LeaseId}}
	forged := *create.Temporary
	forged.RunId = "run-foreign"
	create.Temporary = &forged
	if _, err := client.CreateTemporaryService(ctx, create); err == nil {
		t.Fatal("forged Run created a Service")
	}
	forged = *create.Temporary
	forged.RunId = runID
	forged.Generation++
	create.Temporary = &forged
	if _, err := client.CreateTemporaryService(ctx, create); err == nil {
		t.Fatal("forged generation created a Service")
	}
	forged.Generation = uint64(generation)
	create.Temporary = &forged
	rpcAccepted, err := client.CreateTemporaryService(ctx, create)
	if err != nil {
		t.Fatal("trusted temporary Service rejected", err)
	}
	reused, err := client.CreateTemporaryService(ctx, create)
	if err != nil || !reused.Reused || reused.ServiceId != rpcAccepted.ServiceId || reused.OperationId != rpcAccepted.OperationId {
		t.Fatal("temporary RPC replay duplicated creation", err)
	}
	resultDeadline := time.Now().Add(20 * time.Second)
	for {
		view, err := client.GetService(ctx, &servicesv1.ServiceIdRequest{ServiceId: rpcAccepted.ServiceId})
		if err == nil && view.GetTemporary() != nil && view.GetTemporary().ExitCode != nil && view.GetTemporary().GetExitCode() == 0 {
			break
		}
		if time.Now().After(resultDeadline) {
			t.Fatal("original command result not available", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if _, err := client.CloseTemporaryRunLease(ctx, &servicesv1.TemporaryRunRequest{RunId: runID}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("active Run lease closed early", err)
	}
	statusCode, _ = packageHTTPCall(t, base, path+"/runs/"+runID+"/cancel", "POST", auth, map[string]string{"idempotencyKey": "cancel-lease-run"})
	if statusCode != 200 {
		t.Fatal("cancel was rejected", statusCode)
	}
	for {
		statusCode, view := packageHTTPCall(t, base, path+"/runs/"+runID, "GET", auth, nil)
		if statusCode == 200 && view["state"] == float64(6) {
			break
		}
		if ctx.Err() != nil {
			t.Fatal("cancel did not settle")
		}
		time.Sleep(50 * time.Millisecond)
	}
	if _, err := client.CloseTemporaryRunLease(ctx, &servicesv1.TemporaryRunRequest{RunId: runID}); err != nil {
		t.Fatal("terminal Run lease did not close", err)
	}
	if _, err := client.OpenTemporaryRunLease(ctx, &servicesv1.TemporaryRunRequest{RunId: runID}); status.Code(err) != codes.FailedPrecondition {
		t.Fatal("terminal Run opened a new lease", err)
	}
}
