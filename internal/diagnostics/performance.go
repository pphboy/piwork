package diagnostics

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"sync"
	"time"

	"piwork/internal/contracts"
)

// Performance events are process logs, independent of the public and durable
// Operation diagnostic contract. No untrusted text is accepted by this API.
type PerformanceIdentity struct {
	CorrelationID string
	WorkID        string
	OperationID   string
}

type performanceKey struct{}
type performanceWriterKey struct{}
type performanceSinkKey struct{}
type serializedPerformanceWriter struct {
	mu     sync.Mutex
	writer io.Writer
}

func (w *serializedPerformanceWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.writer.Write(data)
}

type performanceScope struct {
	mu sync.Mutex
	id PerformanceIdentity
}

func WithPerformance(ctx context.Context, id PerformanceIdentity) context.Context {
	return context.WithValue(ctx, performanceKey{}, &performanceScope{id: id})
}

func WithPerformanceIfAbsent(ctx context.Context, id PerformanceIdentity) context.Context {
	if _, ok := ctx.Value(performanceKey{}).(*performanceScope); ok {
		return ctx
	}
	return WithPerformance(ctx, id)
}

func WithPerformanceWriter(ctx context.Context, writer io.Writer) context.Context {
	if writer == nil {
		return ctx
	}
	return context.WithValue(ctx, performanceWriterKey{}, &serializedPerformanceWriter{writer: writer})
}

func PerformanceWriter(ctx context.Context) io.Writer {
	writer, _ := ctx.Value(performanceWriterKey{}).(io.Writer)
	return writer
}

func WithPerformanceSink(ctx context.Context, sink Sink) context.Context {
	return context.WithValue(ctx, performanceSinkKey{}, sink)
}

// Shared preparations keep their own identity and lifetime, while writing to
// the same bounded destination as the request that started them.
func CopyPerformanceDestination(destination, source context.Context) context.Context {
	if writer, ok := source.Value(performanceWriterKey{}).(io.Writer); ok && writer != nil {
		destination = context.WithValue(destination, performanceWriterKey{}, writer)
	}
	if sink, ok := source.Value(performanceSinkKey{}).(Sink); ok && sink != nil {
		destination = WithPerformanceSink(destination, sink)
	}
	return destination
}

// BindPerformance attaches accepted business identities without changing the
// correlation shared by spans already started for the request.
func BindPerformance(ctx context.Context, workID, operationID string) {
	if scope, ok := ctx.Value(performanceKey{}).(*performanceScope); ok {
		scope.mu.Lock()
		scope.id.WorkID, scope.id.OperationID = workID, operationID
		scope.mu.Unlock()
	}
}

type PerformanceSpan struct {
	ctx   context.Context
	phase string
	start time.Time
	once  sync.Once
}

func BeginPerformance(ctx context.Context, phase string) *PerformanceSpan {
	span := &PerformanceSpan{ctx: ctx, phase: phase, start: time.Now()}
	span.write("started", 0, "", "")
	return span
}

func (s *PerformanceSpan) End(err error) { s.EndCache(err, "", "") }

func (s *PerformanceSpan) EndCache(err error, cacheState, preparationCorrelation string) {
	if s == nil {
		return
	}
	s.once.Do(func() {
		outcome := "succeeded"
		if err != nil {
			outcome = "failed"
			if s.ctx.Err() != nil {
				outcome = "cancelled"
			}
		}
		s.write(outcome, time.Since(s.start), cacheState, preparationCorrelation)
	})
}

func (s *PerformanceSpan) write(outcome string, duration time.Duration, cacheState, preparationCorrelation string) {
	if !performancePhase(s.phase) || duration < 0 || (cacheState != "" && cacheState != "hit" && cacheState != "prepare" && cacheState != "shared") {
		return
	}
	scope, ok := s.ctx.Value(performanceKey{}).(*performanceScope)
	if !ok {
		return
	}
	scope.mu.Lock()
	id := scope.id
	scope.mu.Unlock()
	if contracts.Validate("ResourceIdSchema", id.CorrelationID) != nil {
		return
	}
	value := map[string]any{"timestamp": time.Now().UTC().Format(time.RFC3339Nano), "event": "performance", "phase": s.phase,
		"outcome": outcome, "durationMs": float64(duration) / float64(time.Millisecond), "correlationId": id.CorrelationID}
	for key, id := range map[string]string{"workId": id.WorkID, "operationId": id.OperationID, "preparationCorrelationId": preparationCorrelation} {
		if id != "" && contracts.Validate("ResourceIdSchema", id) == nil {
			value[key] = id
		}
	}
	if cacheState != "" {
		value["cacheState"] = cacheState
	}
	writer, _ := s.ctx.Value(performanceWriterKey{}).(io.Writer)
	if writer == nil {
		writer = os.Stderr
	}
	raw, _ := json.Marshal(value)
	// One write keeps concurrent lines intact for files and pipe-sized events.
	console := append(append([]byte(nil), raw...), '\n')
	_, _ = writer.Write(console)
	if sink, ok := s.ctx.Value(performanceSinkKey{}).(Sink); ok && sink != nil {
		sink.Performance(value, console)
	}
}

func performancePhase(phase string) bool {
	switch phase {
	case "create-request", "image-resolve", "image-inspection", "environment-probe", "context-capture", "acceptance",
		"runtime-prepare", "container-start", "readiness-rpc", "diagnostic-collection", "activation",
		"startup-docker", "startup-agent", "startup-package-helper", "startup-default-context", "startup-file-helper", "startup-snapshot-helper", "startup-recovery", "work-verification",
		"agent-image-persistent-hit", "file-image-persistent-hit", "snapshot-image-persistent-hit", "image-export", "image-scan", "environment-persistent-hit", "environment-probe-execute":
		return true
	}
	return false
}
