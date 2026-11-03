package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/moby/moby/client"
	"piwork/internal/testsupport"
)

func TestCleanupRejectsUnsafeLedgerBeforeEngineAndContinuesAfterFailure(t *testing.T) {
	if _, err := parseScopes([]byte("piwork-test-*")); err == nil {
		t.Fatal("broad scope accepted")
	}
	first, _ := testsupport.NewScope()
	second, _ := testsupport.NewScope()
	ids, err := parseScopes([]byte(first.ID() + "\n" + second.ID() + "\n" + first.ID()))
	if err != nil || len(ids) != 2 {
		t.Fatal("ledger identity mismatch", err)
	}
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(503)
		fmt.Fprint(w, `{"message":"synthetic Engine unavailable"}`)
	}))
	defer server.Close()
	engine, err := client.NewClientWithOpts(client.WithHost("tcp://"+strings.TrimPrefix(server.URL, "http://")), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	var diagnostics bytes.Buffer
	if err := cleanupScopes(ids, engine, io.Discard, &diagnostics); err == nil {
		t.Fatal("unavailable Engine treated as clean")
	}
	if !strings.Contains(diagnostics.String(), first.ID()) || !strings.Contains(diagnostics.String(), second.ID()) || calls.Load() < 6 {
		t.Fatal("one scope failure suppressed another resource cleanup", diagnostics.String(), calls.Load())
	}
}
