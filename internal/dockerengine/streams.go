package dockerengine

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

var ErrStream = errors.New("Docker stream protocol failed")
var ErrImagePull = errors.New("Docker image pull failed")
var ErrImageLoad = errors.New("Docker image load failed")

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(buffer)
}

// Demultiplex streams payloads with a fixed-size copy buffer. Frame lengths do
// not determine allocation size, and truncated frames never count as success.
func Demultiplex(ctx context.Context, input io.Reader, stdout, stderr io.Writer) error {
	if input == nil || stdout == nil || stderr == nil {
		return ErrSpecification
	}
	source := contextReader{ctx, input}
	var header [8]byte
	buffer := make([]byte, 32<<10)
	for {
		n, err := io.ReadFull(source, header[:])
		if err == io.EOF && n == 0 {
			return nil
		}
		if err != nil {
			return ErrStream
		}
		if header[1] != 0 || header[2] != 0 || header[3] != 0 || header[0] > 3 {
			return ErrStream
		}
		size := int64(binary.BigEndian.Uint32(header[4:]))
		target := stdout
		switch header[0] {
		case 2:
			target = stderr
		case 3:
			target = io.Discard
		}
		limited := &io.LimitedReader{R: source, N: size}
		if _, err := io.CopyBuffer(target, limited, buffer); err != nil {
			return ErrStream
		}
		if limited.N != 0 {
			return ErrStream
		}
		if header[0] == 3 {
			return ErrStream
		}
	}
}

type tailWriter struct {
	bytes     []byte
	limit     int
	truncated bool
}

func newTail(limit int) *tailWriter { return &tailWriter{limit: limit} }
func (w *tailWriter) Write(bytes []byte) (int, error) {
	n := len(bytes)
	if w.limit == 0 {
		w.truncated = w.truncated || n > 0
		return n, nil
	}
	if n >= w.limit {
		w.truncated = w.truncated || len(w.bytes) > 0 || n > w.limit
		w.bytes = append(w.bytes[:0], bytes[n-w.limit:]...)
		return n, nil
	}
	overflow := len(w.bytes) + n - w.limit
	if overflow > 0 {
		copy(w.bytes, w.bytes[overflow:])
		w.bytes = w.bytes[:len(w.bytes)-overflow]
		w.truncated = true
	}
	w.bytes = append(w.bytes, bytes...)
	return n, nil
}

// Engine pull/load uses newline-delimited JSON progress. An HTTP 200 carrying
// error/errorDetail is a failure. Raw registry messages never escape this layer.
func readImageProgress(ctx context.Context, input io.Reader, failure error) error {
	scanner := bufio.NewScanner(contextReader{ctx, input})
	scanner.Buffer(make([]byte, 4096), 1<<20)
	records := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var record map[string]json.RawMessage
		if json.Unmarshal(line, &record) != nil || record == nil {
			return failure
		}
		records++
		if data, ok := record["error"]; ok && string(data) != "null" && string(data) != `""` {
			return failure
		}
		if data, ok := record["errorDetail"]; ok && string(data) != "null" {
			return failure
		}
	}
	if scanner.Err() != nil || ctx.Err() != nil || records == 0 {
		return failure
	}
	return nil
}
