package clientfs

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// PinDirectory duplicates an already opened directory; it never reopens its
// pathname. The caller retains ownership of the input file.
func PinDirectory(f *os.File, private bool) (*Directory, error) {
	if f == nil {
		return nil, ErrUnsafe
	}
	fd, err := unix.FcntlInt(f.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	d := &Directory{fd: fd, private: private}
	if err := d.Check(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func (d *Directory) createPrivateChild(name string) (*Directory, error) {
	if !validName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	if err := unix.Mkdirat(d.fd, name, 0700); err != nil {
		return nil, err
	}
	child, err := d.Child(name, false)
	if err != nil {
		return nil, err
	}
	child.private = true
	if err := errors.Join(child.Check(), d.Sync()); err != nil {
		child.Close()
		return nil, err
	}
	return child, nil
}

func (d *Directory) removeChildDirectory(name string, child *Directory) error {
	if !validName(name) || d.Check() != nil || child.Check() != nil {
		return ErrUnsafe
	}
	var before, current unix.Stat_t
	if unix.Fstat(child.fd, &before) != nil || unix.Fstatat(d.fd, name, &current, unix.AT_SYMLINK_NOFOLLOW) != nil || current.Dev != before.Dev || current.Ino != before.Ino {
		return ErrUnsafe
	}
	if err := unix.Unlinkat(d.fd, name, unix.AT_REMOVEDIR); err != nil {
		return err
	}
	if err := d.Sync(); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

func (d *Directory) SameDirectory(f *os.File) bool {
	if f == nil || d.Check() != nil {
		return false
	}
	var a, b unix.Stat_t
	return unix.Fstat(d.fd, &a) == nil && unix.Fstat(int(f.Fd()), &b) == nil && b.Mode&unix.S_IFMT == unix.S_IFDIR && a.Dev == b.Dev && a.Ino == b.Ino
}

func DuplicateFile(f *os.File) (*os.File, error) {
	if _, err := Identity(f); err != nil {
		return nil, err
	}
	fd, err := unix.FcntlInt(f.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), "client-file"), nil
}

func (d *Directory) CreatePrivateExclusive(name string) (*os.File, error) {
	return d.CreateExclusive(name)
}

func (d *Directory) OpenDirectoryFile() (*os.File, error) {
	if err := d.Check(); err != nil {
		return nil, err
	}
	fd, err := unix.Openat(d.fd, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), "client-directory"), nil
}
