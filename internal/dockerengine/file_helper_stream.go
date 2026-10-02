package dockerengine

import (
	"context"
	"errors"
	"io"
	"reflect"
	"sync"
	"time"

	"github.com/moby/moby/api/types/container"
	"piwork/internal/fileprotocol"
)

type FileHelperStream struct {
	attached     *Attached
	reader       *io.PipeReader
	ctx          context.Context
	cancel       context.CancelFunc
	done         chan error
	closeOnce    sync.Once
	readDeadline time.Time
}

// Attach BEFORE start. The private stdout pipe carries only protocol frames;
// stderr has a bounded tail and is never exposed as public file diagnostics.
func (r *Runtime) AttachFileHelper(ctx context.Context, spec FileHelperSpec) (*FileHelperStream, error) {
	view, err := r.InspectFileHelper(ctx, spec)
	if err != nil {
		return nil, err
	}
	if view == nil {
		return nil, ErrResourceMissing
	}
	request, cancel := context.WithCancel(ctx)
	attached, err := r.Attach(request, FileHelperIdentity(spec))
	if err != nil {
		cancel()
		return nil, err
	}
	reader, writer := io.Pipe()
	stream := &FileHelperStream{attached: attached, reader: reader, ctx: request, cancel: cancel, done: make(chan error, 1)}
	go func() {
		err := attached.CopyOutputs(writer, newTail(8192))
		writer.CloseWithError(err)
		stream.done <- err
	}()
	return stream, nil
}
func (r *Runtime) InspectFileHelper(ctx context.Context, spec FileHelperSpec) (*container.InspectResponse, error) {
	view, err := r.InspectContainer(ctx, FileHelperIdentity(spec))
	if err != nil || view == nil {
		return view, err
	}
	if err := r.validateFileHelper(ctx, spec, view); err != nil {
		return nil, err
	}
	return view, nil
}
func (r *Runtime) validateFileHelper(ctx context.Context, spec FileHelperSpec, view *container.InspectResponse) error {
	config, host := view.Config, view.HostConfig
	if config == nil || host == nil || config.Image != spec.ImageID || config.User != "10001:10001" || config.Tty || !config.OpenStdin || !reflect.DeepEqual([]string(config.Entrypoint), []string{"/usr/local/bin/piwork-file-helper"}) {
		return ErrSpecificationConflict
	}
	if !reflect.DeepEqual([]string(config.Cmd), []string{"--job-id", spec.JobID, "--work-id", spec.WorkID, "--epoch", view.Config.Labels[FileEpochLabel]}) || host.NetworkMode != "none" || !host.ReadonlyRootfs || host.Privileged || len(host.PortBindings) != 0 || host.NanoCPUs != 500000000 || host.Memory != 128<<20 || host.PidsLimit == nil || *host.PidsLimit != 32 || !reflect.DeepEqual(host.CapDrop, []string{"ALL"}) || !reflect.DeepEqual(host.SecurityOpt, []string{"no-new-privileges:true"}) || len(view.Mounts) != 1 {
		return ErrSpecificationConflict
	}
	if !reflect.DeepEqual(host.Tmpfs, map[string]string{"/tmp": "rw,noexec,nosuid,nodev,size=16m,mode=1777"}) || len(host.CapAdd) != 0 || len(host.Devices) != 0 || len(host.Binds) != 0 {
		return ErrSpecificationConflict
	}
	mount := view.Mounts[0]
	if mount.Type != "volume" || mount.Name != spec.VolumeName || mount.Destination != "/workspace" || mount.RW == spec.ReadOnly {
		return ErrSpecificationConflict
	}
	if _, err := r.InspectVolume(ctx, spec.VolumeName, spec.WorkID, "work-workspace"); err != nil {
		return err
	}
	return nil
}
func (stream *FileHelperStream) SetReadDeadline(deadline time.Time) error {
	stream.readDeadline = deadline
	return nil
}
func (stream *FileHelperStream) Read(buffer []byte) (int, error) {
	if stream.ctx.Err() != nil {
		return 0, fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
	}
	deadline := time.Now().Add(fileprotocol.IdleTimeout)
	if !stream.readDeadline.IsZero() && stream.readDeadline.Before(deadline) {
		deadline = stream.readDeadline
	}
	if remaining := time.Until(deadline); remaining <= 0 {
		return 0, fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
	}
	timer := time.AfterFunc(time.Until(deadline), func() { stream.reader.CloseWithError(fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")); stream.cancel() })
	defer timer.Stop()
	n, err := stream.reader.Read(buffer)
	if stream.ctx.Err() != nil && err != nil {
		return n, fileprotocol.Failure("FILE_TRANSFER_TIMEOUT")
	}
	return n, err
}
func (stream *FileHelperStream) Write(buffer []byte) (int, error) {
	return stream.attached.Write(buffer)
}
func (stream *FileHelperStream) CloseWrite() error { return stream.attached.CloseWrite() }
func (stream *FileHelperStream) Close() error {
	stream.closeOnce.Do(func() { stream.cancel(); stream.reader.Close(); stream.attached.Close() })
	return nil
}

// A terminal frame is insufficient: inspect confirms process exit and the
// caller subsequently removes the exact registered attempt before release.
func (r *Runtime) WaitFileHelperExit(ctx context.Context, spec FileHelperSpec) (int, error) {
	for {
		view, err := r.InspectContainer(ctx, FileHelperIdentity(spec))
		if err != nil {
			return 0, err
		}
		if view == nil || view.State == nil {
			return 0, ErrStateUnknown
		}
		if err := r.validateFileHelper(ctx, spec, view); err != nil {
			return 0, err
		}
		if !view.State.Running && view.State.Status != "created" {
			return view.State.ExitCode, nil
		}
		select {
		case <-ctx.Done():
			return 0, errors.Join(ErrStateUnknown, ctx.Err())
		case <-time.After(25 * time.Millisecond):
		}
	}
}
