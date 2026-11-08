package agentclient

import (
	"context"
	"encoding/json"

	"piwork/internal/contracts"
)

func (c *Client) SessionManagementCapabilities(ctx context.Context) (*contracts.SessionManagementCapabilities, error) {
	return contentValue[contracts.SessionManagementCapabilities](ctx, c, c.rpc.GetSessionManagementCapabilities, "", struct{}{}, "SessionManagementCapabilitiesSchema")
}

func (c *Client) SessionManagementState(ctx context.Context, sessionID string) (*contracts.SessionManagementState, error) {
	value, err := contentValue[contracts.SessionManagementState](ctx, c, c.rpc.GetSessionManagementState, sessionID, struct{}{}, "SessionManagementStateSchema")
	if err == nil && (string(value.WorkId) != c.scope.WorkID || string(value.SessionId) != sessionID) {
		return nil, ErrResponse
	}
	return value, err
}

func (c *Client) RenameSession(ctx context.Context, sessionID string, input contracts.RenameSessionInput) (*contracts.SessionManagementState, error) {
	value, err := contentValue[contracts.SessionManagementState](ctx, c, c.rpc.RenameSession, sessionID, input, "SessionManagementStateSchema")
	if err == nil && (string(value.WorkId) != c.scope.WorkID || string(value.SessionId) != sessionID || string(value.DeletedAt) != "null" || string(value.TitleSource) != "manual") {
		return nil, ErrResponse
	}
	return value, err
}

func (c *Client) DeleteSession(ctx context.Context, sessionID string, input contracts.DeleteSessionInput) (*contracts.SessionManagementState, error) {
	value, err := contentValue[contracts.SessionManagementState](ctx, c, c.rpc.DeleteSession, sessionID, input, "SessionManagementStateSchema")
	if err == nil && (string(value.WorkId) != c.scope.WorkID || string(value.SessionId) != sessionID || string(value.DeletedAt) == "null") {
		return nil, ErrResponse
	}
	return value, err
}

func (c *Client) AutoNameSession(ctx context.Context, sessionID string, input contracts.AutoNameSessionInput) (*contracts.SessionManagementLookup, error) {
	value, err := contentValue[contracts.SessionManagementLookup](ctx, c, c.rpc.AutoNameSession, sessionID, input, "SessionManagementLookupSchema")
	if err != nil {
		return nil, err
	}
	var result struct {
		OperationKey string
		Status       string
		Kind         string
		State        *contracts.SessionManagementState
	}
	if json.Unmarshal(*value, &result) != nil || result.OperationKey != input.OperationKey || result.Status == "not-found" || result.Kind != "auto-name" || result.State == nil || string(result.State.WorkId) != c.scope.WorkID || string(result.State.SessionId) != sessionID {
		return nil, ErrResponse
	}
	return value, nil
}

func (c *Client) LookupSessionManagementOperation(ctx context.Context, sessionID, key string) (*contracts.SessionManagementLookup, error) {
	input := map[string]string{"sessionId": sessionID}
	value, err := contentValue[contracts.SessionManagementLookup](ctx, c, c.rpc.LookupSessionManagementOperation, key, input, "SessionManagementLookupSchema")
	if err != nil {
		return nil, err
	}
	var result struct {
		OperationKey string
		Status       string
		State        *contracts.SessionManagementState
	}
	if json.Unmarshal(*value, &result) != nil || result.OperationKey != key || result.State != nil && (string(result.State.WorkId) != c.scope.WorkID || string(result.State.SessionId) != sessionID) {
		return nil, ErrResponse
	}
	return value, nil
}
