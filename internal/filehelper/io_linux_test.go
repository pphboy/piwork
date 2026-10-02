//go:build linux

package filehelper

import (
	"context"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/unix"
	"piwork/internal/fileprotocol"
)

func TestPipeReadCancellationPreservesFileTimeout(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	fd, err := pollableFile(reader)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	polling := &pollReader{ctx: ctx, fd: fd, deadline: time.Now().Add(time.Minute)}
	time.AfterFunc(20*time.Millisecond, cancel)
	started := time.Now()
	_, err = fileprotocol.Read(polling, true)
	if fileprotocol.Code(err) != "FILE_TRANSFER_TIMEOUT" || time.Since(started) > 250*time.Millisecond {
		t.Fatal("pipe cancel lost or unbounded", err, time.Since(started))
	}
}
func TestFullPipeWriteCancellationPreservesFileTimeout(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	fd, err := pollableFile(writer)
	if err != nil {
		t.Fatal(err)
	}
	for {
		_, err := unix.Write(fd, make([]byte, 4096))
		if err == unix.EAGAIN {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	time.AfterFunc(20*time.Millisecond, cancel)
	started := time.Now()
	err = fileprotocol.Write(&pollWriter{ctx: ctx, fd: fd, deadline: time.Now().Add(time.Minute)}, fileprotocol.Error, map[string]string{"code": "FILE_TRANSFER_TIMEOUT"}, false)
	if fileprotocol.Code(err) != "FILE_TRANSFER_TIMEOUT" || time.Since(started) > 250*time.Millisecond {
		t.Fatal("pipe cancel lost or unbounded", err, time.Since(started))
	}
}
