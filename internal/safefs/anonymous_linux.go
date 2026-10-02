//go:build linux

package safefs

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"strings"

	"golang.org/x/sys/unix"
)

// AnonymousFile creates a private, already-unlinked regular file under this
// fd-pinned root. The kernel reclaims its contents even on SIGKILL. A fallback
// creates and unlinks an exclusive zero-byte placeholder before returning the
// descriptor; no archive bytes are written while a pathname exists.
func (r *Root) AnonymousFile(prefix string) (*os.File, error) {
	return r.anonymousFile(prefix, true)
}
func (r *Root) anonymousFile(prefix string, preferTmp bool) (*os.File, error) {
	if !r.writable() || !leaf(prefix) || len(prefix) > 160 || r.CheckPrivate() != nil {
		return nil, ErrUnsafePath
	}
	if preferTmp {
		fd, err := unix.Openat(r.fd, ".", unix.O_TMPFILE|unix.O_RDWR|unix.O_CLOEXEC, 0600)
		if err == nil {
			var info unix.Stat_t
			if unix.Fstat(fd, &info) != nil || info.Mode&unix.S_IFMT != unix.S_IFREG || info.Uid != uint32(os.Geteuid()) || info.Mode&0077 != 0 || info.Nlink != 0 {
				unix.Close(fd)
				return nil, ErrUnsafePath
			}
			return os.NewFile(uintptr(fd), prefix), nil
		}
		if !errors.Is(err, unix.EOPNOTSUPP) && !errors.Is(err, unix.EINVAL) && !errors.Is(err, unix.EISDIR) && !errors.Is(err, unix.ENOSYS) {
			return nil, err
		}
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, err
	}
	name := prefix + "-" + hex.EncodeToString(nonce[:]) + ".empty"
	f, err := r.OpenFile(name, unix.O_CREAT|unix.O_EXCL|unix.O_RDWR)
	if err != nil {
		return nil, err
	}
	if err := r.Remove(name); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

// RecoverAnonymousPlaceholders is called under the installation's exclusive
// owner lock before inspection starts. It removes only that installation's
// empty, private, singly-linked placeholders from a crash in the tiny
// create/unlink fallback window. Unexpected files are retained and rejected.
func (r *Root) RecoverAnonymousPlaceholders(prefix string) error {
	if !r.writable() || !leaf(prefix) || len(prefix) > 160 || r.CheckPrivate() != nil {
		return ErrUnsafePath
	}
	names, err := r.Entries()
	if err != nil {
		return err
	}
	for _, name := range names {
		if !strings.HasPrefix(name, prefix+"-") {
			continue
		}
		suffix := strings.TrimPrefix(name, prefix+"-")
		if len(suffix) != 38 || !strings.HasSuffix(suffix, ".empty") {
			return ErrUnsafePath
		}
		if _, err := hex.DecodeString(suffix[:32]); err != nil {
			return ErrUnsafePath
		}
		f, err := r.OpenFile(name, unix.O_RDONLY|unix.O_NONBLOCK)
		if err != nil {
			return ErrUnsafePath
		}
		info, err := f.Stat()
		f.Close()
		if err != nil || info.Size() != 0 {
			return ErrUnsafePath
		}
		if err := r.Remove(name); err != nil {
			return err
		}
	}
	return nil
}
