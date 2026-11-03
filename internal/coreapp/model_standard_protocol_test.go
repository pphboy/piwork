package coreapp

import (
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type standardModelRequest struct {
	path, key, version, authorization string
	body                              map[string]any
	headers                           http.Header
}

func TestStandardModelTestDraftSavedAndOverrides(t *testing.T) {
	_, base, auth, _ := modelManagementFixture(t)
	for _, api := range []string{"anthropic-messages", "openai-responses"} {
		t.Run(api, func(t *testing.T) {
			requests := make(chan standardModelRequest, 20)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
				}
				requests <- standardModelRequest{r.URL.Path, r.Header.Get("x-api-key"), r.Header.Get("anthropic-version"), r.Header.Get("Authorization"), body, r.Header.Clone()}
				w.Header().Set("Content-Type", "application/json")
				if api == "anthropic-messages" {
					_, _ = w.Write([]byte(`{"type":"message","role":"assistant","content":[{"type":"text","text":"standard reply"}]}`))
				} else {
					_, _ = w.Write([]byte(`{"status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"standard reply"}]}]}`))
				}
			}))
			defer server.Close()

			root := server.URL + "/prefix"
			endpoint, path := root, "/prefix/v1/messages"
			if api == "openai-responses" {
				endpoint, path = root+"/v1", "/prefix/v1/responses"
			}
			status, saved := httpCall(t, base, "/api/v1/admin/models", "POST", auth, map[string]any{"api": api, "baseUrl": endpoint, "model": "saved-model", "credential": "synthetic-saved"})
			if status != http.StatusCreated {
				t.Fatalf("create model: %d %v", status, saved)
			}
			id := saved["id"].(string)
			_, port, err := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
			if err != nil {
				t.Fatal(err)
			}
			other := "http://" + net.JoinHostPort("localhost", port) + strings.TrimPrefix(endpoint, server.URL)
			cases := []struct {
				name, path, model, key string
				input                  map[string]any
			}{
				{"draft", path, "saved-model", "synthetic-saved", map[string]any{"api": api, "baseUrl": endpoint, "model": "saved-model", "credential": "synthetic-saved"}},
				{"other-host", path, "saved-model", "synthetic-saved", map[string]any{"api": api, "baseUrl": other, "model": "saved-model", "credential": "synthetic-saved"}},
				{"saved", path, "saved-model", "synthetic-saved", map[string]any{"modelId": id}},
				{"override", "/other/v1/" + map[string]string{"anthropic-messages": "messages", "openai-responses": "responses"}[api], "override-model", "synthetic-override", map[string]any{"modelId": id, "baseUrl": server.URL + "/other/v1/", "model": "override-model", "credential": "synthetic-override"}},
			}
			if api == "anthropic-messages" {
				for _, suffix := range []string{"/v1", "/v1/", "/"} {
					cases = append(cases, struct {
						name, path, model, key string
						input                  map[string]any
					}{"equivalent-" + suffix, path, "saved-model", "synthetic-saved", map[string]any{"api": api, "baseUrl": root + suffix, "model": "saved-model", "credential": "synthetic-saved"}})
				}
			}
			for _, tc := range cases {
				t.Run(tc.name, func(t *testing.T) {
					status, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, tc.input)
					if status != 200 || result["success"] != true || result["replyText"] != "standard reply" {
						t.Fatalf("test failed: %d %v", status, result)
					}
					got := <-requests
					if got.path != tc.path || got.body["model"] != tc.model || got.body["stream"] != false || len(got.body) != 4 {
						t.Fatalf("wrong target or body: %s %v", got.path, got.body)
					}
					if api == "anthropic-messages" {
						if got.key != tc.key || got.version != "2023-06-01" || got.authorization != "" || got.body["max_tokens"] != float64(64) {
							t.Fatal("incorrect Messages authentication or token limit")
						}
						messages, ok := got.body["messages"].([]any)
						if !ok || len(messages) != 1 || messages[0].(map[string]any)["content"] != "Reply OK" || messages[0].(map[string]any)["role"] != "user" {
							t.Fatal("incorrect Messages input")
						}
					} else if got.authorization != "Bearer "+tc.key || got.key != "" || got.body["input"] != "Reply OK" || got.body["max_output_tokens"] != float64(64) {
						t.Fatal("incorrect Responses authentication or input")
					}
					if !strings.HasPrefix(got.headers.Get("User-Agent"), "piwork/") {
						t.Fatal("Test did not identify its own client")
					}
					for header := range got.headers {
						switch http.CanonicalHeaderKey(header) {
						case "Content-Type", "Content-Length", "Accept-Encoding", "User-Agent", "X-Api-Key", "Anthropic-Version", "Authorization":
						default:
							t.Fatalf("unexpected additional request header: %s", header)
						}
					}
					select {
					case <-requests:
						t.Fatal("test issued more than one request")
					default:
					}
				})
			}
		})
	}
}

func TestModelTestDoesNotFollowRedirectWithCredential(t *testing.T) {
	_, base, auth, _ := modelManagementFixture(t)
	redirected := make(chan struct{}, 1)
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected <- struct{}{}
		w.WriteHeader(http.StatusOK)
	}))
	defer destination.Close()
	calls := 0
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		http.Redirect(w, r, destination.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	status, result := httpCall(t, base, "/api/v1/admin/model-tests", "POST", auth, map[string]any{
		"api": "anthropic-messages", "baseUrl": source.URL, "model": "synthetic-model", "credential": "synthetic-key",
	})
	if status != 200 || result["success"] != false || result["httpStatus"] != float64(http.StatusTemporaryRedirect) || calls != 1 {
		t.Fatalf("unexpected redirect result: %d %v calls=%d", status, result, calls)
	}
	select {
	case <-redirected:
		t.Fatal("model Test followed a redirect")
	default:
	}
}
