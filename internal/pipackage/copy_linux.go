package pipackage

import (
	"context"
	"errors"
	"io"
	"os"
	"path"

	"golang.org/x/sys/unix"
)

// CopyTreeAt makes an independent copy of a previously inspected tree. It
// never links immutable Core catalog bytes into a Work's own context. Links
// are created only after directories and regular files have been copied.
func CopyTreeAt(ctx context.Context, tree *Tree, parent *os.Root, name string, readOnly bool) (returned error) {
	if tree == nil || safePath(name) != nil || path.Base(name) != name {
		return ErrUnsafe
	}
	if err := parent.Mkdir(name, 0700); err != nil {
		return err
	}
	defer func() {
		if returned != nil {
			_ = parent.RemoveAll(name)
		}
	}()
	destination, err := parent.OpenRoot(name)
	if err != nil {
		return err
	}
	defer destination.Close()
	for _, entry := range tree.Entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		switch entry.Type {
		case "directory":
			if err := destination.Mkdir(entry.Path, 0755); err != nil {
				return err
			}
		case "file":
			input, err := entry.Open()
			if err != nil {
				return err
			}
			mode := os.FileMode(entry.Mode)
			if readOnly {
				mode &= 0555
			}
			output, err := destination.OpenFile(entry.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, mode)
			if err != nil {
				input.Close()
				return err
			}
			n, copyErr := io.CopyBuffer(output, io.LimitReader(input, entry.Size+1), make([]byte, 32<<10))
			syncErr := output.Sync()
			closeErr := errors.Join(output.Close(), input.Close())
			if err := errors.Join(copyErr, syncErr, closeErr); err != nil {
				return err
			}
			if n != entry.Size {
				return ErrUnsafe
			}
		}
	}
	for _, entry := range tree.Entries {
		if entry.Type == "symlink" {
			if err := destination.Symlink(entry.Target, entry.Path); err != nil {
				return err
			}
		}
	}
	// Compare actual copied bytes and executable/link identities, including
	// changes to a source file between inspection and the streaming copy.
	copied, err := OpenTreeAt(ctx, parent, name)
	if err != nil {
		return err
	}
	defer copied.Close()
	before, err := tree.Digest()
	if err != nil {
		return err
	}
	after, err := copied.Digest()
	if err != nil || before != after {
		return ErrUnsafe
	}
	for i := len(tree.Entries) - 1; i >= -1; i-- {
		directory := "."
		if i >= 0 {
			if tree.Entries[i].Type != "directory" {
				continue
			}
			directory = tree.Entries[i].Path
		}
		if err := destination.Chmod(directory, 0755); err != nil {
			return err
		}
		f, err := destination.OpenFile(directory, os.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
		if err != nil {
			return err
		}
		if err := errors.Join(f.Sync(), f.Close()); err != nil {
			return err
		}
	}
	return nil
}
