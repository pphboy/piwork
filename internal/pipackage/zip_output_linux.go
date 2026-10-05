package pipackage

import (
	"golang.org/x/sys/unix"
	"os"
	"path/filepath"
)

func syncRoot(root *os.Root) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

func openArchiveOutput(output string, mode os.FileMode, inheritOwner bool) (*archiveOutput, error) {
	parent, err := os.OpenRoot(filepath.Dir(output))
	if err != nil {
		return nil, ErrUnsafe
	}
	keep := false
	defer func() {
		if !keep {
			parent.Close()
		}
	}()
	temp, err := randomName(".package-zip-")
	if err != nil {
		return nil, err
	}
	file, err := parent.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, ErrUnsafe
	}
	defer func() {
		if !keep {
			file.Close()
			parent.Remove(temp)
		}
	}()
	// The trusted capture helper can run as root against a host-owned spool.
	// Set ownership while the ZIP is still empty, before any lengthy writes or
	// publication, so interrupted captures remain collectable by that owner.
	if err := file.Chmod(mode); err != nil {
		return nil, ErrUnsafe
	}
	if inheritOwner && os.Geteuid() == 0 {
		directory, err := parent.Open(".")
		if err != nil {
			return nil, ErrUnsafe
		}
		var owner unix.Stat_t
		statErr := unix.Fstat(int(directory.Fd()), &owner)
		directory.Close()
		if statErr != nil || file.Chown(int(owner.Uid), int(owner.Gid)) != nil {
			return nil, ErrUnsafe
		}
	}
	keep = true
	return &archiveOutput{file: file, commit: func() error {
		if err := parent.Rename(temp, filepath.Base(output)); err != nil {
			return err
		}
		return syncRoot(parent)
	}, close: func() { file.Close(); parent.Remove(temp); parent.Close() }}, nil
}
