// Package clientfs provides pinned, no-follow file access for native clients.
// Private state and ordinary user inputs have distinct permission policies.
package clientfs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"strings"
	"time"
	"unicode/utf8"
)

var (
	ErrUnsafe = errors.New("unsafe client storage or file")
	ErrBusy   = errors.New("client storage is busy")
	// ErrOutcomeUnknown means publication succeeded but its final durable
	// confirmation failed. Callers must read back instead of retrying a write.
	ErrOutcomeUnknown = errors.New("client storage commit could not be confirmed")
)

func validName(name string) bool {
	return name != "" && name != "." && name != ".." && len(name) <= 255 && utf8.ValidString(name) && !strings.ContainsAny(name, "/\\\x00")
}

// OpenDirectory pins an existing ordinary directory without following links.
func OpenDirectory(path string) (*Directory, error) { return openDirectory(path, false, false) }

// OpenPrivateDirectory accepts only an owned, private directory. Missing
// components are created privately only when create is true.
func OpenPrivateDirectory(path string, create bool) (*Directory, error) {
	return openDirectory(path, true, create)
}

// ReadFile returns bounded, stable regular-file bytes from a pinned parent.
// The private policy also rejects broad permissions and multiple hard links.
func (d *Directory) ReadFile(name string, limit int64) ([]byte, error) {
	if limit < 0 {
		return nil, ErrUnsafe
	}
	f, err := d.OpenRegular(name)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || before.Size() > limit {
		return nil, ErrUnsafe
	}
	raw, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil {
		return nil, err
	}
	after, err := f.Stat()
	if err != nil || int64(len(raw)) > limit || !sameFileState(before, after) || d.checkOpenFile(f) != nil || d.Check() != nil {
		return nil, ErrUnsafe
	}
	return raw, nil
}

func sameFileState(a, b os.FileInfo) bool {
	return a != nil && b != nil && os.SameFile(a, b) && a.Mode() == b.Mode() && a.Size() == b.Size() && a.ModTime().Equal(b.ModTime())
}

func (d *Directory) CreateTemp(prefix string) (*os.File, string, error) {
	return d.createTemp(prefix, rand.Read)
}

func (d *Directory) createTemp(prefix string, random func([]byte) (int, error)) (*os.File, string, error) {
	if !validName(prefix) || len(prefix) > 180 {
		return nil, "", ErrUnsafe
	}
	var nonce [16]byte
	if n, err := random(nonce[:]); err != nil {
		return nil, "", err
	} else if n != len(nonce) {
		return nil, "", io.ErrUnexpectedEOF
	}
	name := prefix + hex.EncodeToString(nonce[:]) + ".tmp"
	f, err := d.CreateExclusive(name)
	return f, name, err
}

// AtomicWrite requires a private directory. Cooperating writers must hold
// their application's existing lock across validation and this operation.
func (d *Directory) AtomicWrite(ctx context.Context, name string, data []byte) error {
	return d.atomicWrite(ctx, name, data, writeHooks{})
}

// AtomicWriteChecked rechecks a caller's authorization immediately before
// committing, after all temporary-file preparation has completed.
func (d *Directory) AtomicWriteChecked(ctx context.Context, name string, data []byte, check func() error) error {
	return d.atomicWrite(ctx, name, data, writeHooks{beforeCommit: check})
}

// Fault injection stays package-private and is used to exercise commit edges.
type writeHooks struct {
	random        func([]byte) (int, error)
	write         func(*os.File, []byte) (int, error)
	syncFile      func(*os.File) error
	beforeCommit  func() error
	syncDirectory func() error
}

func (d *Directory) atomicWrite(ctx context.Context, name string, data []byte, hooks writeHooks) error {
	if !d.private || !validName(name) {
		return ErrUnsafe
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := d.checkTarget(name); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	random := hooks.random
	if random == nil {
		random = rand.Read
	}
	f, temporary, err := d.createTemp(".client-", random)
	if err != nil {
		return err
	}
	defer d.removeTemporary(temporary)
	write := hooks.write
	if write == nil {
		write = func(f *os.File, b []byte) (int, error) { return f.Write(b) }
	}
	n, writeErr := write(f, data)
	if writeErr == nil && n != len(data) {
		writeErr = io.ErrShortWrite
	}
	syncFile := hooks.syncFile
	if syncFile == nil {
		syncFile = func(f *os.File) error { return f.Sync() }
	}
	if writeErr == nil {
		writeErr = syncFile(f)
	}
	closeErr := f.Close()
	if err := errors.Join(writeErr, closeErr); err != nil {
		return err
	}
	if hooks.beforeCommit != nil {
		if err := hooks.beforeCommit(); err != nil {
			return err
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := d.checkTarget(name); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := d.rename(temporary, name, true); err != nil {
		return err
	}
	syncDirectory := hooks.syncDirectory
	if syncDirectory == nil {
		syncDirectory = d.Sync
	}
	if err := syncDirectory(); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

// PublishNoReplace publishes a completed sibling. The final native operation
// refuses an existing target, including one created after a caller's check.
func (d *Directory) PublishNoReplace(ctx context.Context, temporary, name string) error {
	return d.publish(ctx, temporary, name, false)
}

// PublishReplace replaces a safe ordinary target from a completed sibling.
// Private state writers must retain their application lock across publication.
func (d *Directory) PublishReplace(ctx context.Context, temporary, name string) error {
	return d.publish(ctx, temporary, name, true)
}

func (d *Directory) publish(ctx context.Context, temporary, name string, replace bool) error {
	if temporary == name || !validName(temporary) || !validName(name) {
		return ErrUnsafe
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := d.checkTarget(temporary); err != nil {
		return err
	}
	if replace {
		if err := d.checkTarget(name); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := d.rename(temporary, name, replace); err != nil {
		return err
	}
	if err := d.Sync(); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

// Lock releases its native file lock when closed or when the process exits.
type Lock struct{ file *os.File }

// Lock waits for the application's existing file lock. TryLock is used for
// operations whose contract requires immediate conflict feedback.
func (d *Directory) Lock(ctx context.Context, name string) (*Lock, error) {
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		lock, err := d.TryLock(name)
		if !errors.Is(err, ErrBusy) {
			return lock, err
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func (l *Lock) Close() error {
	if l == nil || l.file == nil {
		return nil
	}
	f := l.file
	l.file = nil
	return f.Close()
}
