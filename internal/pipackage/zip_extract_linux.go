package pipackage

import (
	"context"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path"
	"path/filepath"
)

func syncDirectories(ctx context.Context, root *os.Root, name string) error {
	if err := eachDirectory(ctx, root, name, func(item os.DirEntry) error {
		child := path.Join(name, item.Name())
		info, err := root.Lstat(child)
		if err != nil {
			return ErrUnsafe
		}
		if info.IsDir() {
			return syncDirectories(ctx, root, child)
		}
		return nil
	}); err != nil {
		return err
	}
	dir, err := root.OpenFile(name, os.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return ErrUnsafe
	}
	defer dir.Close()
	return dir.Sync()
}
func publishDirectory(root *os.Root, old, new string) error {
	dir, err := root.Open(".")
	if err != nil {
		return err
	}
	defer dir.Close()
	if err := unix.Renameat2(int(dir.Fd()), old, int(dir.Fd()), new, unix.RENAME_NOREPLACE); err != nil {
		return ErrUnsafe
	}
	return dir.Sync()
}

func ExtractArchive(ctx context.Context, filename, output string) (Manifest, error) {
	archive, err := OpenArchive(ctx, filename)
	if err != nil {
		return Manifest{}, err
	}
	defer archive.Close()
	parent, err := os.OpenRoot(filepath.Dir(output))
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	defer parent.Close()
	name := filepath.Base(output)
	return extractArchiveAt(ctx, archive, parent, name)
}

// ExtractArchiveAt keeps both input and output pinned throughout validation,
// extraction and publication. Neither a helper nor a path replacement can
// switch the archive or destination after its checksum has been verified.
func ExtractArchiveAt(ctx context.Context, source *os.File, parent *os.Root, name string) (Manifest, error) {
	archive, err := OpenArchiveFile(ctx, source)
	if err != nil {
		return Manifest{}, err
	}
	defer archive.Close()
	return extractArchiveAt(ctx, archive, parent, name)
}

func extractArchiveAt(ctx context.Context, archive *Archive, parent *os.Root, name string) (Manifest, error) {
	if parent == nil || filepath.Base(name) != name {
		return Manifest{}, ErrUnsafe
	}
	if name == "." || name == ".." || name == string(filepath.Separator) {
		return Manifest{}, ErrUnsafe
	}
	if _, err := parent.Lstat(name); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, ErrUnsafe
	}
	stage, err := randomName(".package-stage-")
	if err != nil {
		return Manifest{}, err
	}
	if err := parent.Mkdir(stage, 0700); err != nil {
		return Manifest{}, ErrUnsafe
	}
	keep := false
	defer func() {
		if !keep {
			parent.RemoveAll(stage)
		}
	}()
	root, err := parent.OpenRoot(stage)
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	defer root.Close()
	var links []ZipEntry
	buffer := make([]byte, 32<<10)
	for _, item := range archive.Entries {
		if ctx.Err() != nil {
			return Manifest{}, ctx.Err()
		}
		if item.Type == "directory" {
			if root.MkdirAll(item.Path, 0755) != nil {
				return Manifest{}, ErrUnsafe
			}
			continue
		}
		if root.MkdirAll(path.Dir(item.Path), 0755) != nil {
			return Manifest{}, ErrUnsafe
		}
		stream, err := item.file.Open()
		if err != nil {
			return Manifest{}, ErrUnsafe
		}
		if item.Type == "symlink" {
			raw, err := io.ReadAll(io.LimitReader(contextReader{ctx, stream}, MaxPathBytes+1))
			closeErr := stream.Close()
			if err != nil || closeErr != nil || int64(len(raw)) != item.Size {
				return Manifest{}, ErrUnsafe
			}
			if err := safeLink(item.Path, string(raw)); err != nil {
				return Manifest{}, err
			}
			item.Original = string(raw)
			links = append(links, item)
			continue
		}
		mode := os.FileMode(0644)
		if item.Mode&0111 != 0 {
			mode = 0755
		}
		file, err := root.OpenFile(item.Path, os.O_WRONLY|os.O_CREATE|os.O_EXCL|unix.O_NOFOLLOW, mode)
		if err != nil {
			stream.Close()
			return Manifest{}, ErrUnsafe
		}
		count, copyErr := io.CopyBuffer(file, io.LimitReader(contextReader{ctx, stream}, item.Size+1), buffer)
		streamErr := stream.Close()
		syncErr := file.Sync()
		closeErr := file.Close()
		if copyErr != nil || streamErr != nil || syncErr != nil || closeErr != nil || count != item.Size {
			if ctx.Err() != nil {
				return Manifest{}, ctx.Err()
			}
			return Manifest{}, ErrUnsafe
		}
	}
	for _, item := range links {
		if root.Symlink(item.Original, item.Path) != nil {
			return Manifest{}, ErrUnsafe
		}
	}
	for _, item := range links {
		if _, err := root.Stat(item.Path); err != nil {
			return Manifest{}, ErrUnsafe
		}
	}
	file, err := root.OpenFile("package.json", os.O_RDONLY|unix.O_NOFOLLOW, 0)
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	raw, err := io.ReadAll(io.LimitReader(file, ManifestBytes+1))
	file.Close()
	if err != nil {
		return Manifest{}, ErrManifest
	}
	manifest, err := ParseManifest(raw)
	if err != nil {
		return Manifest{}, err
	}
	if syncDirectories(ctx, root, ".") != nil {
		return Manifest{}, ErrUnsafe
	}
	dir, err := root.Open(".")
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	err = dir.Chmod(0755)
	syncErr := dir.Sync()
	dir.Close()
	if err != nil || syncErr != nil {
		return Manifest{}, ErrUnsafe
	}
	root.Close()
	if err := publishDirectory(parent, stage, name); err != nil {
		return Manifest{}, err
	}
	keep = true
	return manifest, nil
}

// PackArchiveToSpool publishes helper output for the owner of its pinned spool.
func PackArchiveToSpool(ctx context.Context, tree *Tree, output string) (PackedArchive, error) {
	return packArchive(ctx, tree, output, 0644, true)
}
