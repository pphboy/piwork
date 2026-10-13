package agentclient

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"

	"google.golang.org/grpc"
	"piwork/internal/chatimages"
	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type cancelRPCFixture struct {
	agentv1.AgentServiceClient
	ready       *agentv1.ReadinessResponse
	active      *agentv1.GetActiveRunResponse
	submitted   *agentv1.SubmitRunRequest
	activeCalls int
	submitCalls int
}

func (f *cancelRPCFixture) Readiness(_ context.Context, request *agentv1.ReadinessRequest, _ ...grpc.CallOption) (*agentv1.ReadinessResponse, error) {
	return f.ready, nil
}
func (f *cancelRPCFixture) GetActiveRun(_ context.Context, request *agentv1.GetActiveRunRequest, _ ...grpc.CallOption) (*agentv1.GetActiveRunResponse, error) {
	f.activeCalls++
	if request.WorkId != "work-1" {
		return nil, errors.New("wrong scope")
	}
	return f.active, nil
}
func (f *cancelRPCFixture) GetChatImageCapabilities(context.Context, *agentv1.AgentContentRequest, ...grpc.CallOption) (*agentv1.AgentContentResponse, error) {
	return &agentv1.AgentContentResponse{ValueJson: `{"profile":"chat-images-v1","mimeTypes":["image/png","image/jpeg","image/webp"],"maxImages":4,"imageBytes":5242880,"totalBytes":10485760,"maxDimension":8192,"maxPixels":40000000,"defaultModel":null,"models":[]}`}, nil
}
func (f *cancelRPCFixture) SubmitRun(_ context.Context, request *agentv1.SubmitRunRequest, _ ...grpc.CallOption) (*agentv1.SubmitRunResponse, error) {
	f.submitCalls++
	f.submitted = request
	return &agentv1.SubmitRunResponse{Run: &agentv1.Run{WorkId: request.WorkId, SessionId: request.SessionId, RunId: "run-new", SubmissionKey: request.SubmissionKey, State: agentv1.RunState_RUN_STATE_ACCEPTED}}, nil
}
func newCancelRPCFixture() (*Client, *cancelRPCFixture) {
	version := uint32(1)
	f := &cancelRPCFixture{ready: &agentv1.ReadinessResponse{WorkId: "work-1", Generation: 1, InstanceId: "agent-1", ProtocolVersion: "v2", ContextContractVersion: 1, PackageContractVersion: 1, RunModelContractVersion: 1, WorkFeedbackContractVersion: 1, WorkHistorySchemaVersion: 5, ContextIdentity: "context-1", InitializationComplete: true, AcceptingRuns: true, ChatControlsContractVersion: 3, CancelAndSendContractVersion: &version}, active: &agentv1.GetActiveRunResponse{}}
	return &Client{scope: internaltls.Scope{WorkID: "work-1", Generation: 1, InstanceID: "agent-1"}, rpc: f}, f
}
func TestActiveRunQueryScopeEmptyAndOptionalCapability(t *testing.T) {
	c, f := newCancelRPCFixture()
	ctx := context.Background()
	if run, err := c.GetActiveRun(ctx, "context-1"); err != nil || run != nil {
		t.Fatal(run, err)
	}
	f.active.Run = &agentv1.Run{WorkId: "work-1", SessionId: "other-session", RunId: "run-service", State: agentv1.RunState_RUN_STATE_RUNNING, SourceJson: `{"kind":"service","serviceName":"todo","requestId":"request-1"}`}
	if run, err := c.GetActiveRun(ctx, "context-1"); err != nil || run.GetRunId() != "run-service" {
		t.Fatal(run, err)
	}
	f.active.Run.WorkId = "work-other"
	if _, err := c.GetActiveRun(ctx, "context-1"); !errors.Is(err, ErrResponse) {
		t.Fatal("foreign active Run accepted", err)
	}
	f.active.Run.WorkId = "work-1"
	f.active.Run.State = agentv1.RunState_RUN_STATE_SUCCEEDED
	if _, err := c.GetActiveRun(ctx, "context-1"); !errors.Is(err, ErrResponse) {
		t.Fatal("terminal Run reported as active", err)
	}
	f.ready.CancelAndSendContractVersion = nil
	before := f.activeCalls
	if _, err := c.GetActiveRun(ctx, "context-1"); err == nil || f.activeCalls != before {
		t.Fatal("old Agent queried for unsupported active Run", err)
	}
	version := uint32(1)
	f.ready.CancelAndSendContractVersion = &version
	f.ready.Generation = 2
	if _, err := c.GetActiveRun(ctx, "context-1"); !errors.Is(err, ErrReadiness) {
		t.Fatal("stale generation accepted", err)
	}
	if f.submitCalls != 0 {
		t.Fatal("read query submitted a Run")
	}
}
func TestCancelAndSendPresenceImagesAndOldAgentGate(t *testing.T) {
	c, f := newCancelRPCFixture()
	ctx := context.Background()
	mode := "text"
	model := "model-1"
	data := []byte{137, 80, 78, 71, 0, 255}
	images := []chatimages.Input{{MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(data)}}
	value, err := c.SubmitRunWithCancel(ctx, "context-1", "session-main", "replace-key", "next", &model, &mode, "run-old", images)
	if err != nil || value.GetRun().GetRunId() != "run-new" {
		t.Fatal(value, err)
	}
	request := f.submitted
	if request.GetCancelRunId() != "run-old" || request.GetModelRef() != model || request.GetInputMode() != mode || len(request.Images) != 1 || string(request.Images[0].Data) != string(data) {
		t.Fatal("replacement fields or image bytes changed")
	}
	f.ready.CancelAndSendContractVersion = nil
	before := f.submitCalls
	if _, err := c.SubmitRunWithCancel(ctx, "context-1", "session-main", "new-key", "next", nil, nil, "run-old", nil); err == nil || f.submitCalls != before {
		t.Fatal("old Agent received a silently ignored cancellation field", err)
	}
	if _, err := c.SubmitRun(ctx, "session-main", "ordinary", "hello", nil); err != nil || f.submitted.CancelRunId != nil {
		t.Fatal("ordinary legacy submit changed", err)
	}
	if _, err := c.SubmitRunWithCancel(ctx, "context-1", "session-main", "new-key", "next", nil, nil, "", nil); err == nil {
		t.Fatal("empty target accepted")
	}
	code, view := contracts.ProjectError(contracts.NewError("CANCEL_TIMEOUT", ""))
	if code != 409 || view.Code != "CANCEL_TIMEOUT" || view.Retryable {
		t.Fatal("cancellation timeout projection", code, view)
	}
}
