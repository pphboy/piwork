//go:build linux

package safefs

import (
	"errors"

	"golang.org/x/sys/unix"
)

// PublishTo atomically moves an already-fsynced private regular file between
// two locked fd-pinned roots on the same filesystem. It never follows a source
// or target link. Both source removal and destination publication are synced.
func (r *Root) PublishTo(source string, destination *Root, target string, overwrite bool) error {
	if destination == nil || !r.writable() || !destination.writable() || !leaf(source) || !leaf(target) || r.CheckPrivate() != nil || destination.CheckPrivate() != nil {
		return ErrUnsafePath
	}
	if err := r.CheckEntry(source, false); err != nil {
		return ErrUnsafePath
	}
	var existing unix.Stat_t
	err := unix.Fstatat(destination.fd, target, &existing, unix.AT_SYMLINK_NOFOLLOW)
	if err == nil {
		if destination.CheckEntry(target, false) != nil {
			return ErrUnsafePath
		}
	} else if !errors.Is(err, unix.ENOENT) {
		return ErrUnsafePath
	}
	flags := uint(0)
	if !overwrite {
		flags = unix.RENAME_NOREPLACE
	}
	if err := unix.Renameat2(r.fd, source, destination.fd, target, flags); err != nil {
		return err
	}
	if err := destination.Sync(); err != nil {
		return err
	}
	return r.Sync()
}
