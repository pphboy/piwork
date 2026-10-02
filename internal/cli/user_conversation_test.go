package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestChatSubmitsOneRunAndStreamsWithoutResubmission(t *testing.T) {
	sessions, runs, streams := 0, 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer chat-token" {
			t.Error("missing bearer")
		}
		switch r.URL.Path {
		case "/api/v1/works/work-1/sessions":
			sessions++
			json.NewEncoder(w).Encode(map[string]string{"sessionId": "session-1"})
		case "/api/v1/works/work-1/runs":
			runs++
			var input map[string]string
			if json.NewDecoder(r.Body).Decode(&input) != nil || input["prompt"] != "hello" || input["sessionId"] != "session-1" || input["submissionKey"] == "" {
				t.Error("bad run submission", input)
			}
			json.NewEncoder(w).Encode(map[string]any{"run": map[string]string{"runId": "run-1"}, "reused": false})
		case "/api/v1/works/work-1/runs/run-1/events":
			streams++
			if r.URL.Query().Get("after") != "0" {
				t.Error("wrong stream cursor")
			}
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.Write([]byte(`{"sequence":1,"kind":{"$case":"text","text":{"delta":"answer"}}}` + "\n"))
		case "/api/v1/works/work-1/runs/run-1":
			json.NewEncoder(w).Encode(map[string]string{"state": "RUN_STATE_SUCCEEDED"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "chat-token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "chat", "work-1", "--message", "hello"}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	if sessions != 1 || runs != 1 || streams != 1 {
		t.Fatal("chat resubmitted or skipped", sessions, runs, streams)
	}
	if lines := strings.Split(strings.TrimSpace(out.String()), "\n"); len(lines) != 3 {
		t.Fatal("chat output shape", out.String())
	}
}

func TestChatInterruptExplicitlyCancelsAcceptedRun(t *testing.T) {
	streaming := make(chan struct{})
	var cancellations int
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/works/work-1/runs":
			json.NewEncoder(w).Encode(map[string]any{"run": map[string]string{"runId": "run-1"}})
		case "/api/v1/works/work-1/runs/run-1/events":
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.(http.Flusher).Flush()
			close(streaming)
			<-r.Context().Done()
		case "/api/v1/works/work-1/runs/run-1/cancel":
			cancellations++
			w.Write([]byte(`{"accepted":true}`))
		case "/api/v1/works/work-1/runs/run-1":
			w.Write([]byte(`{"state":"RUN_STATE_CANCELLED"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	api, err := client.New(core.URL, "token")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		var out, diagnostic bytes.Buffer
		_, err := chatOnce(ctx, api, chatOptions{workID: "work-1", session: "session-1", message: "hello", one: true}, true, &out, &diagnostic)
		result <- err
	}()
	select {
	case <-streaming:
	case <-time.After(3 * time.Second):
		t.Fatal("Run stream did not begin")
	}
	cancel()
	select {
	case err := <-result:
		var failure *client.APIError
		if !errors.As(err, &failure) || failure.Code != "RUN_FAILED" || cancellations != 1 {
			t.Fatal("accepted Run was not explicitly cancelled", err, cancellations)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("interrupt did not terminate")
	}
}

func TestConversationCommandValidationPrecedesCredentialIO(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "credential"))
	for _, args := range [][]string{
		{"run", "watch", "work-1", "run-1", "--after", "-1"},
		{"chat", "work-1", "--message", "one", "--message", "two"},
		{"session", "show", "work-1"},
	} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 2 || strings.Contains(diagnostic.String(), "credential") {
			t.Fatal("invalid conversation command reached credential IO", code, diagnostic.String())
		}
	}
}

func TestChatDisconnectPreservesRunAndResumesWithoutSubmission(t *testing.T) {
	submissions, streams := 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/works/work-1/runs":
			submissions++
			json.NewEncoder(w).Encode(map[string]any{"run": map[string]string{"runId": "run-recover"}})
		case "/api/v1/works/work-1/runs/run-recover/events":
			streams++
			w.Header().Set("Content-Type", "application/x-ndjson")
			if streams == 1 {
				// A valid event followed by an incomplete HTTP body models observer loss.
				w.Header().Set("Content-Length", "4096")
				w.Write([]byte(`{"sequence":1,"kind":{"$case":"text","text":{"delta":"partial"}}}` + "\n"))
				return
			}
			if r.URL.Query().Get("after") != "1" {
				t.Error("resume discarded cursor", r.URL.RawQuery)
			}
			w.Write([]byte(`{"sequence":2,"kind":{"$case":"text","text":{"delta":"finished"}}}` + "\n"))
		case "/api/v1/works/work-1/runs/run-recover":
			w.Write([]byte(`{"runId":"run-recover","state":"RUN_STATE_SUCCEEDED"}`))
		default:
			t.Error("unexpected recovery mutation", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "fixture", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "chat", "work-1", "--session", "session-1", "--message", "once"}, &out, &diagnostic); code == 0 || !strings.Contains(out.String(), "run-recover") || !strings.Contains(diagnostic.String(), "--after 1") {
		t.Fatal(code, out.String(), diagnostic.String())
	}
	for _, args := range [][]string{{"--json", "run", "show", "work-1", "run-recover"}, {"--json", "run", "watch", "work-1", "run-recover", "--after", "1"}} {
		out.Reset()
		diagnostic.Reset()
		if code := runUser(args, &out, &diagnostic); code != 0 {
			t.Fatal(code, diagnostic.String())
		}
	}
	if submissions != 1 || streams != 2 {
		t.Fatal("recovery resubmitted prompt", submissions, streams)
	}
}
