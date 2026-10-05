package clientfs

import (
	"encoding/binary"
	"errors"
	"math"
	"os"

	"golang.org/x/sys/unix"
)

func Identity(f *os.File) (FileIdentity, error) {
	var result FileIdentity
	var st unix.Stat_t
	if f == nil || unix.Fstat(int(f.Fd()), &st) != nil || st.Mode&unix.S_IFMT != unix.S_IFREG {
		return result, ErrUnsafe
	}
	result.Volume = uint64(st.Dev)
	binary.LittleEndian.PutUint64(result.FileID[:], uint64(st.Ino))
	result.Size, result.Mode, result.Links = st.Size, st.Mode, uint32(st.Nlink)
	result.Modified = st.Mtim.Sec*1_000_000_000 + st.Mtim.Nsec
	result.Changed = st.Ctim.Sec*1_000_000_000 + st.Ctim.Nsec
	return result, nil
}

func (d *Directory) FreeBytes() (uint64, error) {
	if err := d.Check(); err != nil {
		return 0, err
	}
	var st unix.Statfs_t
	if err := unix.Fstatfs(d.fd, &st); err != nil {
		return 0, err
	}
	if st.Bsize <= 0 {
		return 0, ErrUnsafe
	}
	return availableBytes(st.Bavail, 1, uint64(st.Bsize))
}

// An unknown process is conservatively alive. Only false with a nil error
// authorizes a caller to treat a process-owned directory as stale.
func ProcessAlive(pid int) (bool, error) {
	if pid <= 0 || int64(pid) > math.MaxInt32 {
		return true, ErrUnsafe
	}
	err := unix.Kill(pid, 0)
	if errors.Is(err, unix.ESRCH) {
		return false, nil
	}
	return true, err
}
