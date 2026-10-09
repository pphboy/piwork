package coreapp

import (
	"context"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"piwork/internal/contracts"
)

func TestManagedModelURLFormsShareTestSaveAndCapturedDefinition(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	ctx := context.Background()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/prefix/v1/messages" {
			t.Error("duplicated or lost URL prefix", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"type":"message","role":"assistant","content":[{"type":"text","text":"Actual prefixed reply"}]}`))
	}))
	defer server.Close()
	p, err := a.createModelProvider(ctx, actor, contracts.CreateModelProvider{Name: "URL forms", Api: "anthropic-messages", BaseUrl: server.URL + "/prefix/v1/", Credential: "synthetic-url-key"})
	if err != nil || p.BaseUrl != server.URL+"/prefix" {
		t.Fatal("valid Messages Base URL could not be saved", err)
	}
	m, err := a.createManagedModel(ctx, actor, string(p.Id), contracts.CreateManagedModel{Name: "Model", Model: "claude-sonnet-4-5"})
	if err != nil {
		t.Fatal(err)
	}
	for _, suffix := range []string{"/prefix", "/prefix/v1", "/prefix/v1/"} {
		code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "anthropic-messages", "baseUrl": server.URL + suffix, "model": "claude-sonnet-4-5", "credential": "synthetic-url-key"})
		if code != 200 || result["replyText"] != "Actual prefixed reply" {
			t.Fatal("draft Test rejected compatible URL", code, result)
		}
		_, err := a.patchModelProvider(ctx, actor, string(p.Id), contracts.PatchModelProvider{BaseUrl: contracts.Supplied(server.URL + suffix)})
		if err != nil {
			t.Fatal(err)
		}
		_, models, err := a.registryViews(ctx)
		if err != nil || models[0].ModelRef != m.ModelRef {
			t.Fatal("equivalent endpoint published a new modelRef", err)
		}
	}
	code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"modelId": m.Id})
	if code != 200 || result["success"] != true || calls != 4 {
		t.Fatal("saved Test did not use the same endpoint", code, calls)
	}
	if _, err := a.Settings.ConfigureRuntime(RuntimeInput{AgentImage: "fixture/native", Provider: "anthropic", Model: "claude-sonnet-4-5", BaseURL: func() *string { s := server.URL + "/prefix/v1/"; return &s }(), Credential: "synthetic-url-key"}); err != nil {
		t.Fatal(err)
	}
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil || profile.Model.BaseURL == nil || *profile.Model.BaseURL != p.BaseUrl {
		t.Fatal("Runtime initializer captured another endpoint", err)
	}
}

func TestModelTestErrorsPreserveFieldsAndSafeRecovery(t *testing.T) {
	a, base, auth, actor := modelManagementFixture(t)
	for _, field := range []string{"baseUrl", "model", "credential", "api"} {
		input := map[string]any{"api": "anthropic-messages", "baseUrl": "https://fixture.invalid/v1", "model": "synthetic", "credential": "synthetic-key"}
		delete(input, field)
		code, value := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, input)
		if code != 400 || value["field"] != field || value["correlationId"] == nil {
			t.Fatal("field validation was lost", field, code, value)
		}
	}
	code, invalid := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "anthropic-messages", "baseUrl": "https://fixture.invalid/v1", "model": "   ", "credential": "synthetic"})
	if code != 400 || invalid["field"] != "model" {
		t.Fatal("whitespace-only Model ID lost its field", code, invalid)
	}
	for _, tc := range []struct {
		status       int
		body, reason string
	}{
		{401, `private error`, "provider-authentication"}, {403, `{}`, "provider-authentication"}, {404, `{}`, "model-unavailable"}, {429, `{}`, "rate-limited"},
		{400, `{"error":{"code":"model_not_found","message":"synthetic-secret /private/path"}}`, "model-unavailable"},
		{400, `{"error":{"type":"invalid_request_error","param":"model"}}`, "model-unavailable"},
		{400, `{"error":{"code":"insufficient_quota"}}`, "rate-limited"}, {503, `{"error":{"message":"synthetic-secret /private/path"}}`, "provider-error"},
		{200, `{"status":"completed","output":[]}`, "empty-reply"}, {200, `{}`, "protocol-mismatch"}, {200, strings.Repeat("x", 65537), "response-too-large"},
	} {
		t.Run(tc.reason, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "openai-responses", "baseUrl": server.URL, "model": "synthetic", "credential": "synthetic-secret"})
			raw, _ := json.Marshal(result)
			if code != 200 || result["success"] != false || result["reason"] != tc.reason || contracts.Validate("ModelTestResultSchema", result) != nil || calls != 1 || strings.Contains(string(raw), "synthetic-secret") || strings.Contains(string(raw), "/private/path") {
				t.Fatal("unsafe or incorrect error", code, result)
			}
			p, err := a.createModelProvider(context.Background(), actor, contracts.CreateModelProvider{Name: "Failed Test still saves", Api: "openai-responses", BaseUrl: server.URL, Credential: "synthetic-secret"})
			if err != nil || !p.Enabled {
				t.Fatal("failed Test blocked saving", err)
			}
		})
	}
	for _, tc := range []struct {
		err    error
		reason string
	}{
		{&net.DNSError{Err: "private resolver", Name: "private.invalid"}, "dns"},
		{x509.UnknownAuthorityError{}, "tls"}, {&net.OpError{Op: "dial", Err: errors.New("private host")}, "connection"},
		{fmt.Errorf("wrapped: %w", context.DeadlineExceeded), "timeout"}, {errors.New("private detail"), "network"},
	} {
		if reason := modelTestNetworkReason(tc.err); reason != tc.reason {
			t.Fatal("wrong network classification", reason)
		}
	}
	// Exercise real TLS verification failure without disabling certificate checks.
	tlsServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer tlsServer.Close()
	code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "anthropic-messages", "baseUrl": tlsServer.URL + "/v1", "model": "synthetic", "credential": "synthetic-secret"})
	if code != 200 || result["reason"] != "tls" {
		t.Fatal("TLS validation failure was not explained", code, result)
	}
	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closedURL := closed.URL
	closed.Close()
	code, result = httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": "anthropic-messages", "baseUrl": closedURL + "/v1", "model": "synthetic", "credential": "synthetic-secret"})
	if code != 200 || result["reason"] != "connection" {
		t.Fatal("refused connection was not explained", code, result)
	}
	if _, err := a.createModelProvider(context.Background(), actor, contracts.CreateModelProvider{Name: "Unreachable still saves", Api: "anthropic-messages", BaseUrl: closedURL + "/v1", Credential: "synthetic-secret"}); err != nil {
		t.Fatal("network failure gated save", err)
	}
}
