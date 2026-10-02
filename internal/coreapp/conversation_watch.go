package coreapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"sync"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/rpc/agentv1"
)

const observerBufferLimit = 1 << 20

var errSlowObserver = errors.New("Run observer exceeded its bounded send buffer")

type runObserver interface {
	GetRun(context.Context, string) (*agentv1.Run, error)
	WatchRun(context.Context, string, *uint64, func(*agentv1.RunEvent) error) error
}

func serveRunEvents(w http.ResponseWriter, r *http.Request, agent runObserver, runID string) error {
	after := uint64(0)
	if raw := r.URL.Query().Get("after"); raw != "" {
		value, err := strconv.ParseUint(raw, 10, 64)
		if err != nil || value > uint64(contracts.MaxSafeInteger) {
			return contracts.NewError("INVALID_REQUEST", "after")
		}
		after = value
	}
	current, err := agent.GetRun(r.Context(), runID)
	if err != nil {
		return conversationError(err)
	}
	if earliest := current.GetEarliestAvailableSequence(); earliest > 0 && after < earliest-1 {
		return contracts.NewError("CURSOR_EXPIRED", "")
	}
	return watchRunHTTP(w, r, agent, runID, after)
}

// observerBuffer separates one browser's socket pressure from the Agent RPC
// reader. A slow browser can consume at most one MiB of queued event bytes.
type observerBuffer struct {
	mu     sync.Mutex
	items  [][]byte
	head   int
	bytes  int
	done   bool
	err    error
	wakeup chan struct{}
}

func newObserverBuffer() *observerBuffer { return &observerBuffer{wakeup: make(chan struct{}, 1)} }

func (b *observerBuffer) signal() {
	select {
	case b.wakeup <- struct{}{}:
	default:
	}
}

func (b *observerBuffer) push(item []byte) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.done || len(item)+1 > observerBufferLimit || b.bytes+len(item)+1 > observerBufferLimit {
		return errSlowObserver
	}
	b.items = append(b.items, item)
	b.bytes += len(item) + 1
	b.signal()
	return nil
}

func (b *observerBuffer) finish(err error) {
	b.mu.Lock()
	b.done, b.err = true, err
	b.signal()
	b.mu.Unlock()
}

func (b *observerBuffer) pop() ([]byte, bool, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.head < len(b.items) {
		item := b.items[b.head]
		b.items[b.head] = nil
		b.head++
		b.bytes -= len(item) + 1
		if b.head == len(b.items) {
			b.items, b.head = nil, 0
		} else if b.head > 64 && b.head*2 >= len(b.items) {
			b.items = append([][]byte(nil), b.items[b.head:]...)
			b.head = 0
		}
		return item, false, nil
	}
	return nil, b.done, b.err
}

func watchRunHTTP(w http.ResponseWriter, r *http.Request, agent runObserver, runID string, after uint64) error {
	observer, cancel := context.WithCancel(r.Context())
	defer cancel()
	buffer := newObserverBuffer()
	go func() {
		err := agent.WatchRun(observer, runID, &after, func(event *agentv1.RunEvent) error {
			raw, err := json.Marshal(runEventView(event))
			if err != nil {
				return err
			}
			return buffer.push(raw)
		})
		buffer.finish(err)
	}()
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-store")
	response := http.NewResponseController(w)
	started := false
	for {
		if r.Context().Err() != nil {
			return nil
		}
		item, done, err := buffer.pop()
		if item != nil {
			if !started {
				w.WriteHeader(200)
				started = true
			}
			if err := response.SetWriteDeadline(time.Now().Add(5 * time.Second)); err != nil {
				panic(http.ErrAbortHandler)
			}
			if _, err := w.Write(append(item, '\n')); err != nil {
				panic(http.ErrAbortHandler)
			}
			if err := response.Flush(); err != nil {
				panic(http.ErrAbortHandler)
			}
			continue
		}
		if done {
			if err != nil && !errors.Is(err, context.Canceled) {
				if started {
					panic(http.ErrAbortHandler)
				}
				return conversationError(err)
			}
			if !started {
				w.WriteHeader(200)
			}
			return nil
		}
		select {
		case <-buffer.wakeup:
		case <-r.Context().Done():
			return nil
		}
	}
}
