package agentclient

import (
	"context"
	"encoding/base64"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"net"
	"piwork/internal/chatimages"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"testing"
)

type imageWireServer struct {
	agentv1.UnimplementedAgentServiceServer
	received *agentv1.SubmitRunRequest
	old      bool
}

func (s *imageWireServer) GetChatImageCapabilities(context.Context, *agentv1.AgentContentRequest) (*agentv1.AgentContentResponse, error) {
	if s.old {
		return nil, status.Error(codes.Unimplemented, "old Agent")
	}
	return &agentv1.AgentContentResponse{ValueJson: `{"profile":"chat-images-v1","mimeTypes":["image/png","image/jpeg","image/webp"],"maxImages":4,"imageBytes":5242880,"totalBytes":10485760,"maxDimension":8192,"maxPixels":40000000,"defaultModel":null,"models":[]}`}, nil
}

func (s *imageWireServer) SubmitRun(_ context.Context, input *agentv1.SubmitRunRequest) (*agentv1.SubmitRunResponse, error) {
	s.received = input
	return &agentv1.SubmitRunResponse{Run: &agentv1.Run{WorkId: input.WorkId, SessionId: input.SessionId, RunId: "run-image", SubmissionKey: input.SubmissionKey, State: agentv1.RunState_RUN_STATE_ACCEPTED}}, nil
}
func (s *imageWireServer) ReadSession(_ context.Context, input *agentv1.ReadSessionRequest) (*agentv1.SessionHistory, error) {
	result := &agentv1.SessionHistory{Session: &agentv1.Session{WorkId: input.WorkId, SessionId: input.SessionId}, Runs: []*agentv1.Run{{WorkId: input.WorkId, SessionId: input.SessionId, RunId: "run-image"}}}
	if input.GetImageProfile() == chatimages.Profile {
		result.Messages = []*agentv1.SessionMessage{{EntryId: "entry", Role: "user", RunId: "run-image", Blocks: []*agentv1.SessionContentBlock{{BlockId: "image-0", Type: "image", Image: &agentv1.ImageDescriptor{MimeType: "image/png", ByteSize: 70, Sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ImageIndex: 0}}}}}
	}
	return result, nil
}
func TestImageWireBudgetAndOldOptionalCapability(t *testing.T) {
	listener := bufconn.Listen(32 << 20)
	server := grpc.NewServer(grpc.MaxRecvMsgSize(chatimages.MaxRequestBytes))
	fixture := &imageWireServer{}
	agentv1.RegisterAgentServiceServer(server, fixture)
	go server.Serve(listener)
	t.Cleanup(server.Stop)
	connection, err := grpc.NewClient("passthrough:///image-fixture", grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return listener.Dial() }), grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	c := &Client{scope: internaltls.Scope{WorkID: "work-image"}, rpc: agentv1.NewAgentServiceClient(connection)}
	raw := make([]byte, chatimages.MaxImageBytes)
	input := []chatimages.Input{{MimeType: "image/png", Data: base64.StdEncoding.EncodeToString(raw)}}
	if _, err := c.SubmitImageRun(context.Background(), "session-image", "image-key", "", nil, "text", input); err != nil {
		t.Fatal(err)
	}
	if len(fixture.received.Images) != 1 || len(fixture.received.Images[0].Data) != len(raw) {
		t.Fatal("large RPC image truncated")
	}
	fixture.old = true
	if _, err := c.ChatImageCapabilities(context.Background()); status.Code(err) != codes.Unimplemented {
		t.Fatal("old optional RPC was not independently rejected", err)
	}
	before := fixture.received
	if _, err := c.SubmitImageRun(context.Background(), "session-image", "must-not-drop", "caption", nil, "text", input); err == nil || fixture.received != before {
		t.Fatal("old Agent received an image request as caption-only input", err)
	}
	if _, err := c.SubmitRun(context.Background(), "session-image", "text-key", "text", nil); err != nil {
		t.Fatal("old Agent lost text input", err)
	}
	if len(fixture.received.Images) != 0 {
		t.Fatal("text request changed")
	}
	fixture.old = false
	if _, err := c.ReadSession(context.Background(), "session-image", chatimages.Profile); err != nil {
		t.Fatal("protobuf integer metadata failed JSON projection", err)
	}
	legacy, err := c.ReadSession(context.Background(), "session-image")
	if err != nil || len(legacy.Messages) != 0 {
		t.Fatal("legacy history did not retain old shape", err)
	}
}
