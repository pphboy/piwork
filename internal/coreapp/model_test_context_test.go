package coreapp

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestModelTestContextHeadersMatchOnlyConfirmedEndpoints(t *testing.T) {
	for _, tc := range []struct {
		api, endpoint string
		match         bool
	}{
		{"anthropic-messages", "https://opencode.ai/inference/go/anthropic/v1/messages", true},
		{"anthropic-messages", "https://opencode.ai:443/inference/go/anthropic/v1/messages", true},
		{"openai-responses", "https://opencode.ai/inference/go/openai/v1/responses", true},
		{"openai-responses", "https://opencode.ai:443/inference/go/openai/v1/responses", true},
		{"anthropic-messages", "https://opencode.ai.evil.invalid/inference/go/anthropic/v1/messages", false},
		{"anthropic-messages", "https://api.opencode.ai/inference/go/anthropic/v1/messages", false},
		{"anthropic-messages", "https://opencode.ai:8443/inference/go/anthropic/v1/messages", false},
		{"anthropic-messages", "http://opencode.ai/inference/go/anthropic/v1/messages", false},
		{"anthropic-messages", "https://opencode.ai/other/v1/messages", false},
		{"anthropic-messages", "https://opencode.ai/inference/go/anthropic/v1/messages/extra", false},
		{"anthropic-messages", "https://opencode.ai/inference/go/anthropic%2fv1/messages", false},
		{"anthropic-messages", "https://opencode.ai/inference/go/anthropic/v1/messages?other=1", false},
		{"anthropic-messages", "https://name@opencode.ai/inference/go/anthropic/v1/messages", false},
		{"anthropic-messages", "https://opencode.ai/inference/go/openai/v1/responses", false},
		{"openai-responses", "https://opencode.ai/inference/go/anthropic/v1/messages", false},
		{"unknown", "https://opencode.ai/inference/go/openai/v1/responses", false},
	} {
		t.Run(tc.api+"/"+tc.endpoint, func(t *testing.T) {
			target, err := url.Parse(tc.endpoint)
			if err != nil {
				t.Fatal(err)
			}
			id := uuid.NewString()
			headers := modelTestContextHeaders(tc.api, target, id, "synthetic")
			if headers.Get("User-Agent") != "piwork/synthetic" {
				t.Fatal("client identity was not preserved")
			}
			want := ""
			if tc.match {
				want = id
			}
			if headers.Get("x-opencode-session") != want || headers.Get("Authorization") != "" || headers.Get("x-api-key") != "" {
				t.Fatal("wrong request context")
			}
		})
	}
}

type modelTestCaptureTransport struct {
	next     http.RoundTripper
	requests chan standardModelRequest
}

func (t *modelTestCaptureTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Hostname() != "opencode.ai" {
		return t.next.RoundTrip(r)
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, err
	}
	t.requests <- standardModelRequest{r.URL.Path, r.Header.Get("x-api-key"), r.Header.Get("anthropic-version"), r.Header.Get("Authorization"), body, r.Header.Clone()}
	response := `{"type":"message","role":"assistant","content":[{"type":"text","text":"OK"}]}`
	if body["input"] != nil {
		response = `{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"OK"}]}]}`
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": {"application/json"}}, Body: io.NopCloser(strings.NewReader(response)), Request: r}, nil
}

func TestModelTestContextAndProtocolOverridesUseOneRequest(t *testing.T) {
	_, base, auth, _ := modelManagementFixture(t)
	transport := &modelTestCaptureTransport{next: http.DefaultTransport, requests: make(chan standardModelRequest, 8)}
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = transport.next })
	seen := make(map[string]bool)
	endpoints := map[string]string{"anthropic-messages": "https://opencode.ai/inference/go/anthropic/v1/", "openai-responses": "https://opencode.ai/inference/go/openai/v1/"}
	for _, api := range []string{"anthropic-messages", "openai-responses"} {
		status, model := httpCall(t, base, "/api/v1/admin/models", "POST", auth, map[string]any{"api": api, "model": "saved-model", "baseUrl": endpoints[api], "credential": "synthetic-saved"})
		if status != 201 {
			t.Fatal(status, model)
		}
		_, before := httpCall(t, base, "/api/v1/admin/models/"+model["id"].(string), "GET", auth, nil)
		other := "anthropic-messages"
		if api == other {
			other = "openai-responses"
		}
		for _, selected := range []string{api, other} {
			input := map[string]any{"modelId": model["id"]}
			wantModel, wantKey := "saved-model", "synthetic-saved"
			if selected != api {
				input["api"], input["baseUrl"], input["model"], input["credential"] = selected, endpoints[selected], "override-model", "synthetic-override"
				wantModel, wantKey = "override-model", "synthetic-override"
			}
			status, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, input)
			if status != 200 || result["success"] != true || result["api"] != selected || result["testMessage"] != "Reply OK" {
				t.Fatal(status, result)
			}
			request := <-transport.requests
			id := request.headers.Get("x-opencode-session")
			if _, err := uuid.Parse(id); err != nil || seen[id] {
				t.Fatal("Test did not use a fresh anonymous UUID")
			}
			seen[id] = true
			if request.body["model"] != wantModel || len(request.body) != 4 || request.body["stream"] != false {
				t.Fatal("Test did not preserve the minimal target")
			}
			if selected == "anthropic-messages" {
				if request.path != "/inference/go/anthropic/v1/messages" || request.key != wantKey || request.authorization != "" {
					t.Fatal("Messages override changed endpoint or authority")
				}
			} else if request.path != "/inference/go/openai/v1/responses" || request.authorization != "Bearer "+wantKey || request.key != "" {
				t.Fatal("Responses override changed endpoint or authority")
			}
			select {
			case <-transport.requests:
				t.Fatal("Test replayed its request")
			default:
			}
		}
		_, after := httpCall(t, base, "/api/v1/admin/models/"+model["id"].(string), "GET", auth, nil)
		if fmtJSON(before) != fmtJSON(after) {
			t.Fatal("Test changed the saved model")
		}
	}
}
