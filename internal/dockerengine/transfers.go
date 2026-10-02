package dockerengine

import (
	"context"
	"errors"
	"io"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/contracts"
)

var ErrStreamLimit = errors.New("Docker transfer exceeds its byte limit")
var ErrArchive = errors.New("Docker archive transfer failed")

type limitedWriter struct {
	writer    io.Writer
	remaining int64
}

func (w *limitedWriter) Write(bytes []byte) (int, error) {
	if int64(len(bytes)) > w.remaining {
		return 0, ErrStreamLimit
	}
	n, err := w.writer.Write(bytes)
	w.remaining -= int64(n)
	return n, err
}

type boundedInput struct {
	reader    io.Reader
	remaining int64
}

func (r *boundedInput) Read(bytes []byte) (int, error) {
	if len(bytes) == 0 {
		return 0, nil
	}
	if r.remaining == 0 {
		var extra [1]byte
		n, err := r.reader.Read(extra[:])
		if n != 0 {
			return 0, ErrStreamLimit
		}
		return 0, err
	}
	if int64(len(bytes)) > r.remaining {
		bytes = bytes[:r.remaining]
	}
	n, err := r.reader.Read(bytes)
	r.remaining -= int64(n)
	return n, err
}
func validTransferLimit(maxBytes int64) bool {
	return maxBytes > 0 && maxBytes <= contracts.MaxSafeInteger
}
func copyTransfer(ctx context.Context, source io.ReadCloser, target io.Writer, maxBytes int64) (int64, error) {
	if !validTransferLimit(maxBytes) || target == nil {
		source.Close()
		return 0, ErrSpecification
	}
	defer source.Close()
	stop := context.AfterFunc(ctx, func() { source.Close() })
	defer stop()
	stopTarget := closeStreamOnCancel(ctx, target)
	defer stopTarget()
	size, err := io.CopyBuffer(&limitedWriter{writer: target, remaining: maxBytes}, contextReader{ctx, source}, make([]byte, 32<<10))
	if err != nil {
		if errors.Is(err, ErrStreamLimit) {
			return size, ErrStreamLimit
		}
		return size, ErrStream
	}
	if ctx.Err() != nil {
		return size, ErrStream
	}
	return size, nil
}

type ContainerLogs struct {
	Text      string
	Truncated bool
}

func (r *Runtime) Logs(ctx context.Context, identity ContainerIdentity, lines int, expectedContainerID string) (ContainerLogs, error) {
	if lines < 1 || lines > 200 {
		return ContainerLogs{}, ErrSpecification
	}
	request, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	view, err := r.findContainer(request, identity)
	if err != nil {
		return ContainerLogs{}, err
	}
	if view == nil {
		return ContainerLogs{}, nil
	}
	if expectedContainerID != "" && view.ID != expectedContainerID {
		return ContainerLogs{}, ErrIdentity
	}
	if view.Config == nil || view.Config.Tty {
		return ContainerLogs{}, ErrSpecification
	}
	output, err := r.engine.api.ContainerLogs(request, view.ID, client.ContainerLogsOptions{ShowStdout: true, ShowStderr: true, Tail: strconv.Itoa(lines)})
	if err != nil {
		return ContainerLogs{}, runtimeError(err)
	}
	defer output.Close()
	stop := context.AfterFunc(request, func() { output.Close() })
	defer stop()
	tail := newTail(64 << 10)
	if err := Demultiplex(request, output, tail, tail); err != nil {
		return ContainerLogs{}, err
	}
	return ContainerLogs{Text: string(tail.bytes), Truncated: tail.truncated}, nil
}

type Attached struct {
	connection client.ContainerAttachResult
	ctx        context.Context
	stop       func() bool
	once       sync.Once
}

func (r *Runtime) Attach(ctx context.Context, identity ContainerIdentity) (*Attached, error) {
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return nil, err
	}
	if view == nil {
		return nil, ErrResourceMissing
	}
	if view.Config == nil || view.Config.Tty || !view.Config.OpenStdin {
		return nil, ErrSpecification
	}
	stream, err := r.engine.api.ContainerAttach(ctx, view.ID, client.ContainerAttachOptions{Stream: true, Stdin: true, Stdout: true, Stderr: true})
	if err != nil {
		return nil, runtimeError(err)
	}
	attached := &Attached{connection: stream, ctx: ctx}
	attached.stop = context.AfterFunc(ctx, func() { stream.Close() })
	return attached, nil
}
func (a *Attached) Write(bytes []byte) (int, error) {
	if a.ctx.Err() != nil {
		return 0, ErrStream
	}
	n, err := a.connection.Conn.Write(bytes)
	if err != nil {
		return n, ErrStream
	}
	return n, nil
}
func (a *Attached) CloseWrite() error {
	if err := a.connection.CloseWrite(); err != nil {
		return ErrStream
	}
	return nil
}
func (a *Attached) CopyOutputs(stdout, stderr io.Writer) error {
	stopOut := closeStreamOnCancel(a.ctx, stdout)
	defer stopOut()
	stopErr := closeStreamOnCancel(a.ctx, stderr)
	defer stopErr()
	return Demultiplex(a.ctx, a.connection.Reader, stdout, stderr)
}
func (a *Attached) Close() error { a.once.Do(func() { a.stop(); a.connection.Close() }); return nil }
func validContainerPath(value string) bool {
	return strings.HasPrefix(value, "/") && path.Clean(value) == value && !strings.ContainsRune(value, 0)
}
func (r *Runtime) ArchiveFrom(ctx context.Context, identity ContainerIdentity, source string, target io.Writer, maxBytes int64) (int64, error) {
	if !validContainerPath(source) || !validTransferLimit(maxBytes) {
		return 0, ErrSpecification
	}
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return 0, err
	}
	if view == nil {
		return 0, ErrResourceMissing
	}
	output, err := r.engine.api.CopyFromContainer(ctx, view.ID, client.CopyFromContainerOptions{SourcePath: source})
	if err != nil {
		return 0, runtimeError(err)
	}
	return copyTransfer(ctx, output.Content, target, maxBytes)
}
func closeStreamOnCancel(ctx context.Context, input any) func() bool {
	if closer, ok := input.(io.Closer); ok {
		return context.AfterFunc(ctx, func() { closer.Close() })
	}
	return func() bool { return false }
}
func (r *Runtime) ArchiveTo(ctx context.Context, identity ContainerIdentity, destination string, input io.Reader, maxBytes int64) error {
	if !validContainerPath(destination) || !validTransferLimit(maxBytes) || input == nil {
		return ErrSpecification
	}
	view, err := r.findContainer(ctx, identity)
	if err != nil {
		return err
	}
	if view == nil {
		return ErrResourceMissing
	}
	stop := closeStreamOnCancel(ctx, input)
	defer stop()
	// Headers have already been authored/verified by Core. Do not ask Engine to
	// rewrite their ownership by looking up the container's numeric user in passwd.
	_, err = r.engine.api.CopyToContainer(ctx, view.ID, client.CopyToContainerOptions{DestinationPath: destination, Content: &boundedInput{reader: contextReader{ctx, input}, remaining: maxBytes}})
	if err != nil {
		if errors.Is(err, ErrStreamLimit) {
			return ErrStreamLimit
		}
		return ErrArchive
	}
	return nil
}
func (e *Engine) SaveImage(ctx context.Context, imageID string, target io.Writer, maxBytes int64) (int64, error) {
	if !imageIDPattern.MatchString(imageID) || !validTransferLimit(maxBytes) {
		return 0, ErrSpecification
	}
	if _, err := e.InspectImage(ctx, imageID); err != nil {
		return 0, err
	}
	output, err := e.api.ImageSave(ctx, []string{imageID})
	if err != nil {
		return 0, runtimeError(err)
	}
	return copyTransfer(ctx, output, target, maxBytes)
}

// LoadImage receives only previously verified image archives from Core. Loading
// transfers bytes to Engine; it does not create or execute a container.
func (e *Engine) LoadImage(ctx context.Context, input io.Reader, maxBytes int64) error {
	if !validTransferLimit(maxBytes) || input == nil {
		return ErrSpecification
	}
	stopInput := closeStreamOnCancel(ctx, input)
	defer stopInput()
	output, err := e.api.ImageLoad(ctx, &boundedInput{reader: contextReader{ctx, input}, remaining: maxBytes})
	if err != nil {
		if errors.Is(err, ErrStreamLimit) {
			return ErrStreamLimit
		}
		return ErrImageLoad
	}
	defer output.Close()
	stop := context.AfterFunc(ctx, func() { output.Close() })
	defer stop()
	return readImageProgress(ctx, output, ErrImageLoad)
}
