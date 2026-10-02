package client

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Binary opens a same-origin streaming request. Callers own response body and
// must validate its status and metadata before consuming content.
func (c *Client) Binary(ctx context.Context, method, path string, headers http.Header, body io.Reader, length int64) (*http.Response, error) {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return nil, errors.New("invalid Core binary path")
	}
	ref, err := url.ParseRequestURI(path)
	if err != nil || ref.IsAbs() || ref.Host != "" {
		return nil, errors.New("invalid Core binary path")
	}
	u := c.Base.ResolveReference(ref)
	var requestBody io.Reader
	if body != nil {
		// net/http closes a supplied io.ReadCloser after transmission. The
		// caller retains its file descriptor to verify source stability.
		requestBody = io.NopCloser(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), requestBody)
	if err != nil {
		return nil, err
	}
	req.Header = headers.Clone()
	if req.Header == nil {
		req.Header = make(http.Header)
	}
	if req.Header.Get("Accept") == "" {
		req.Header.Set("Accept", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	if body != nil && length >= 0 {
		req.ContentLength = length
	}
	transport := *c.HTTP
	transport.Timeout = 0
	response, err := transport.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, &APIError{Code: "NETWORK_ERROR", Text: "Core transfer is unavailable"}
	}
	return response, nil
}
