package agentclient

import (
	"context"
	"encoding/json"
	"piwork/internal/contracts"
)

func (c *Client) ListChatModels(ctx context.Context) (*contracts.ChatModelList, error) {
	return contentValue[contracts.ChatModelList](ctx, c, c.rpc.ListChatModels, "", struct{}{}, "ChatModelListSchema")
}
func (c *Client) ListSlashCommands(ctx context.Context) (*contracts.SlashCommandList, error) {
	return contentValue[contracts.SlashCommandList](ctx, c, c.rpc.ListSlashCommands, "", struct{}{}, "SlashCommandListSchema")
}
func (c *Client) GetSessionChatOptions(ctx context.Context, id string) (*contracts.SessionChatOptions, error) {
	value, err := contentValue[contracts.SessionChatOptions](ctx, c, c.rpc.GetSessionChatOptions, id, struct{}{}, "SessionChatOptionsSchema")
	if err == nil && string(value.SessionId) != id {
		return nil, ErrResponse
	}
	return value, err
}
func (c *Client) SetSessionChatOptions(ctx context.Context, id string, input contracts.SetSessionChatOptions) (*contracts.SessionChatOptions, error) {
	value, err := contentValue[contracts.SessionChatOptions](ctx, c, c.rpc.SetSessionChatOptions, id, input, "SessionChatOptionsSchema")
	if err == nil && string(value.SessionId) != id {
		return nil, ErrResponse
	}
	return value, err
}
func (c *Client) LookupChatSubmission(ctx context.Context, kind, key string) (*contracts.ChatSubmissionLookup, error) {
	value, err := contentValue[contracts.ChatSubmissionLookup](ctx, c, c.rpc.LookupChatSubmission, "", map[string]string{"kind": kind, "key": key}, "ChatSubmissionLookupSchema")
	if err != nil {
		return nil, err
	}
	var result struct {
		Kind    string
		Key     string
		Session *struct{ WorkId string }
		Run     *struct {
			WorkId        string
			SubmissionKey string
		}
	}
	if json.Unmarshal(*value, &result) != nil || result.Kind != kind || result.Key != key || result.Session != nil && result.Session.WorkId != c.scope.WorkID || result.Run != nil && (result.Run.WorkId != c.scope.WorkID || result.Run.SubmissionKey != key) {
		return nil, ErrResponse
	}
	return value, nil
}
