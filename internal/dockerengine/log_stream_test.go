package dockerengine

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/moby/moby/api/types/container"
	"github.com/moby/moby/client"
)

func logFrame(stream byte, payload []byte) []byte {
	header := make([]byte, 8)
	header[0] = stream
	binary.BigEndian.PutUint32(header[4:], uint32(len(payload)))
	return append(header, payload...)
}

type logServer struct {
	runtime      *Runtime
	logRequests  atomic.Int64
	until        atomic.Value
	lastQuery    atomic.Value
	writeFrames  func(http.ResponseWriter)
	hostConfig   *container.HostConfig
	config       *container.Config
	containerID  string
	labels       map[string]string
	blockForever bool
}

func newLogFixture(t *testing.T, configure func(*logServer)) *logServer {
	t.Helper()
	path := shortEngineSocket(t, "logs.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	fixture := &logServer{
		containerID: "container-exact",
		labels:      map[string]string{InstallationLabel: "installation-fixture", ManagedLabel: "true", WorkLabel: "work-fixture", KindLabel: "agent", LogicalLabel: "agent-fixture"},
		config:      &container.Config{Tty: false, Labels: map[string]string{}},
		hostConfig:  &container.HostConfig{LogConfig: container.LogConfig{Type: "json-file"}},
	}
	fixture.config.Labels = fixture.labels
	if configure != nil {
		configure(fixture)
	}
	handler := http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		path := strings.TrimPrefix(req.URL.Path, "/v1.45")
		switch {
		case path == "/containers/json":
			result := []container.Summary{{ID: fixture.containerID, Labels: fixture.labels}}
			_ = json.NewEncoder(w).Encode(result)
		case path == "/containers/"+fixture.containerID+"/json":
			_ = json.NewEncoder(w).Encode(container.InspectResponse{ID: fixture.containerID, Config: fixture.config, HostConfig: fixture.hostConfig})
		case path == "/containers/"+fixture.containerID+"/logs":
			fixture.logRequests.Add(1)
			fixture.lastQuery.Store(req.URL.RawQuery)
			w.Header().Set("Content-Type", "application/vnd.docker.multiplexed-stream")
			w.WriteHeader(http.StatusOK)
			flusher, _ := w.(http.Flusher)
			if fixture.writeFrames != nil {
				fixture.writeFrames(w)
				if flusher != nil {
					flusher.Flush()
				}
			}
			if fixture.blockForever {
				<-req.Context().Done()
			}
		default:
			http.NotFound(w, req)
		}
	})
	server := &http.Server{Handler: handler}
	go server.Serve(listener)
	t.Cleanup(func() {
		server.Close()
		listener.Close()
	})
	api, err := client.NewClientWithOpts(client.WithHost("unix://"+path), client.WithVersion("1.45"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { api.Close() })
	runtime, err := NewRuntime(&Engine{api: api}, "installation-fixture", nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	fixture.runtime = runtime
	return fixture
}

func fullLogIdentity() ContainerIdentity {
	return ContainerIdentity{WorkID: "work-fixture", Kind: "agent", LogicalID: "agent-fixture"}
}

func TestFullLogsReadsCompleteSplitAndTimedStreams(t *testing.T) {
	stdoutPayload := "2026-10-21T00:00:00.000000001Z hello"
	rest := " world\n"
	long := "2026-10-21T00:00:02Z " + strings.Repeat("x", 100<<10) + "\n"
	stderrPayload := "2026-10-21T00:00:01Z stderr line\n"
	fixture := newLogFixture(t, func(server *logServer) {
		server.writeFrames = func(w http.ResponseWriter) {
			// A record split across Engine frames and HTTP writes.
			frames := [][]byte{
				logFrame(1, []byte(stdoutPayload)),
				logFrame(1, []byte(rest)),
				logFrame(2, []byte(stderrPayload)),
				logFrame(1, []byte(long)),
			}
			for _, frame := range frames {
				_, _ = w.Write(frame[:8])
				_, _ = w.Write(frame[8:])
				if flusher, ok := w.(http.Flusher); ok {
					flusher.Flush()
				}
			}
		}
	})
	until := time.Date(2026, 10, 21, 0, 0, 3, 0, time.UTC)
	var stdout, stderr bytes.Buffer
	result, err := fixture.runtime.FullLogs(context.Background(), fullLogIdentity(), FullLogRequest{
		ExpectedContainerID: fixture.containerID, Until: until, MaxBytes: 1 << 20,
	}, &stdout, &stderr)
	if err != nil {
		t.Fatal(err)
	}
	wantStdout := stdoutPayload + rest + long
	if stdout.String() != wantStdout || stderr.String() != stderrPayload {
		t.Fatalf("streams differ: %q / %q", stdout.String(), stderr.String())
	}
	if result.StdoutBytes != int64(len(wantStdout)) || result.StderrBytes != int64(len(stderrPayload)) || result.Truncated {
		t.Fatalf("unexpected result: %#v", result)
	}
	if result.StdoutDigest == "" || result.StderrDigest == "" {
		t.Fatal("digests missing")
	}
	query := fixture.lastQuery.Load().(string)
	for _, want := range []string{"stdout=1", "stderr=1", "timestamps=1", "tail=all"} {
		if !strings.Contains(query, want) {
			t.Fatalf("query missing %s: %s", want, query)
		}
	}
	if strings.Contains(query, "follow=1") || strings.Contains(query, "since=") {
		t.Fatalf("follow/since must remain unset: %s", query)
	}
	untilValue := ""
	for _, pair := range strings.Split(query, "&") {
		if strings.HasPrefix(pair, "until=") {
			untilValue = strings.TrimPrefix(pair, "until=")
		}
	}
	seconds, nanos, ok := strings.Cut(untilValue, ".")
	if !ok || seconds != strconv.FormatInt(until.Unix(), 10) || nanos != "000000000" {
		t.Fatalf("until bound not forwarded: %s", query)
	}
	if !strings.Contains(stdout.String(), "hello world") {
		t.Fatal("long or split output missing")
	}
}

func TestFullLogsRejectsReplacementDriverAndLimits(t *testing.T) {
	fixture := newLogFixture(t, func(server *logServer) {
		server.writeFrames = func(w http.ResponseWriter) {
			_, _ = w.Write(logFrame(1, []byte("2026-10-21T00:00:00Z 0123456789abcdef\n")))
		}
	})
	ctx := context.Background()
	identity := fullLogIdentity()
	until := time.Date(2026, 10, 21, 0, 0, 1, 0, time.UTC)

	var stdout, stderr bytes.Buffer
	if _, err := fixture.runtime.FullLogs(ctx, identity, FullLogRequest{ExpectedContainerID: "container-other", Until: until, MaxBytes: 1024}, &stdout, &stderr); !errors.Is(err, ErrIdentity) {
		t.Fatalf("replacement instance read: %v", err)
	}
	if fixture.logRequests.Load() != 0 {
		t.Fatal("replacement instance reached the log endpoint")
	}
	if _, err := fixture.runtime.FullLogs(ctx, ContainerIdentity{WorkID: "work-fixture", Kind: "volume", LogicalID: "agent-fixture"}, FullLogRequest{ExpectedContainerID: fixture.containerID, Until: until, MaxBytes: 1024}, &stdout, &stderr); !errors.Is(err, ErrSpecification) {
		t.Fatalf("other resource kind was expanded: %v", err)
	}

	fixture.hostConfig = &container.HostConfig{LogConfig: container.LogConfig{Type: "journald"}}
	if _, err := fixture.runtime.FullLogs(ctx, identity, FullLogRequest{ExpectedContainerID: fixture.containerID, Until: until, MaxBytes: 1024}, &stdout, &stderr); !errors.Is(err, ErrLogDriverUnsupported) {
		t.Fatalf("unsupported driver read: %v", err)
	}
	fixture.hostConfig = &container.HostConfig{LogConfig: container.LogConfig{Type: "json-file"}}
	fixture.config.Tty = true
	if _, err := fixture.runtime.FullLogs(ctx, identity, FullLogRequest{ExpectedContainerID: fixture.containerID, Until: until, MaxBytes: 1024}, &stdout, &stderr); !errors.Is(err, ErrSpecification) {
		t.Fatalf("TTY stream read: %v", err)
	}
	fixture.config.Tty = false
	result, err := fixture.runtime.FullLogs(ctx, identity, FullLogRequest{ExpectedContainerID: fixture.containerID, Until: until, MaxBytes: 8}, &stdout, &stderr)
	if !errors.Is(err, ErrStreamLimit) || !result.Truncated || result.StdoutBytes > 8 {
		t.Fatalf("byte limit not enforced: %#v %v", result, err)
	}
}

func TestFullLogsHonorsCancellation(t *testing.T) {
	fixture := newLogFixture(t, func(server *logServer) {
		server.blockForever = true
		server.writeFrames = func(w http.ResponseWriter) {
			_, _ = w.Write(logFrame(1, []byte("2026-10-21T00:00:00Z partial")))
		}
	})
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	start := time.Now()
	var stdout, stderr bytes.Buffer
	_, err := fixture.runtime.FullLogs(ctx, fullLogIdentity(), FullLogRequest{
		ExpectedContainerID: fixture.containerID, Until: time.Now().UTC(), MaxBytes: 1 << 20,
	}, &stdout, &stderr)
	if err == nil {
		t.Fatal("cancelled stream succeeded")
	}
	if time.Since(start) > 2*time.Second {
		t.Fatal("cancellation was not bounded")
	}
}
