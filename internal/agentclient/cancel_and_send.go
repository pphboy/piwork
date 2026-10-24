package agentclient

import (
	"context"
	"encoding/base64"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/chatimages"
	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

func (c *Client) GetActiveRun(ctx context.Context, contextID string) (*agentv1.Run, error) {
	_, version, err := c.ChatControlCapabilities(ctx, contextID)
	if err != nil {
		return nil, err
	}
	if version != 1 {
		return nil, contracts.NewError("CANCEL_AND_SEND_UNSUPPORTED", "")
	}
	response, err := c.rpc.GetActiveRun(ctx, &agentv1.GetActiveRunRequest{WorkId: c.scope.WorkID, ResponseProfile: c.profile()})
	if err != nil {
		return nil, err
	}
	if response == nil {
		return nil, ErrResponse
	}
	run := response.GetRun()
	if run != nil && (run.GetWorkId() != c.scope.WorkID || run.GetRunId() == "" || run.GetSessionId() == "" || run.GetState() < agentv1.RunState_RUN_STATE_ACCEPTED || run.GetState() > agentv1.RunState_RUN_STATE_CANCELLING || !c.validRun(run)) {
		return nil, ErrResponse
	}
	return run, nil
}

// Discover support before sending an optional protobuf field an older Agent
// could silently ignore. Only this explicit method can cancel another Run.
func (c *Client) SubmitRunWithCancel(ctx context.Context, contextID, session, key, prompt string, model *string, mode *string, cancelRunID string, images []chatimages.Input) (*agentv1.SubmitRunResponse, error) {
	if contracts.Validate("IdentifierSchema", cancelRunID) != nil {
		return nil, contracts.NewError("INVALID_REQUEST", "cancelRunId")
	}
	_, version, err := c.ChatControlCapabilities(ctx, contextID)
	if err != nil {
		return nil, err
	}
	if version != 1 {
		return nil, contracts.NewError("CANCEL_AND_SEND_UNSUPPORTED", "")
	}
	if len(images) > 0 {
		if _, err := c.ChatImageCapabilities(ctx); err != nil {
			if status.Code(err) == codes.Unimplemented {
				return nil, contracts.NewError("IMAGE_INPUT_UNSUPPORTED", "")
			}
			return nil, err
		}
	}
	request := &agentv1.SubmitRunRequest{WorkId: c.scope.WorkID, SessionId: session, SubmissionKey: key, Prompt: prompt, ModelRef: model, InputMode: mode, CancelRunId: &cancelRunID, ResponseProfile: c.profile()}
	for _, image := range images {
		data, err := base64.StdEncoding.Strict().DecodeString(image.Data)
		if err != nil {
			return nil, err
		}
		request.Images = append(request.Images, &agentv1.ImageInput{MimeType: image.MimeType, Data: data})
	}
	response, err := c.rpc.SubmitRun(ctx, request, grpc.MaxCallSendMsgSize(chatimages.MaxRequestBytes))
	if err != nil {
		return nil, err
	}
	if response.GetRun().GetWorkId() != c.scope.WorkID || response.GetRun().GetSessionId() != session || response.GetRun().GetSubmissionKey() != key || !c.validRun(response.GetRun()) {
		return nil, ErrResponse
	}
	return response, nil
}
