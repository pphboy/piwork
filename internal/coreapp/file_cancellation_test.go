package coreapp

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

func TestFileCancellationQuiescesBeforeConnectionReuse(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		connection, peer := net.Pipe()
		defer connection.Close()
		defer peer.Close()
		ctx, cancel := context.WithCancel(t.Context())
		entered, release := make(chan struct{}), make(chan struct{})
		releaseCallback := sync.OnceFunc(func() { close(release) })
		defer releaseCallback()
		stop := afterFileCancellation(ctx, func() {
			close(entered)
			<-release
			_ = connection.SetReadDeadline(time.Now())
		})
		cancel()
		<-entered
		stopped := make(chan struct{})
		go func() { stop(); close(stopped) }()
		synctest.Wait()
		select {
		case <-stopped:
			t.Fatal("request returned while its old deadline callback still owned the connection")
		default:
		}
		releaseCallback()
		<-stopped
		_ = connection.SetReadDeadline(time.Now().Add(3 * time.Second))
		written := make(chan error, 1)
		go func() { _, err := peer.Write([]byte("next request")); written <- err }()
		buffer := make([]byte, len("next request"))
		if _, err := io.ReadFull(connection, buffer); err != nil || string(buffer) != "next request" {
			t.Fatal("old request expired the next read", err)
		}
		if err := <-written; err != nil {
			t.Fatal(err)
		}
	})
}

func TestFileCancellationUnregistersUnusedCallback(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	called := make(chan struct{})
	stop := afterFileCancellation(ctx, func() { close(called) })
	stop()
	cancel()
	stop()
	select {
	case <-called:
		t.Fatal("completed request retained its I/O callback")
	default:
	}
}

func TestFileCancelledConnectionIsRetiredBeforeAnotherSession(t *testing.T) {
	for _, started := range []bool{false, true} {
		t.Run(map[bool]string{false: "before headers", true: "streaming"}[started], func(t *testing.T) {
			request := httptest.NewRequest("PUT", "http://fixture/files/value", nil)
			writer := &fileHTTPWriter{ResponseWriter: httptest.NewRecorder(), started: started}
			writer.retireCancelledConnection(request)
			if request.Close || writer.Header().Get("Connection") != "" {
				t.Fatal("ordinary file request lost keep-alive")
			}
			writer.cancelledIO.Store(true)
			if started {
				defer func() {
					if recover() != http.ErrAbortHandler {
						t.Fatal("cancelled stream must close its connection")
					}
				}()
			}
			writer.retireCancelledConnection(request)
			if !request.Close || writer.Header().Get("Connection") != "close" {
				t.Fatal("cancelled connection can leak its cancelled base context into another session")
			}
		})
	}
}
