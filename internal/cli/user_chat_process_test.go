package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"piwork/internal/client"
	"sync/atomic"
	"testing"
	"time"
)

func TestChatNativeInterruptCancelsOnlyOriginalAcceptedRun(t *testing.T) {
	if os.Getenv("PIWORK_TEST_CHAT_INTERRUPT_CHILD") == "1" {
		os.Exit(runUser([]string{"--json", "chat", "work-1", "--session", "session-1", "--message", "once"}, os.Stdout, os.Stderr))
	}
	streaming := make(chan struct{})
	var submissions, cancellations atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/works/work-1/runs":
			submissions.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"run": map[string]string{"runId": "run-original"}})
		case "/api/v1/works/work-1/runs/run-original/events":
			w.Header().Set("Content-Type", "application/x-ndjson")
			w.(http.Flusher).Flush()
			close(streaming)
			<-r.Context().Done()
		case "/api/v1/works/work-1/runs/run-original/cancel":
			cancellations.Add(1)
			w.Write([]byte(`{"accepted":true}`))
		case "/api/v1/works/work-1/runs/run-original":
			w.Write([]byte(`{"state":"RUN_STATE_CANCELLED"}`))
		default:
			t.Error("native Chat mutated another Run", r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "fixture", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	child := nativeTestCommand(t, "-test.run=^TestChatNativeInterruptCancelsOnlyOriginalAcceptedRun$")
	child.Env = append(os.Environ(), "PIWORK_TEST_CHAT_INTERRUPT_CHILD=1", "PIWORK_CONFIG_PATH="+path, "PIWORK_CORE_URL="+core.URL)
	var output, diagnostic bytes.Buffer
	child.Stdout = &output
	child.Stderr = &diagnostic
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { child.Process.Kill(); child.Wait() }()
	select {
	case <-streaming:
	case <-time.After(5 * time.Second):
		t.Fatal("native Chat did not stream")
	}
	if err := interruptTestProcess(child); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	select {
	case err := <-done:
		if errorCode(err) != 7 {
			t.Fatal("cancelled Run exit changed", err, diagnostic.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("native Chat did not cancel")
	}
	if submissions.Load() != 1 || cancellations.Load() != 1 || !bytes.Contains(output.Bytes(), []byte("run-original")) {
		t.Fatal("native interrupt lost original Run or replayed submission", output.String(), submissions.Load(), cancellations.Load())
	}
}
