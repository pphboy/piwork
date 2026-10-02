package pipackage

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"golang.org/x/sys/unix"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// ExtractNPMArchive performs native streaming TAR/GZIP extraction. Nothing
// from the archive is executed, and links are created after regular files.
func ExtractNPMArchive(ctx context.Context, filename, output string) (Manifest, error) {
	if ctx.Err() != nil {
		return Manifest{}, ctx.Err()
	}
	file, err := os.OpenFile(filename, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_NONBLOCK, 0)
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return Manifest{}, ErrUnsafe
	}
	if info.Size() > CompressedBytes {
		return Manifest{}, ErrLimit
	}
	gz, err := gzip.NewReader(contextReader{ctx, file})
	if err != nil {
		if ctx.Err() != nil {
			return Manifest{}, ctx.Err()
		}
		return Manifest{}, ErrUnsafe
	}
	defer gz.Close()
	// Includes TAR/PAX header overhead; this bound also stops padding bombs.
	input := &io.LimitedReader{R: contextReader{ctx, gz}, N: RestoredBytes + int64(MaxEntries)*(MaxPathBytes+4096) + 1}
	reader := tar.NewReader(input)
	parent, err := os.OpenRoot(filepath.Dir(output))
	if err != nil {
		return Manifest{}, ErrUnsafe
	}
	defer parent.Close()
	name := filepath.Base(output)
	if name == "." || name == ".." || name == "/" {
		return Manifest{}, ErrUnsafe
	}
	if _, err = parent.Lstat(name); !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, ErrUnsafe
	}
	stage, err := randomName(".package-tar-")
	if err != nil {
		return Manifest{}, err
	}
	if parent.Mkdir(stage, 0700) != nil {
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
	seen := map[string]byte{}
	type link struct {
		name, target string
		hard         bool
	}
	var links []link
	var restored int64
	buffer := make([]byte, 32<<10)
	for {
		header, err := reader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			if ctx.Err() != nil {
				return Manifest{}, ctx.Err()
			}
			return Manifest{}, ErrUnsafe
		}
		original := strings.TrimSuffix(header.Name, "/")
		if original == "package" && header.Typeflag == tar.TypeDir {
			continue
		}
		if !strings.HasPrefix(original, "package/") {
			return Manifest{}, ErrUnsafe
		}
		member := strings.TrimPrefix(original, "package/")
		if err := safePath(member); err != nil {
			return Manifest{}, err
		}
		if len(member) >= 2 && member[1] == ':' {
			return Manifest{}, ErrUnsafe
		}
		if _, ok := seen[member]; ok {
			return Manifest{}, ErrUnsafe
		}
		if len(seen) >= MaxEntries {
			return Manifest{}, ErrLimit
		}
		seen[member] = header.Typeflag
		if header.Size < 0 {
			return Manifest{}, ErrUnsafe
		}
		if header.Size > FileBytes {
			return Manifest{}, ErrLimit
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA && header.Size != 0 {
			return Manifest{}, ErrUnsafe
		}
		restored += header.Size
		if restored > RestoredBytes {
			return Manifest{}, ErrLimit
		}
		if root.MkdirAll(path.Dir(member), 0755) != nil {
			return Manifest{}, ErrUnsafe
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if root.MkdirAll(member, 0755) != nil {
				return Manifest{}, ErrUnsafe
			}
		case tar.TypeReg, tar.TypeRegA:
			mode := os.FileMode(0644)
			if header.Mode&0111 != 0 {
				mode = 0755
			}
			out, err := root.OpenFile(member, os.O_CREATE|os.O_EXCL|os.O_WRONLY|unix.O_NOFOLLOW, mode)
			if err != nil {
				return Manifest{}, ErrUnsafe
			}
			count, copyErr := io.CopyBuffer(out, contextReader{ctx, reader}, buffer)
			syncErr := out.Sync()
			closeErr := out.Close()
			if copyErr != nil || syncErr != nil || closeErr != nil || count != header.Size {
				if ctx.Err() != nil {
					return Manifest{}, ctx.Err()
				}
				return Manifest{}, ErrUnsafe
			}
		case tar.TypeSymlink:
			if err := safeLink(member, header.Linkname); err != nil {
				return Manifest{}, err
			}
			restored += int64(len(header.Linkname))
			if restored > RestoredBytes {
				return Manifest{}, ErrLimit
			}
			links = append(links, link{member, header.Linkname, false})
		case tar.TypeLink:
			if !strings.HasPrefix(header.Linkname, "package/") {
				return Manifest{}, ErrUnsafe
			}
			target := strings.TrimPrefix(header.Linkname, "package/")
			if err := safePath(target); err != nil {
				return Manifest{}, err
			}
			links = append(links, link{member, target, true})
		default:
			return Manifest{}, ErrUnsafe
		}
	}
	if _, err := io.CopyBuffer(io.Discard, input, buffer); err != nil {
		if ctx.Err() != nil {
			return Manifest{}, ctx.Err()
		}
		return Manifest{}, ErrUnsafe
	}
	if input.N == 0 {
		return Manifest{}, ErrLimit
	}
	// Resolve forward hardlinks without following links or accepting cycles.
	pending := append([]link(nil), links...)
	for pass := 0; pass < MaxDepth; pass++ {
		next := []link{}
		progress := false
		for _, item := range pending {
			if !item.hard {
				continue
			}
			info, err := root.Lstat(item.target)
			if errors.Is(err, os.ErrNotExist) {
				next = append(next, item)
				continue
			}
			if err != nil || !info.Mode().IsRegular() {
				return Manifest{}, ErrUnsafe
			}
			restored += info.Size()
			if restored > RestoredBytes {
				return Manifest{}, ErrLimit
			}
			if root.Link(item.target, item.name) != nil {
				return Manifest{}, ErrUnsafe
			}
			progress = true
		}
		pending = next
		if len(next) == 0 {
			break
		}
		if !progress {
			return Manifest{}, ErrUnsafe
		}
	}
	if len(pending) > 0 {
		return Manifest{}, ErrUnsafe
	}
	for _, item := range links {
		if !item.hard && root.Symlink(item.target, item.name) != nil {
			return Manifest{}, ErrUnsafe
		}
	}
	for _, item := range links {
		if _, err := root.Stat(item.name); err != nil {
			return Manifest{}, ErrUnsafe
		}
	}
	tree, err := OpenTree(ctx, filepath.Join(filepath.Dir(output), stage))
	if err != nil {
		return Manifest{}, err
	}
	manifest := tree.Manifest
	tree.Close()
	if err = syncDirectories(ctx, root, "."); err != nil {
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
	if err = publishDirectory(parent, stage, name); err != nil {
		return Manifest{}, err
	}
	keep = true
	return manifest, nil
}
