package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestLogsExportNativeInterruptReturns130AndKeepsOriginalID(t *testing.T) {
	if os.Getenv("PIWORK_TEST_LOGS_INTERRUPT_CHILD") == "1" {
		os.Exit(runUser([]string{"--json", "logs", "export", "--output", os.Getenv("PIWORK_TEST_LOGS_OUTPUT")}, os.Stdout, os.Stderr))
	}
	observed := make(chan struct{})
	var once sync.Once
	var posts, contents atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/log-exports":
			posts.Add(1)
			w.WriteHeader(202)
			io.WriteString(w, `{"exportId":"log-export-15151515151515151515151515151515","correlationId":"c","cutoffTime":"2026-10-21T00:00:00Z","state":"collecting","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"reused":false}`)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/log-exports/log-export-15151515151515151515151515151515":
			once.Do(func() { close(observed) })
			<-r.Context().Done()
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/log-exports/log-export-15151515151515151515151515151515/content":
			contents.Add(1)
			w.WriteHeader(500)
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(t.TempDir(), "interrupted.zip")
	child := nativeTestCommand(t, "-test.run=^TestLogsExportNativeInterruptReturns130AndKeepsOriginalID$")
	child.Env = append(os.Environ(), "PIWORK_TEST_LOGS_INTERRUPT_CHILD=1", "PIWORK_CONFIG_PATH="+credential, "PIWORK_CORE_URL="+core.URL, "PIWORK_TEST_LOGS_OUTPUT="+output)
	var stdout, stderr bytes.Buffer
	child.Stdout = &stdout
	child.Stderr = &stderr
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { child.Process.Kill(); child.Wait() }()
	select {
	case <-observed:
	case <-time.After(5 * time.Second):
		t.Fatal("logs export did not observe the accepted task")
	}
	if err := interruptTestProcess(child); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	select {
	case err := <-done:
		if errorCode(err) != 130 {
			t.Fatalf("interrupted logs export exit: %v %s", err, stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("logs export did not stop on SIGINT")
	}
	var envelope map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil || envelope["exportId"] != "log-export-15151515151515151515151515151515" {
		t.Fatalf("interrupted export lost the original ID: %s %v", stdout.String(), err)
	}
	if posts.Load() != 1 || contents.Load() != 0 {
		t.Fatalf("interrupt mutated the accepted task: posts=%d contents=%d", posts.Load(), contents.Load())
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("interrupted export published a local archive")
	}
}
