package client

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"piwork/internal/contracts"
)

func (c *Client) ControlStatus(ctx context.Context) (contracts.ControlStatus, error) {
	var raw json.RawMessage
	var status contracts.ControlStatus
	if err := c.Request(ctx, http.MethodGet, "/control/status", nil, &raw); err != nil {
		return status, err
	}
	// A missing/invalid hasUsers field is not an empty installation.
	var shape struct {
		HasUsers *bool `json:"hasUsers"`
	}
	if json.Unmarshal(raw, &status) != nil || json.Unmarshal(raw, &shape) != nil ||
		shape.HasUsers == nil || status.State == "" || status.Preparation.Version != 1 {
		return status, &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned malformed initialization status"}
	}
	return status, nil
}

// SetupClient has no generic request method or user/operator identity. The
// secret never becomes a default transport header and cannot follow redirects.
type SetupClient struct {
	api    *Client
	secret string
}

func NewSetupClient(coreURL, secret string) (*SetupClient, error) {
	api, err := New(coreURL, "")
	if err != nil {
		return nil, err
	}
	return &SetupClient{api: api, secret: secret}, nil
}

// Bootstrap submits exactly once. If its result is unknown the caller must
// read ControlStatus, rather than resubmit the password.
func (c *SetupClient) Bootstrap(ctx context.Context, account, password string) (contracts.BootstrapResult, error) {
	var result contracts.BootstrapResult
	err := c.api.request(ctx, http.MethodPost, "/control/admin/bootstrap",
		map[string]string{"account": account, "password": password}, &result, "Setup "+c.secret)
	if err == nil && (result.UserID == "" || result.Account != account) {
		err = &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned an unexpected bootstrap acknowledgement"}
	}
	return result, err
}

type SessionIdentity struct {
	Identity
	ExpiresAt string `json:"expiresAt"`
}

func (c *Client) Me(ctx context.Context) (SessionIdentity, error) {
	var result SessionIdentity
	err := c.Request(ctx, http.MethodGet, "/api/v1/me", nil, &result)
	if err == nil {
		expiry, parseErr := time.Parse(time.RFC3339Nano, result.ExpiresAt)
		if result.ID == "" || result.Account == "" || (result.Role != "admin" && result.Role != "user") ||
			parseErr != nil || !expiry.After(time.Now()) {
			err = &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned malformed identity"}
		}
	}
	return result, err
}
