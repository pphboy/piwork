package coreapp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"piwork/internal/contracts"
)

func TestModelMessageTestExtractsOnlyAssistantTextAndBoundsReply(t *testing.T) {
	_, base, auth, _ := modelManagementFixture(t)
	const key = "synthetic-message-test-key"
	for _, api := range []string{"openai-responses", "anthropic-messages"} {
		for _, scenario := range []string{"actual", "empty", "reasoning", "tool", "user", "malformed", "redact", "truncate"} {
			t.Run(api+"/"+scenario, func(t *testing.T) {
				kind := "output_text"
				if api == "anthropic-messages" {
					kind = "text"
				}
				role, text := "assistant", "Response one"
				switch scenario {
				case "empty":
					text = " \n\t"
				case "reasoning":
					kind, text = "thinking", "private reasoning"
				case "tool":
					kind, text = "tool_use", "private tool arguments"
				case "user":
					role = "user"
				case "redact":
					text = "Echo " + key
				case "truncate":
					text = strings.Repeat("界", 3000)
				}
				content := []map[string]any{{"type": kind, "text": text}}
				if scenario == "actual" {
					content = append(content, map[string]any{"type": "thinking", "text": "never return this"}, map[string]any{"type": kind, "text": "Response two"})
				}
				message := map[string]any{"type": "message", "role": role, "content": content}
				var response any = map[string]any{"status": "completed", "error": nil, "output": []any{message}}
				if api == "anthropic-messages" {
					response = message
				}
				if scenario == "malformed" {
					content[0]["text"] = 12
				}
				calls := 0
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls++
					_ = json.NewEncoder(w).Encode(response)
				}))
				defer server.Close()
				code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": api, "baseUrl": server.URL, "model": "specified-model", "credential": key})
				if code != 200 || calls != 1 || contracts.Validate("ModelTestResultSchema", result) != nil {
					t.Fatal("invalid bounded result", code, calls, result)
				}
				if result["model"] != "specified-model" || result["testMessage"] != modelTestMessage {
					t.Fatal("wrong target or message")
				}
				if scenario == "actual" || scenario == "redact" || scenario == "truncate" {
					if result["success"] != true {
						t.Fatal(result)
					}
					text := result["replyText"].(string)
					if !utf8.ValidString(text) || len(text) > 8<<10 || strings.Contains(text, key) || strings.Contains(text, "never return") {
						t.Fatal("unsafe reply projection")
					}
					if scenario == "actual" && text != "Response one\nResponse two" || scenario == "redact" && text != "Echo [redacted]" || result["replyTruncated"] != (scenario == "truncate") {
						t.Fatal("wrong reply or truncation")
					}
				} else if result["success"] != false || result["category"] != "protocol" || result["replyText"] != nil || result["replyTruncated"] != nil {
					t.Fatal("non-text response accepted", result)
				}
			})
		}
	}
}

func TestModelMessageTestReportsIncompleteText(t *testing.T) {
	_, base, auth, _ := modelManagementFixture(t)
	for _, tc := range []struct {
		name, api, body string
		success         bool
		truncated       bool
	}{
		{"responses incomplete text", "openai-responses", `{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"message","role":"assistant","status":"incomplete","content":[{"type":"output_text","text":"Partial reply"}]}]}`, true, true},
		{"responses incomplete without text", "openai-responses", `{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"reasoning"}]}`, false, false},
		{"messages token limit", "anthropic-messages", `{"type":"message","role":"assistant","stop_reason":"max_tokens","content":[{"type":"text","text":"Partial reply"}]}`, true, true},
		{"messages context limit", "anthropic-messages", `{"type":"message","role":"assistant","stop_reason":"model_context_window_exceeded","content":[{"type":"text","text":"Partial reply"}]}`, true, true},
		{"messages context limit without text", "anthropic-messages", `{"type":"message","role":"assistant","stop_reason":"model_context_window_exceeded","content":[]}`, false, false},
		{"messages natural end", "anthropic-messages", `{"type":"message","role":"assistant","stop_reason":"end_turn","content":[{"type":"text","text":"Partial reply"}]}`, true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(tc.body))
			}))
			defer server.Close()
			code, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{"api": tc.api, "baseUrl": server.URL, "model": "synthetic", "credential": "synthetic-key"})
			if code != 200 || result["success"] != tc.success {
				t.Fatalf("unexpected result: %d %v", code, result)
			}
			if tc.success && (result["replyText"] != "Partial reply" || result["replyTruncated"] != tc.truncated) {
				t.Fatal("incorrect text or truncation status", result)
			}
			if !tc.success && (result["reason"] != "empty-reply" || result["replyText"] != nil) {
				t.Fatal("empty incomplete response was presented as text", result)
			}
		})
	}
}
