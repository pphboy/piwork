package dockerengine

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"hash"
	"io"
	"time"

	"github.com/moby/moby/client"
)

// ErrLogDriverUnsupported means the bound instance's log driver cannot provide
// complete reads through the Engine API. Existing containers are never rebuilt
// just to change this capability.
var ErrLogDriverUnsupported = errors.New("Docker log driver does not support complete reads")

type FullLogRequest struct {
	// ExpectedContainerID is the exact instance registered before creation.
	// Empty values are rejected so a same-name replacement is never read.
	ExpectedContainerID string
	Until               time.Time
	MaxBytes            int64
}

type FullLogResult struct {
	StdoutBytes  int64
	StderrBytes  int64
	StdoutDigest string
	StderrDigest string
	Truncated    bool
}

type digestSink struct {
	writer    io.Writer
	hash      hash.Hash
	remaining *int64
	bytes     int64
	exceeded  bool
}

func (s *digestSink) Write(data []byte) (int, error) {
	if int64(len(data)) > *s.remaining {
		s.exceeded = true
		return 0, ErrStreamLimit
	}
	n, err := s.writer.Write(data)
	if n > 0 {
		_, _ = s.hash.Write(data[:n])
		s.bytes += int64(n)
		*s.remaining -= int64(n)
	}
	return n, err
}

// FullLogs reads every retained record for one exact Agent/Service instance at
// or before Until. Unlike Logs it never applies the 200-line/64 KiB tail view.
// The caller owns the time budget through ctx.
func (r *Runtime) FullLogs(ctx context.Context, identity ContainerIdentity, request FullLogRequest, stdout, stderr io.Writer) (FullLogResult, error) {
	var result FullLogResult
	if identity.Kind != "agent" && identity.Kind != "service" || request.ExpectedContainerID == "" || request.Until.IsZero() ||
		!validTransferLimit(request.MaxBytes) || stdout == nil || stderr == nil {
		return result, ErrSpecification
	}
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return result, err
	}
	if view == nil {
		return result, ErrResourceMissing
	}
	if view.ID != request.ExpectedContainerID {
		return result, ErrIdentity
	}
	if view.Config == nil || view.Config.Tty {
		return result, ErrSpecification
	}
	if view.HostConfig != nil {
		switch view.HostConfig.LogConfig.Type {
		case "", "json-file", "local":
		default:
			return result, ErrLogDriverUnsupported
		}
	}
	output, err := r.engine.api.ContainerLogs(ctx, view.ID, client.ContainerLogsOptions{
		ShowStdout: true, ShowStderr: true, Timestamps: true, Follow: false,
		Tail: "all", Until: request.Until.UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		return result, runtimeError(err)
	}
	defer output.Close()
	stop := context.AfterFunc(ctx, func() { output.Close() })
	defer stop()
	remaining := request.MaxBytes
	stdoutSink := &digestSink{writer: stdout, hash: sha256.New(), remaining: &remaining}
	stderrSink := &digestSink{writer: stderr, hash: sha256.New(), remaining: &remaining}
	err = Demultiplex(ctx, output, stdoutSink, stderrSink)
	result.StdoutBytes, result.StderrBytes = stdoutSink.bytes, stderrSink.bytes
	result.StdoutDigest = hex.EncodeToString(stdoutSink.hash.Sum(nil))
	result.StderrDigest = hex.EncodeToString(stderrSink.hash.Sum(nil))
	if err != nil {
		if stdoutSink.exceeded || stderrSink.exceeded {
			result.Truncated = true
			return result, ErrStreamLimit
		}
		return result, ErrStream
	}
	return result, nil
}
