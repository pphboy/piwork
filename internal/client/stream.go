package client

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// StreamNDJSON preserves transport backpressure and stops at the first invalid
// or oversized event. A lost observer response never resubmits the Run.
func (c *Client) StreamNDJSON(ctx context.Context, path string, consume func(json.RawMessage) error) error {
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		return errors.New("invalid Core stream path")
	}
	ref, err := url.ParseRequestURI(path)
	if err != nil || ref.IsAbs() || ref.Host != "" {
		return errors.New("invalid Core stream path")
	}
	u := c.Base.ResolveReference(ref)
	req, err := http.NewRequestWithContext(ctx, "GET", u.String(), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/x-ndjson")
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}
	streamHTTP := *c.HTTP
	streamHTTP.Timeout = 0
	response, err := streamHTTP.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &APIError{Code: "NETWORK_ERROR", Text: "Core stream is unavailable"}
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
		var failure struct{ Code, Message string }
		if len(raw) <= responseLimit && json.Unmarshal(raw, &failure) == nil && failure.Code != "" {
			return &APIError{Status: response.StatusCode, Code: failure.Code, Text: failure.Message}
		}
		return &APIError{Status: response.StatusCode, Code: "HTTP_ERROR", Text: "Core stream is unavailable"}
	}
	if !strings.HasPrefix(response.Header.Get("Content-Type"), "application/x-ndjson") {
		return &APIError{Status: response.StatusCode, Code: "MALFORMED_RESPONSE", Text: "Core stream has an invalid content type"}
	}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 32<<10), responseLimit)
	for scanner.Scan() {
		line := append(json.RawMessage(nil), scanner.Bytes()...)
		if !json.Valid(line) {
			return &APIError{Status: response.StatusCode, Code: "MALFORMED_RESPONSE", Text: "Core stream contains invalid JSON"}
		}
		if err := consume(line); err != nil {
			return err
		}
	}
	if err := scanner.Err(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return &APIError{Code: "NETWORK_ERROR", Text: "Core stream disconnected"}
	}
	return nil
}
