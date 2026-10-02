//go:build linux

package filehelper

import (
	"context"
	"errors"
	"io"
	"os"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/fileprotocol"
)

type pollReader struct {
	ctx      context.Context
	fd       int
	deadline time.Time
}

func (reader *pollReader) setDeadline(deadline time.Time) error {
	reader.deadline = deadline
	return nil
}
func poll(ctx context.Context, fd int, events int16, deadline time.Time) error {
	for {
		if ctx.Err() != nil || !time.Now().Before(deadline) {
			return pathError("FILE_TRANSFER_TIMEOUT")
		}
		milliseconds := int(time.Until(deadline)/time.Millisecond) + 1
		if milliseconds > 100 {
			milliseconds = 100
		}
		descriptors := []unix.PollFd{{Fd: int32(fd), Events: events}}
		n, err := unix.Poll(descriptors, milliseconds)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return filesystemError(err)
		}
		if n > 0 {
			if descriptors[0].Revents&unix.POLLNVAL != 0 {
				return pathError("FILE_RUNTIME_UNAVAILABLE")
			}
			return nil
		}
	}
}
func (reader *pollReader) Read(buffer []byte) (int, error) {
	for {
		if err := poll(reader.ctx, reader.fd, unix.POLLIN, reader.deadline); err != nil {
			return 0, err
		}
		n, err := unix.Read(reader.fd, buffer)
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return 0, filesystemError(err)
		}
		if n == 0 {
			return 0, io.EOF
		}
		return n, nil
	}
}

type pollWriter struct {
	ctx      context.Context
	fd       int
	deadline time.Time
}

func (writer *pollWriter) Write(buffer []byte) (int, error) {
	deadline := time.Now().Add(fileprotocol.IdleTimeout)
	if writer.deadline.Before(deadline) {
		deadline = writer.deadline
	}
	for {
		if err := poll(writer.ctx, writer.fd, unix.POLLOUT, deadline); err != nil {
			return 0, err
		}
		part := buffer
		if len(part) > 4096 {
			part = part[:4096]
		}
		n, err := unix.Write(writer.fd, part)
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return 0, filesystemError(err)
		}
		return n, nil
	}
}

// Fd may restore blocking mode for an os.File owned by Go's poller. Capture it
// once, then set O_NONBLOCK; subsequent I/O uses only this captured descriptor.
func pollableFile(file *os.File) (int, error) {
	fd := int(file.Fd())
	return fd, unix.SetNonblock(fd, true)
}
