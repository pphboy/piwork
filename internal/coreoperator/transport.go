package coreoperator

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"syscall"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/coreapp"
)

type apiError struct {
	status int
	public contracts.ErrorView
}

func (e *apiError) Error() string { return e.public.Code + ": " + e.public.Message }

type transportError struct {
	refused bool
	cause   error
}

func (e *transportError) Unwrap() error { return e.cause }

func (e *transportError) Error() string {
	return "CORE_UNAVAILABLE: could not contact Core; verify the selected endpoint"
}

type connection struct {
	base   string
	token  string
	client *http.Client
}

func connect(base string) (*connection, error) {
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" && u.Path != "/" || u.Scheme != "https" && (u.Scheme != "http" || !coreapp.IsLoopback(u.Hostname())) {
		return nil, usage("Core URL must be HTTPS or loopback HTTP without credentials, query, fragment, or path")
	}
	if u.Port() != "" {
		if _, err := coreapp.ParseListen(net.JoinHostPort(u.Hostname(), u.Port()), true); err != nil {
			return nil, usage("Core URL has an invalid port")
		}
	}
	transport := &http.Transport{DialContext: (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext, TLSHandshakeTimeout: 10 * time.Second, ResponseHeaderTimeout: 65 * time.Second, MaxResponseHeaderBytes: 32 << 10, IdleConnTimeout: 90 * time.Second}
	client := &http.Client{Transport: transport, Timeout: 70 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &connection{base: strings.TrimSuffix(u.String(), "/"), client: client}, nil
}
func (c *connection) close() { c.client.CloseIdleConnections() }
func (c *connection) request(ctx context.Context, method, path string, payload any) (any, error) {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return nil, usage("invalid Core request")
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Operator "+c.token)
	}
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.client.Do(req)
	if err != nil {
		return nil, &transportError{refused: errors.Is(err, syscall.ECONNREFUSED), cause: err}
	}
	defer response.Body.Close()
	return c.readResponse(response)
}

func (c *connection) readResponse(response *http.Response) (any, error) {
	if response.StatusCode == 204 {
		return nil, nil
	}
	value, err := contracts.ParseJSON(response.Body, 2<<20)
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		code := "INTERNAL_ERROR"
		switch response.StatusCode {
		case 401:
			code = "OPERATOR_AUTHENTICATION_REQUIRED"
		case 403:
			code = "PERMISSION_DENIED"
		case 409:
			code = "CONFLICT"
		case 502, 503, 504:
			code = "RUNTIME_UNAVAILABLE"
		}
		if object, ok := value.(map[string]any); err == nil && ok {
			if v, ok := object["code"].(string); ok {
				code = v
			}
		}
		_, public := contracts.ProjectError(contracts.NewError(code, ""))
		return nil, &apiError{response.StatusCode, public}
	}
	if err != nil {
		return nil, &transportError{cause: err}
	}
	return value, nil
}
