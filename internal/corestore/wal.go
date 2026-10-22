package corestore

import (
	"context"
	"errors"
	"io"
	"os"

	"golang.org/x/sys/unix"
	"piwork/internal/safefs"
)

// verifyStoredDatabase must not let SQLite create or rewrite sidecars in a
// directory we may reject. Immutable reads are safe only without a nonempty
// WAL. Otherwise validate a private copy, allowing SQLite to rebuild its SHM.
func verifyStoredDatabase(ctx context.Context, root *safefs.Root, name string, marker Marker, fault func(string) error) (returned error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	wal, err := root.OpenFile(name+"-wal", unix.O_RDONLY)
	if errors.Is(err, os.ErrNotExist) {
		return verifyDatabase(ctx, root, name, marker, true)
	}
	if err != nil {
		return ErrUnsupported
	}
	defer wal.Close()
	walInfo, err := wal.Stat()
	if err != nil {
		return ErrStorage
	}
	if walInfo.Size() == 0 {
		return verifyDatabase(ctx, root, name, marker, true)
	}
	main, err := root.OpenFile(name, unix.O_RDONLY)
	if err != nil {
		return ErrUnsupported
	}
	defer main.Close()
	mainInfo, err := main.Stat()
	if err != nil {
		return ErrStorage
	}
	temporary, err := os.MkdirTemp("", "piwork-core-verify-")
	if err != nil {
		return ErrStorage
	}
	defer func() {
		if err := os.RemoveAll(temporary); err != nil {
			returned = errors.Join(returned, ErrStorage)
		}
	}()
	scratch, err := safefs.OpenExistingRoot(temporary)
	if err != nil {
		return ErrStorage
	}
	defer func() {
		if err := scratch.Close(); err != nil {
			returned = errors.Join(returned, ErrStorage)
		}
	}()
	if fault != nil {
		if err := fault("wal-validation-created"); err != nil {
			return err
		}
	}
	buffer := make([]byte, 64<<10)
	for _, source := range []struct {
		name string
		file *os.File
		info os.FileInfo
	}{{name, main, mainInfo}, {name + "-wal", wal, walInfo}} {
		target, err := scratch.OpenFile(source.name, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL)
		if err != nil {
			return ErrStorage
		}
		n, copyErr := io.CopyBuffer(target, contextReader{ctx, io.LimitReader(source.file, source.info.Size()+1)}, buffer)
		closeErr := target.Close()
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if copyErr != nil || closeErr != nil || n != source.info.Size() {
			return ErrStorage
		}
		if fault != nil {
			if err := fault("wal-validation-copy"); err != nil {
				return err
			}
		}
	}
	if err := verifyDatabase(ctx, scratch, name, marker, false); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}
	// Another conforming Core cannot write while we hold the installation lock.
	// Reject a source that was nevertheless replaced or changed during copying.
	for _, source := range []struct {
		name string
		info os.FileInfo
	}{{name, mainInfo}, {name + "-wal", walInfo}} {
		current, err := root.OpenFile(source.name, unix.O_RDONLY)
		if err != nil {
			return ErrStorage
		}
		info, statErr := current.Stat()
		closeErr := current.Close()
		if statErr != nil || closeErr != nil || !os.SameFile(source.info, info) || source.info.Size() != info.Size() || !source.info.ModTime().Equal(info.ModTime()) {
			return ErrStorage
		}
	}
	return ctx.Err()
}

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
