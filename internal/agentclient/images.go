package agentclient

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/chatimages"
	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

func (c *Client) ChatImageCapabilities(ctx context.Context) (*contracts.ChatImageCapabilities, error) {
	return contentValue[contracts.ChatImageCapabilities](ctx, c, c.rpc.GetChatImageCapabilities, "", struct{}{}, "ChatImageCapabilitiesSchema")
}
func (c *Client) ReadSessionImage(ctx context.Context, session, run string, index uint32) (*agentv1.SessionImage, error) {
	value, err := c.rpc.ReadSessionImage(ctx, &agentv1.ReadSessionImageRequest{WorkId: c.scope.WorkID, SessionId: session, RunId: run, ImageIndex: index}, grpc.MaxCallRecvMsgSize(6<<20))
	if err != nil {
		return nil, err
	}
	if value.WorkId != c.scope.WorkID || value.SessionId != session || value.RunId != run || value.ImageIndex != index || value.Image == nil || value.Image.ImageIndex != index || int(value.Image.ByteSize) != len(value.Data) {
		return nil, contracts.NewError("IMAGE_HISTORY_CORRUPT", "")
	}
	if chatimages.ValidateBytes(value.Image.MimeType, value.Data) != nil {
		return nil, contracts.NewError("IMAGE_HISTORY_CORRUPT", "")
	}
	sum := sha256.Sum256(value.Data)
	if hex.EncodeToString(sum[:]) != value.Image.Sha256 {
		return nil, contracts.NewError("IMAGE_HISTORY_CORRUPT", "")
	}
	return value, nil
}
func (c *Client) SubmitImageRun(ctx context.Context, session, key, prompt string, model *string, mode string, images []chatimages.Input) (*agentv1.SubmitRunResponse, error) {
	// Old protobuf servers ignore unknown fields. Discover support before an old
	// SubmitRun could accept the caption while silently discarding the pictures.
	if _, err := c.ChatImageCapabilities(ctx); err != nil {
		if status.Code(err) == codes.Unimplemented {
			return nil, contracts.NewError("IMAGE_INPUT_UNSUPPORTED", "")
		}
		return nil, err
	}
	request := &agentv1.SubmitRunRequest{WorkId: c.scope.WorkID, SessionId: session, SubmissionKey: key, Prompt: prompt, ModelRef: model, InputMode: &mode, ResponseProfile: c.profile()}
	for _, image := range images {
		bytes, err := base64.StdEncoding.Strict().DecodeString(image.Data)
		if err != nil {
			return nil, err
		}
		request.Images = append(request.Images, &agentv1.ImageInput{MimeType: image.MimeType, Data: bytes})
	}
	value, err := c.rpc.SubmitRun(ctx, request, grpc.MaxCallSendMsgSize(chatimages.MaxRequestBytes))
	if err != nil {
		return nil, err
	}
	if value.GetRun().GetWorkId() != c.scope.WorkID || value.GetRun().GetSessionId() != session || value.GetRun().GetSubmissionKey() != key || !c.validRun(value.GetRun()) {
		return nil, ErrResponse
	}
	return value, nil
}
