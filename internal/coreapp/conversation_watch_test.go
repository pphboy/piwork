package coreapp

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

type expiredRunObserver struct{ watched bool }

func (*expiredRunObserver) GetRun(context.Context, string) (*agentv1.Run, error) {
	return &agentv1.Run{EarliestAvailableSequence: 5}, nil
}
func (o *expiredRunObserver) WatchRun(context.Context, string, *uint64, func(*agentv1.RunEvent) error) error {
	o.watched = true
	return nil
}

func TestExpiredRunCursorFailsBeforeOpeningEventStream(t *testing.T) {
	observer := &expiredRunObserver{}
	response := httptest.NewRecorder()
	request := httptest.NewRequest("GET", "/runs/run-1/events?after=3", nil)
	err := serveRunEvents(response, request, observer, "run-1")
	code, view := contracts.ProjectError(err)
	if code != 416 || view.Code != "CURSOR_EXPIRED" || observer.watched || response.Body.Len() != 0 {
		t.Fatal("expired cursor entered or wrote event stream", code, view, observer.watched)
	}
	code, view = contracts.ProjectError(conversationError(status.Error(codes.OutOfRange, "private event retention details")))
	if code != 416 || view.Code != "CURSOR_EXPIRED" || bytes.Contains([]byte(view.Message), []byte("private")) {
		t.Fatal("upstream expiry leaked or changed meaning", code, view)
	}
}

func TestObserverBufferIsBoundedPerConnection(t *testing.T) {
	buffer := newObserverBuffer()
	first := bytes.Repeat([]byte{'a'}, (observerBufferLimit/2)-1)
	second := bytes.Repeat([]byte{'b'}, (observerBufferLimit/2)-1)
	if err := buffer.push(first); err != nil {
		t.Fatal(err)
	}
	if err := buffer.push(second); err != nil {
		t.Fatal(err)
	}
	if err := buffer.push([]byte("overflow")); !errors.Is(err, errSlowObserver) {
		t.Fatal("slow observer gained unbounded memory", err)
	}
	item, done, err := buffer.pop()
	if done || err != nil || !bytes.Equal(item, first) {
		t.Fatal("first event changed under backpressure")
	}
	if err := buffer.push([]byte("after-drain")); err != nil {
		t.Fatal("space was not released after one event drained", err)
	}
	buffer.finish(errSlowObserver)
	for _, expected := range [][]byte{second, []byte("after-drain")} {
		item, done, err := buffer.pop()
		if done || err != nil || !bytes.Equal(item, expected) {
			t.Fatal("buffer lost ordered event before failure")
		}
	}
	if item, done, err := buffer.pop(); item != nil || !done || !errors.Is(err, errSlowObserver) {
		t.Fatal("bounded observer did not expose reconnectable failure", done, err)
	}
}

type burstObserver struct{ overflow chan struct{} }

func (*burstObserver) GetRun(context.Context, string) (*agentv1.Run, error) {
	return &agentv1.Run{EarliestAvailableSequence: 1}, nil
}
func (o *burstObserver) WatchRun(_ context.Context, runID string, _ *uint64, onEvent func(*agentv1.RunEvent) error) error {
	delta := strings.Repeat("x", 32<<10)
	for sequence := uint64(1); sequence <= 100; sequence++ {
		if err := onEvent(&agentv1.RunEvent{WorkId: "work-slow", RunId: runID, Sequence: sequence, Kind: &agentv1.RunEvent_Text{Text: &agentv1.TextEvent{Delta: delta}}}); err != nil {
			if errors.Is(err, errSlowObserver) {
				close(o.overflow)
			}
			return err
		}
	}
	return nil
}

type blockedResponse struct {
	header  http.Header
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *blockedResponse) Header() http.Header { return w.header }
func (*blockedResponse) WriteHeader(int)       {}
func (w *blockedResponse) Write(data []byte) (int, error) {
	w.once.Do(func() { close(w.started) })
	<-w.release
	return len(data), nil
}
func (*blockedResponse) Flush()                           {}
func (*blockedResponse) SetWriteDeadline(time.Time) error { return nil }

func TestSlowHTTPObserverTerminatesAtOneMiB(t *testing.T) {
	observer := &burstObserver{overflow: make(chan struct{})}
	response := &blockedResponse{header: make(http.Header), started: make(chan struct{}), release: make(chan struct{})}
	finished := make(chan any, 1)
	go func() {
		defer func() { finished <- recover() }()
		_ = watchRunHTTP(response, httptest.NewRequest("GET", "/events", nil), observer, "run-slow", 0)
	}()
	select {
	case <-response.started:
	case <-time.After(2 * time.Second):
		t.Fatal("slow writer never received first event")
	}
	select {
	case <-observer.overflow:
	case <-time.After(2 * time.Second):
		t.Fatal("producer remained blocked or allocated past observer limit")
	}
	close(response.release)
	select {
	case failure := <-finished:
		if failure != http.ErrAbortHandler {
			t.Fatal("slow observer did not get a reconnectable stream abort", failure)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("slow observer did not release after its socket resumed")
	}
}
