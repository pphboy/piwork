package agentclient

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type managementRPCFixture struct {
	agentv1.AgentServiceClient
	response string
	request  *agentv1.AgentContentRequest
}

func (f *managementRPCFixture) GetSessionManagementState(_ context.Context, request *agentv1.AgentContentRequest, _ ...grpc.CallOption) (*agentv1.AgentContentResponse, error) {
	f.request = request
	return &agentv1.AgentContentResponse{ValueJson: f.response}, nil
}
func (f *managementRPCFixture) LookupSessionManagementOperation(_ context.Context, request *agentv1.AgentContentRequest, _ ...grpc.CallOption) (*agentv1.AgentContentResponse, error) {
	f.request = request
	return &agentv1.AgentContentResponse{ValueJson: f.response}, nil
}

func TestSessionManagementMetadataRejectsMalformedAgentFacts(t *testing.T) {
	name := "Reading plan"
	deleted := "2026-11-08T00:00:00Z"
	valid := &agentv1.Session{Title: &name, TitleSource: "manual", TitleRevision: 1, AutoNameState: "completed", ManualTitleLock: true}
	if !validSessionMetadata(valid) {
		t.Fatal("valid managed Session rejected")
	}
	for _, value := range []*agentv1.Session{
		{Title: &name},
		{DeletedAt: &deleted},
		{Title: &name, TitleSource: "default", AutoNameState: "eligible"},
		{Title: &name, TitleSource: "manual", TitleRevision: 1, AutoNameState: "completed"},
		{Title: &name, TitleSource: "manual", TitleRevision: 0, AutoNameState: "completed", ManualTitleLock: true},
		{Title: &name, TitleSource: "auto", TitleRevision: 1, AutoNameState: "invented"},
		{TitleSource: "auto", TitleRevision: 1, AutoNameState: "completed"},
	} {
		if validSessionMetadata(value) {
			t.Fatalf("accepted malformed metadata: %+v", value)
		}
	}
	if !validSessionMetadata(&agentv1.Session{}) {
		t.Fatal("old Agent metadata no longer accepted")
	}
}

func TestSessionManagementReadsRejectWrongWorkSessionAndOperation(t *testing.T) {
	rpc := &managementRPCFixture{}
	client := &Client{scope: internaltls.Scope{WorkID: "work-1"}, rpc: rpc}
	state := `{"workId":"work-1","sessionId":"session-1","title":"Reading","titleSource":"manual","revision":1,"manualLock":true,"deletedAt":null,"autoState":"eligible"}`
	rpc.response = state
	if _, err := client.SessionManagementState(context.Background(), "session-1"); err != nil {
		t.Fatal(err)
	}
	rpc.response = `{"workId":"work-2","sessionId":"session-1","title":null,"titleSource":"default","revision":0,"manualLock":false,"deletedAt":null,"autoState":"eligible"}`
	if _, err := client.SessionManagementState(context.Background(), "session-1"); !errors.Is(err, ErrResponse) {
		t.Fatal("wrong Work accepted", err)
	}
	rpc.response = `{"operationKey":"key-1","status":"accepted","kind":"rename","state":` + state + `}`
	if _, err := client.LookupSessionManagementOperation(context.Background(), "session-1", "key-1"); err != nil {
		t.Fatal(err)
	}
	if rpc.request.GetObjectId() != "key-1" || rpc.request.GetInputJson() != `{"sessionId":"session-1"}` {
		t.Fatal("original operation target was not forwarded", rpc.request)
	}
	if _, err := client.LookupSessionManagementOperation(context.Background(), "session-2", "key-1"); !errors.Is(err, ErrResponse) {
		t.Fatal("wrong Session accepted", err)
	}
	if _, err := client.LookupSessionManagementOperation(context.Background(), "session-1", "key-2"); !errors.Is(err, ErrResponse) {
		t.Fatal("wrong operation key accepted", err)
	}
}
