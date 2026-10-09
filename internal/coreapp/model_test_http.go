package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

type modelTestInput struct {
	ModelID    string `json:"modelId"`
	ProviderID string `json:"providerId"`
	API        string `json:"api"`
	BaseURL    string `json:"baseUrl"`
	Model      string `json:"model"`
	Credential string `json:"credential"`
}

const modelTestMessage = "Reply with OK."

func (a *Application) modelTestHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal) error {
	in, err := readModelTestInput(r)
	if err != nil {
		return err
	}
	if in.ProviderID != "" || in.ModelID != "" {
		err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
			if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
				return err
			}
			reg, err := modelRegistryTx(tx)
			if err != nil {
				return err
			}
			var p *managedProvider
			if in.ModelID != "" {
				m := reg.Models[in.ModelID]
				if m == nil || m.Deleted {
					return contracts.NewError("NOT_FOUND", "modelId")
				}
				in.ProviderID = m.ProviderID
				if in.Model == "" {
					in.Model = m.Model
				}
				p = modelConnection(reg, m)
			} else {
				p = reg.Providers[in.ProviderID]
			}
			if p == nil || p.Deleted {
				return contracts.NewError("NOT_FOUND", "providerId")
			}
			if in.API == "" {
				in.API = p.API
			}
			if in.BaseURL == "" {
				in.BaseURL = p.BaseURL
			}
			if in.Credential == "" {
				key, err := a.files.ReadSecret(p.CredentialRef)
				if err != nil {
					return contracts.NewError("MODEL_UNAVAILABLE", "credential")
				}
				in.Credential = strings.TrimRight(string(key), "\r\n")
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	base, err := validManagedEndpoint(in.API, in.BaseURL)
	if err != nil {
		return err
	}
	in.BaseURL = base
	if err := validManagedCredential(in.Credential); err != nil {
		return err
	}
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	if _, busy := a.modelTests.LoadOrStore(actor.UserID, true); busy {
		return contracts.NewError("MODEL_TEST_BUSY", "")
	}
	defer a.modelTests.Delete(actor.UserID)
	result := a.checkModelHTTP(r.Context(), in)
	if err := a.Identity.AuthorizeAdministrator(r.Context(), actor); err != nil {
		return err
	}
	send(w, 200, result)
	return nil
}

func readModelTestInput(r *http.Request) (modelTestInput, error) {
	var in modelTestInput
	if values := r.Header.Values("Content-Type"); len(values) != 1 || values[0] != "application/json" {
		return in, contracts.NewError("UNSUPPORTED_MEDIA_TYPE", "")
	}
	body := &bodyReader{ReadCloser: r.Body}
	value, err := contracts.ParseJSON(body, 2<<20)
	if timedOut(body.err) {
		return in, contracts.NewError("REQUEST_TIMEOUT", "")
	}
	if err != nil {
		return in, err
	}
	object, ok := value.(map[string]any)
	if !ok {
		return in, contracts.NewError("INVALID_REQUEST", "")
	}
	schema := "DraftModelTestInputSchema"
	if _, present := object["modelId"]; present {
		schema = "SavedModelTestInputSchema"
	} else if _, present := object["providerId"]; present {
		schema = "ProviderModelTestInputSchema"
	}
	if err := contracts.Validate(schema, object); err != nil {
		return in, err
	}
	raw, _ := json.Marshal(object)
	if json.Unmarshal(raw, &in) != nil {
		return in, contracts.NewError("INVALID_REQUEST", "")
	}
	if strings.TrimSpace(in.Model) == "" && (in.ModelID == "" || in.Model != "") {
		return in, contracts.NewError("INVALID_REQUEST", "model")
	}
	return in, nil
}
func (a *Application) checkModelHTTP(ctx context.Context, in modelTestInput) contracts.ModelTestResult {
	start := time.Now()
	result := contracts.ModelTestFailure{Api: contracts.ModelApi(in.API), Model: in.Model, Category: "network", TestMessage: modelTestMessage}
	var replyText string
	var replyTruncated bool
	reason := "network"
	finish := func() contracts.ModelTestResult {
		info := modelTestFailures[reason]
		result.Reason, result.Category, result.Message, result.Recovery = reason, info.category, info.message, info.recovery
		result.CheckedAt = contracts.Timestamp(modelNow())
		result.DurationMs = time.Since(start).Milliseconds()
		var value any = result
		if replyText != "" {
			value = contracts.ModelTestSuccess{Success: true, Category: "success", Api: result.Api, Model: result.Model, TestMessage: modelTestMessage,
				CheckedAt: result.CheckedAt, DurationMs: result.DurationMs, HttpStatus: result.HttpStatus, ReplyText: replyText, ReplyTruncated: replyTruncated}
		}
		raw, _ := json.Marshal(value)
		return contracts.ModelTestResult(raw)
	}
	budget := 20 * time.Second
	if a.modelTestTimeout > 0 {
		budget = a.modelTestTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	path := "/responses"
	body := map[string]any{"model": in.Model, "input": modelTestMessage, "stream": false, "max_output_tokens": 128}
	if in.API == "anthropic-messages" {
		path = "/v1/messages"
		body = map[string]any{"model": in.Model, "messages": []map[string]string{{"role": "user", "content": modelTestMessage}}, "stream": false, "max_tokens": 128}
	}
	raw, _ := json.Marshal(body)
	request, err := http.NewRequestWithContext(ctx, "POST", in.BaseURL+path, bytes.NewReader(raw))
	if err != nil {
		return finish()
	}
	request.Header.Set("Content-Type", "application/json")
	if in.API == "anthropic-messages" {
		request.Header.Set("x-api-key", in.Credential)
		request.Header.Set("anthropic-version", "2023-06-01")
	} else {
		request.Header.Set("Authorization", "Bearer "+in.Credential)
	}
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(request)
	if err != nil {
		reason = modelTestNetworkReason(err)
		return finish()
	}
	defer response.Body.Close()
	result.HttpStatus = contracts.Supplied(int64(response.StatusCode))
	data, err := io.ReadAll(io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		reason = modelTestNetworkReason(err)
		return finish()
	}
	if len(data) > 64<<10 {
		reason = "response-too-large"
		return finish()
	}
	if providerReason := modelTestProviderReason(response.StatusCode, data); providerReason != "" {
		reason = providerReason
		return finish()
	}
	text, parseReason := modelTestAssistantText(in.API, data)
	if parseReason != "" {
		reason = parseReason
		return finish()
	}
	// Providers may echo the authentication value even in a successful message.
	// Redact before truncation so a boundary cannot expose a partial Key.
	text = strings.ReplaceAll(text, in.Credential, "[redacted]")
	if len(text) > 8<<10 {
		cut := 8 << 10
		for !utf8.RuneStart(text[cut]) {
			cut--
		}
		text = text[:cut]
		replyTruncated = true
	}
	replyText = text
	return finish()
}

// Only visible assistant text is projected. Reasoning, tool calls and protocol
// metadata remain in the bounded upstream response and are never returned.
func modelTestAssistantText(api string, data []byte) (string, string) {
	type block struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	type message struct {
		Type    string  `json:"type"`
		Role    string  `json:"role"`
		Content []block `json:"content"`
	}
	var reply struct {
		message
		Status string          `json:"status"`
		Error  json.RawMessage `json:"error"`
		Output []message       `json:"output"`
	}
	if json.Unmarshal(data, &reply) != nil || len(reply.Error) != 0 && string(reply.Error) != "null" {
		return "", "protocol-mismatch"
	}
	var messages []message
	blockType := "output_text"
	if api == "anthropic-messages" {
		if reply.Type != "message" || reply.Role != "assistant" {
			return "", "protocol-mismatch"
		}
		messages = []message{reply.message}
		blockType = "text"
	} else {
		if reply.Status != "completed" {
			return "", "protocol-mismatch"
		}
		messages = reply.Output
	}
	var parts []string
	for _, item := range messages {
		if item.Type != "message" || item.Role != "assistant" {
			continue
		}
		for _, content := range item.Content {
			if content.Type == blockType && strings.TrimSpace(content.Text) != "" {
				parts = append(parts, content.Text)
			}
		}
	}
	if len(parts) == 0 {
		return "", "empty-reply"
	}
	return strings.Join(parts, "\n"), ""
}
