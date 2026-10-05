package clientfs

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

// Directory holds a native directory descriptor; no operation reopens the
// originally supplied pathname after an ancestor has been pinned.
type Directory struct {
	fd      int
	private bool
}

func ValidFileName(name string) bool { return validName(name) }

func openDirectory(input string, private, create bool) (*Directory, error) {
	if input == "" || !utf8.ValidString(input) || strings.ContainsRune(input, 0) {
		return nil, ErrUnsafe
	}
	name, err := filepath.Abs(input)
	if err != nil {
		return nil, err
	}
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	parts := strings.Split(strings.TrimPrefix(name, "/"), "/")
	if name == "/" {
		parts = nil
	}
	for _, part := range parts {
		if !validName(part) {
			unix.Close(fd)
			return nil, ErrUnsafe
		}
		next, openErr := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if create && errors.Is(openErr, unix.ENOENT) {
			if err := unix.Mkdirat(fd, part, 0700); err != nil && !errors.Is(err, unix.EEXIST) {
				unix.Close(fd)
				return nil, err
			}
			if err := unix.Fsync(fd); err != nil {
				unix.Close(fd)
				return nil, err
			}
			next, openErr = unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		}
		unix.Close(fd)
		if openErr != nil {
			return nil, storageError(openErr)
		}
		fd = next
	}
	d := &Directory{fd: fd, private: private}
	if err := d.Check(); err != nil {
		d.Close()
		return nil, err
	}
	return d, nil
}

func storageError(err error) error {
	if errors.Is(err, unix.ELOOP) || errors.Is(err, unix.ENOTDIR) {
		return ErrUnsafe
	}
	return err
}

func (d *Directory) Close() error {
	if d == nil || d.fd < 0 {
		return nil
	}
	fd := d.fd
	d.fd = -1
	return unix.Close(fd)
}

func (d *Directory) Check() error {
	var st unix.Stat_t
	if d == nil || d.fd < 0 || unix.Fstat(d.fd, &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFDIR ||
		d.private && (st.Uid != uint32(os.Geteuid()) || st.Mode&0077 != 0) {
		return ErrUnsafe
	}
	return nil
}

func (d *Directory) Sync() error {
	if err := d.Check(); err != nil {
		return err
	}
	return unix.Fsync(d.fd)
}

func (d *Directory) validFile(st *unix.Stat_t) bool {
	return st.Mode&unix.S_IFMT == unix.S_IFREG && (!d.private ||
		st.Uid == uint32(os.Geteuid()) && st.Mode&07777 == 0600 && st.Nlink == 1)
}

func (d *Directory) checkOpenFile(f *os.File) error {
	var st unix.Stat_t
	if f == nil || unix.Fstat(int(f.Fd()), &st) != nil || !d.validOpenedFile(st) {
		return ErrUnsafe
	}
	return nil
}

func (d *Directory) validOpenedFile(st unix.Stat_t) bool {
	// An atomic replacement can unlink the old name after a reader opened it.
	// That pinned old inode is still private and has no additional hard links.
	if st.Nlink == 0 {
		st.Nlink = 1
	}
	return d.validFile(&st)
}

func (d *Directory) checkTarget(name string) error {
	if !validName(name) || d.Check() != nil {
		return ErrUnsafe
	}
	var st unix.Stat_t
	if err := unix.Fstatat(d.fd, name, &st, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		return storageError(err)
	}
	if !d.validFile(&st) {
		return ErrUnsafe
	}
	return nil
}

func (d *Directory) OpenRegular(name string) (*os.File, error) {
	return d.openFile(name, unix.O_RDONLY, false)
}

func (d *Directory) CreateExclusive(name string) (*os.File, error) {
	return d.openFile(name, unix.O_RDWR|unix.O_CREAT|unix.O_EXCL, true)
}

func (d *Directory) openFile(name string, flags int, newlyCreated bool) (*os.File, error) {
	if !validName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	fd, err := unix.Openat(d.fd, name, flags|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0600)
	if err != nil {
		return nil, storageError(err)
	}
	f := os.NewFile(uintptr(fd), name)
	if newlyCreated {
		// Only the exclusively created descriptor is chmodded, never a path.
		if err := f.Chmod(0600); err != nil {
			f.Close()
			return nil, err
		}
	}
	var st unix.Stat_t
	if unix.Fstat(fd, &st) != nil || !d.validOpenedFile(st) || d.Check() != nil {
		f.Close()
		return nil, ErrUnsafe
	}
	return f, nil
}

func (d *Directory) TryLock(name string) (*Lock, error) {
	if !d.private {
		return nil, ErrUnsafe
	}
	f, err := d.CreateExclusive(name)
	if errors.Is(err, os.ErrExist) {
		f, err = d.openFile(name, unix.O_RDWR, false)
	}
	if err != nil {
		return nil, err
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, unix.EWOULDBLOCK) || errors.Is(err, unix.EAGAIN) {
			return nil, ErrBusy
		}
		return nil, err
	}
	if err := d.Check(); err != nil {
		f.Close()
		return nil, err
	}
	return &Lock{file: f}, nil
}

func (d *Directory) rename(old, name string, replace bool) error {
	if !validName(old) || !validName(name) || d.Check() != nil {
		return ErrUnsafe
	}
	if replace {
		return unix.Renameat(d.fd, old, d.fd, name)
	}
	return unix.Renameat2(d.fd, old, d.fd, name, unix.RENAME_NOREPLACE)
}

func (d *Directory) removeTemporary(name string) {
	if validName(name) && d.Check() == nil {
		_ = unix.Unlinkat(d.fd, name, 0)
	}
}

func (d *Directory) Remove(name string) error {
	if err := d.checkTarget(name); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if err := unix.Unlinkat(d.fd, name, 0); err != nil {
		return err
	}
	if err := d.Sync(); err != nil {
		return errors.Join(ErrOutcomeUnknown, err)
	}
	return nil
}

// Child pins one native child without revisiting the original absolute path.
func (d *Directory) Child(name string, create bool) (*Directory, error) {
	if !validName(name) || d.Check() != nil {
		return nil, ErrUnsafe
	}
	if create {
		if err := unix.Mkdirat(d.fd, name, 0700); err != nil && !errors.Is(err, unix.EEXIST) {
			return nil, err
		}
		if err := d.Sync(); err != nil {
			return nil, err
		}
	}
	fd, err := unix.Openat(d.fd, name, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, storageError(err)
	}
	child := &Directory{fd: fd, private: d.private}
	if err := child.Check(); err != nil {
		child.Close()
		return nil, err
	}
	return child, nil
}

func (d *Directory) Entries() ([]os.DirEntry, error) {
	if err := d.Check(); err != nil {
		return nil, err
	}
	fd, err := unix.Openat(d.fd, ".", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	f := os.NewFile(uintptr(fd), "client directory")
	defer f.Close()
	return f.ReadDir(-1)
}
