package agentclient

import (
	"context"
	"strings"
	"testing"

	"google.golang.org/grpc"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
)

type modelRPCFixture struct {
	agentv1.AgentServiceClient
	list       string
	session    *agentv1.Session
	run        *agentv1.Run
	submitted  *agentv1.SubmitRunRequest
	preference *agentv1.AgentContentRequest
}

func (f *modelRPCFixture) ListRunModels(context.Context, *agentv1.AgentContentRequest, ...grpc.CallOption) (*agentv1.AgentContentResponse, error) {
	return &agentv1.AgentContentResponse{ValueJson: f.list}, nil
}
func (f *modelRPCFixture) ListChatModels(context.Context, *agentv1.AgentContentRequest, ...grpc.CallOption) (*agentv1.AgentContentResponse, error) {
	return &agentv1.AgentContentResponse{ValueJson: f.list}, nil
}
func (f *modelRPCFixture) SetSessionModel(_ context.Context, r *agentv1.AgentContentRequest, _ ...grpc.CallOption) (*agentv1.Session, error) {
	f.preference = r
	return f.session, nil
}
func (f *modelRPCFixture) SubmitRun(_ context.Context, r *agentv1.SubmitRunRequest, _ ...grpc.CallOption) (*agentv1.SubmitRunResponse, error) {
	f.submitted = r
	return &agentv1.SubmitRunResponse{Run: f.run}, nil
}
func TestNativeModelClientPreservesPresenceAndValidatesSafeReplies(t *testing.T) {
	f := &modelRPCFixture{session: &agentv1.Session{WorkId: "work-1", SessionId: "session-1", ModelPreferenceJson: `{"modelRef":null,"label":"Default","provider":"fixture","model":"one","availability":"available"}`}, run: &agentv1.Run{WorkId: "work-1", SessionId: "session-1", SubmissionKey: "key", ActualModelJson: `{"modelRef":null,"label":"Default","provider":"fixture","model":"one"}`, SourceJson: `{"kind":"chat"}`}}
	c := &Client{scope: internaltls.Scope{WorkID: "work-1"}, rpc: f}
	ctx := context.Background()
	empty, ref := "", "model-0000000000000001"
	for _, selector := range []*string{nil, &empty, &ref} {
		if _, err := c.SubmitRun(ctx, "session-1", "key", "prompt", selector); err != nil {
			t.Fatal(err)
		}
		if (selector == nil) != (f.submitted.ModelRef == nil) || selector != nil && *selector != *f.submitted.ModelRef {
			t.Fatal("model field presence lost")
		}
	}
	for _, selector := range []*string{nil, &ref} {
		if _, err := c.SetSessionModel(ctx, "session-1", selector); err != nil {
			t.Fatal(err)
		}
		want := `{"modelRef":null}`
		if selector != nil {
			want = `{"modelRef":"` + ref + `"}`
		}
		if f.preference.InputJson != want || f.preference.WorkId != "work-1" || f.preference.ObjectId != "session-1" {
			t.Fatal(f.preference)
		}
	}
	f.session.WorkId = "other-work"
	if _, err := c.SetSessionModel(ctx, "session-1", nil); err != ErrResponse {
		t.Fatal("foreign preference reply accepted", err)
	}
	f.session.WorkId = "work-1"
	for _, unsafe := range []string{`{"modelRef":null,"label":"Default","provider":"fixture","model":"one","baseUrl":"http://private"}`, `{"modelRef":null,"label":"Default","provider":"fixture","model":"one","credential":"secret"}`} {
		f.run.ActualModelJson = unsafe
		if _, err := c.SubmitRun(ctx, "session-1", "key", "prompt", nil); err != ErrResponse {
			t.Fatal("private execution field escaped", err)
		}
	}
	f.session.ModelPreferenceJson = `{"modelRef":null,"label":"Default","provider":"fixture","model":"one","availability":"unknown"}`
	if _, err := c.SetSessionModel(ctx, "session-1", nil); err != ErrResponse {
		t.Fatal("unknown preference status accepted", err)
	}
}
func TestNativeModelListDistinguishesEmptyFromInvalid(t *testing.T) {
	f := &modelRPCFixture{list: `{"models":[],"defaultModel":{"modelRef":null,"label":"Default","provider":"fixture","model":"one"},"checkedAt":"2026-10-03T00:00:00Z","availability":"available"}`}
	c := &Client{scope: internaltls.Scope{WorkID: "work-1"}, rpc: f}
	list, err := c.ListRunModels(context.Background())
	if err != nil || len(list.Models) != 0 || list.Availability != "available" {
		t.Fatal(list, err)
	}
	for _, raw := range []string{`{}`, `{"models":[],"credential":"secret"}`, `{"models":null}`} {
		f.list = raw
		if _, err := c.ListRunModels(context.Background()); err != ErrResponse {
			t.Fatal("invalid model reply accepted", err)
		}
	}
}

func TestChatModelClientAcceptsEmptyAndSafeRecoveryButRejectsPrivateFields(t *testing.T) {
	f := &modelRPCFixture{}
	c := &Client{scope: internaltls.Scope{WorkID: "work-1"}, rpc: f}
	const empty = `{"contractVersion":2,"models":[],"defaultModel":null,"defaultUnavailableReason":"No enabled models. Enable a provider in AI models.","checkedAt":"2026-10-09T00:00:00Z","availability":"available"}`
	f.list = empty
	if _, err := c.ListChatModels(context.Background()); err != nil {
		t.Fatal("confirmed empty Chat catalog rejected", err)
	}
	const recovery = `{"modelRef":"model-unknown-00001","label":"Provider / Unknown","provider":"openai","model":"unknown","reason":"capabilities-unconfirmed","recovery":"Configure a compatible definition in AI models."}`
	f.list = strings.TrimSuffix(empty, "}") + `,"unavailableModels":[` + recovery + `]}`
	if _, err := c.ListChatModels(context.Background()); err != nil {
		t.Fatal("safe recovery rejected", err)
	}
	for _, field := range []string{`"baseUrl":"https://private.invalid"`, `"credential":"synthetic-secret"`, `"executionBindingId":"model-execution-private1"`, `"capabilities":{}`} {
		f.list = strings.TrimSuffix(empty, "}") + `,"unavailableModels":[` + strings.TrimSuffix(recovery, "}") + `,` + field + `}]}`
		if _, err := c.ListChatModels(context.Background()); err != ErrResponse {
			t.Fatal("private recovery projection accepted", field, err)
		}
	}
}
