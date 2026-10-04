package agentclient

import (
	"context"
	"encoding/json"
	"strings"

	"google.golang.org/grpc"
	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

type contentMethod func(context.Context, *agentv1.AgentContentRequest, ...grpc.CallOption) (*agentv1.AgentContentResponse, error)

func contentValue[T any](ctx context.Context, c *Client, method contentMethod, id string, input any, schema string) (*T, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return nil, ErrResponse
	}
	response, err := method(ctx, &agentv1.AgentContentRequest{WorkId: c.scope.WorkID, ObjectId: id, InputJson: string(raw)})
	if err != nil {
		return nil, err
	}
	if response == nil {
		return nil, ErrResponse
	}
	value, err := contracts.Decode[T](strings.NewReader(response.ValueJson), schema, 2<<20)
	if err != nil {
		return nil, ErrResponse
	}
	return &value, nil
}
func (c *Client) ListAgentRequests(ctx context.Context, input contracts.AgentRequestQuery) (*contracts.AgentRequestPage, error) {
	return contentValue[contracts.AgentRequestPage](ctx, c, c.rpc.ListAgentRequests, "", input, "AgentRequestPageSchema")
}
func (c *Client) GetAgentRequest(ctx context.Context, id string, input contracts.AgentEvidenceQuery) (*contracts.AgentRequestDetail, error) {
	value, err := contentValue[contracts.AgentRequestDetail](ctx, c, c.rpc.GetAgentRequest, id, input, "AgentRequestDetailSchema")
	if err != nil {
		return nil, err
	}
	if string(value.Request.RequestId) != id {
		return nil, ErrResponse
	}
	return value, nil
}
func (c *Client) CancelAgentRequest(ctx context.Context, id string) (*contracts.AgentRequest, error) {
	value, err := contentValue[contracts.AgentRequest](ctx, c, c.rpc.CancelAgentRequest, id, struct{}{}, "AgentRequestSchema")
	if err != nil {
		return nil, err
	}
	if string(value.RequestId) != id {
		return nil, ErrResponse
	}
	return value, nil
}
func (c *Client) RetryAgentRequest(ctx context.Context, id string, input contracts.RetryAgentRequest) (*contracts.AgentRequest, error) {
	value, err := contentValue[contracts.AgentRequest](ctx, c, c.rpc.RetryAgentRequest, id, input, "AgentRequestSchema")
	if err != nil {
		return nil, err
	}
	var previous string
	if json.Unmarshal(value.RetryOf, &previous) != nil || previous != id || string(value.RequestId) == id {
		return nil, ErrResponse
	}
	return value, nil
}
func (c *Client) GetAgentEvidence(ctx context.Context, id string) (*contracts.AgentEvidence, error) {
	value, err := contentValue[contracts.AgentEvidence](ctx, c, c.rpc.GetAgentEvidence, id, struct{}{}, "AgentEvidenceSchema")
	if err != nil {
		return nil, err
	}
	if string(value.EvidenceId) != id {
		return nil, ErrResponse
	}
	return value, nil
}
