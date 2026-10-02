package dockerengine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/client"
)

func TestTransferLimitsExactEOFAndWriterFailure(t *testing.T) {
	for _, size := range []int{63, 64, 65} {
		reader := &boundedInput{reader: bytes.NewReader(bytes.Repeat([]byte{255}, size)), remaining: 64}
		var target bytes.Buffer
		_, err := io.Copy(&target, reader)
		if size <= 64 && err != nil || size > 64 && !errors.Is(err, ErrStreamLimit) {
			t.Fatal(size, err)
		}
		if target.Len() > 64 {
			t.Fatal(target.Len())
		}
	}
	for _, size := range []int{63, 64, 65} {
		var target bytes.Buffer
		_, err := copyTransfer(context.Background(), io.NopCloser(bytes.NewReader(bytes.Repeat([]byte{255}, size))), &target, 64)
		if size <= 64 && err != nil || size > 64 && !errors.Is(err, ErrStreamLimit) {
			t.Fatal(size, err)
		}
		if target.Len() > 64 {
			t.Fatal(target.Len())
		}
	}
}

type countedSource struct {
	remaining int64
	reads     atomic.Int64
}

func (s *countedSource) Read(out []byte) (int, error) {
	s.reads.Add(1)
	if s.remaining == 0 {
		return 0, io.EOF
	}
	n := len(out)
	if int64(n) > s.remaining {
		n = int(s.remaining)
	}
	for i := 0; i < n; i++ {
		out[i] = 'a'
	}
	s.remaining -= int64(n)
	return n, nil
}
func (s *countedSource) Close() error { return nil }
func TestTransferBackpressureAndCancelUnblocksDestination(t *testing.T) {
	source := &countedSource{remaining: 64 << 20}
	reader, writer := io.Pipe()
	defer reader.Close()
	defer writer.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := copyTransfer(ctx, source, writer, 64<<20); done <- err }()
	deadline := time.Now().Add(time.Second)
	for source.reads.Load() == 0 {
		if time.Now().After(deadline) {
			t.Fatal("copy never began")
		}
		time.Sleep(time.Millisecond)
	}
	time.Sleep(10 * time.Millisecond)
	if source.reads.Load() != 1 {
		t.Fatal("destination backpressure ignored", source.reads.Load())
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, ErrStream) {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancel did not unblock pipe destination")
	}
}
func TestImageLoadHTTP200ErrorAndInputLimit(t *testing.T) {
	socket := shortEngineSocket(t, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if !strings.HasSuffix(req.URL.Path, "/images/load") {
			http.NotFound(w, req)
			return
		}
		_, _ = io.Copy(io.Discard, req.Body)
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"errorDetail": map[string]string{"message": "untrusted secret source path"}})
	})}
	go server.Serve(listener)
	defer server.Close()
	defer listener.Close()
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+socket), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	defer api.Close()
	engine := &Engine{api: api}
	if err := engine.LoadImage(context.Background(), strings.NewReader("fixture"), 64); !errors.Is(err, ErrImageLoad) || strings.Contains(err.Error(), "secret") {
		t.Fatal(err)
	}
	if err := engine.LoadImage(context.Background(), strings.NewReader(strings.Repeat("a", 128)), 64); !errors.Is(err, ErrStreamLimit) {
		t.Fatal(err)
	}
}
