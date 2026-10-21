package client

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestHTTPTransportStreamsBeforeCompletionAndCancels(t *testing.T) {
	lifetime, cancelLifetime := context.WithCancel(context.Background())
	defer cancelLifetime()
	finished := make(chan struct{})
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer close(finished)
		if r.Header.Get("Authorization") != "Bearer synthetic-private-token" {
			t.Error("identity was lost")
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: first\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer backend.Close()
	api, _ := New(backend.URL, "synthetic-private-token")
	ctx, cancel := context.WithTimeout(lifetime, 3*time.Second)
	response, err := api.Binary(ctx, "GET", "/events", nil, nil, -1)
	if err != nil {
		t.Fatal(err)
	}
	line, err := bufio.NewReader(response.Body).ReadString('\n')
	if err != nil || line != "data: first\n" {
		t.Fatal("stream was buffered or corrupted", err)
	}
	cancel()
	_ = response.Body.Close()
	select {
	case <-finished:
	case <-time.After(time.Second):
		t.Fatal("cancelled browser stream retained its Core request")
	}
}

func TestHTTPTransportPreservesUpgradeAndClosesHijackedConnections(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.EqualFold(r.Header.Get("Upgrade"), "piwork-fixture") {
			w.WriteHeader(400)
			return
		}
		connection, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer connection.Close()
		_, _ = buffer.WriteString("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: piwork-fixture\r\n\r\nready")
		_ = buffer.Flush()
		_, _ = buffer.ReadString('\n')
	}))
	defer backend.Close()
	api, _ := New(backend.URL, "")
	response, err := api.Binary(ctx, "GET", "/upgrade", http.Header{"Connection": {"Upgrade"}, "Upgrade": {"piwork-fixture"}}, nil, -1)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 101 {
		t.Fatal("upgrade status was lost", response.StatusCode)
	}
	if _, ok := response.Body.(io.ReadWriteCloser); !ok {
		t.Fatal("upgrade lost its duplex stream")
	}
	data := make([]byte, 5)
	if _, err := io.ReadFull(response.Body, data); err != nil || string(data) != "ready" {
		t.Fatal("upgrade stream was corrupted", err)
	}
	_ = response.Body.Close()
	done := make(chan error, 1)
	go func() { _, err := response.Body.Read(data); done <- err }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("closed transport still reads")
		}
	case <-time.After(time.Second):
		t.Fatal("hijacked connection survived shutdown")
	}
}
