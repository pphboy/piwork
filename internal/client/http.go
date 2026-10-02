package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const responseLimit = 1 << 20

type APIError struct {
	Status  int
	Code    string
	Text    string
	Details json.RawMessage
}

func (e *APIError) Error() string { return e.Code + ": " + e.Text }

type Client struct {
	Base  *url.URL
	Token string
	HTTP  *http.Client
}

func ResolveCoreURL(explicit, saved string) (string, error) {
	value := explicit
	if value == "" {
		value = os.Getenv("PIWORK_CORE_URL")
	}
	if value == "" {
		value = saved
	}
	if value == "" {
		value = "http://127.0.0.1:7171"
	}
	_, err := ParseCoreURL(value)
	return value, err
}

func ParseCoreURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || u == nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" ||
		u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" {
		return nil, errors.New("Core URL must be an HTTP or HTTPS origin without credentials, query, or fragment")
	}
	if u.Path != "" && u.Path != "/" {
		return nil, errors.New("Core URL must not contain a path")
	}
	u.Path = "/"
	return u, nil
}

func New(raw, token string) (*Client, error) {
	u, err := ParseCoreURL(raw)
	if err != nil {
		return nil, err
	}
	return &Client{Base: u, Token: token, HTTP: &http.Client{Timeout: 30 * time.Second,
		Transport:     &http.Transport{Proxy: nil, MaxResponseHeaderBytes: 32 << 10},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (c *Client) Request(ctx context.Context, method, path string, input any, output any) error {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.Contains(path, "#") {
		return errors.New("invalid Core request path")
	}
	ref, err := url.ParseRequestURI(path)
	if err != nil || ref.IsAbs() || ref.Host != "" {
		return errors.New("invalid Core request path")
	}
	u := c.Base.ResolveReference(ref)
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	response, err := c.HTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &APIError{Code: "NETWORK_ERROR", Text: "Core request failed"}
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if err != nil || len(raw) > responseLimit {
		return &APIError{Status: response.StatusCode, Code: "MALFORMED_RESPONSE", Text: "Core returned an oversized or incomplete response"}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct{ Code, Message string }
		if json.Unmarshal(raw, &failure) != nil || failure.Code == "" {
			return &APIError{Status: response.StatusCode, Code: "HTTP_ERROR", Text: fmt.Sprintf("Core returned HTTP %d", response.StatusCode)}
		}
		return &APIError{Status: response.StatusCode, Code: failure.Code, Text: failure.Message, Details: json.RawMessage(raw)}
	}
	if output != nil && json.Unmarshal(raw, output) != nil {
		return &APIError{Status: response.StatusCode, Code: "MALFORMED_RESPONSE", Text: "Core returned malformed JSON"}
	}
	return nil
}

// Logout requires the Core's empty 204 acknowledgement; an arbitrary 2xx page
// or JSON document is not confirmation that the session was revoked.
func (c *Client) Logout(ctx context.Context) error {
	var acknowledgement json.RawMessage
	if err := c.Request(ctx, http.MethodPost, "/api/v1/logout", nil, &acknowledgement); err != nil {
		return err
	}
	if len(acknowledgement) != 0 {
		return &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned an unexpected logout acknowledgement"}
	}
	return nil
}

func (c *Client) Login(ctx context.Context, account, password string) (Credential, error) {
	var result struct {
		Token     string   `json:"token"`
		ExpiresAt string   `json:"expiresAt"`
		User      Identity `json:"user"`
	}
	if err := c.Request(ctx, "POST", "/api/v1/login", map[string]string{"account": account, "password": password}, &result); err != nil {
		return Credential{}, err
	}
	value := Credential{Version: 1, CoreURL: c.Base.String(), Token: result.Token, ExpiresAt: result.ExpiresAt, User: result.User}
	if !value.valid() {
		return Credential{}, &APIError{Code: "MALFORMED_RESPONSE", Text: "Core returned malformed credentials"}
	}
	return value, nil
}
