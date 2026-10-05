package pipackage

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"unicode/utf8"

	"piwork/internal/clientfs"
	"piwork/internal/contracts"
)

type Tree struct {
	Root           *os.Root
	Entries        []contracts.DigestEntry
	RestoredBytes  int64
	Manifest       Manifest
	ManifestBytes  []byte
	identities     map[string]os.FileInfo
	fileIdentities map[string]clientfs.FileIdentity
}

func (tree *Tree) Close() error { return tree.Root.Close() }

func safePath(name string) error {
	if name == "" || !utf8.ValidString(name) || strings.ContainsAny(name, "\\\x00") || strings.HasPrefix(name, "/") || path.Clean(name) != name {
		return ErrUnsafe
	}
	if len(name) > MaxPathBytes || len(strings.Split(name, "/")) > MaxDepth {
		return ErrLimit
	}
	for _, part := range strings.Split(name, "/") {
		if part == "." || part == ".." || part == "" {
			return ErrUnsafe
		}
	}
	return nil
}
func safeLink(name, target string) error {
	if target == "" || !utf8.ValidString(target) || strings.ContainsAny(target, "\\\x00") || strings.HasPrefix(target, "/") || len(target) >= 2 && target[1] == ':' {
		return ErrUnsafe
	}
	if len(target) > MaxPathBytes {
		return ErrLimit
	}
	resolved := path.Join(path.Dir(name), target)
	if resolved == ".." || strings.HasPrefix(resolved, "../") {
		return ErrUnsafe
	}
	return nil
}

func OpenTree(ctx context.Context, directory string) (*Tree, error) {
	root, err := openTreeRoot(directory)
	if err != nil {
		return nil, ErrSource
	}
	return scanTree(ctx, root)
}

// Fixed helper roots must stay inside their mounted volume, including the
// selected root itself. A preparation script cannot redirect capture to an
// unrelated image path by replacing result with a symlink.
func OpenTreeAt(ctx context.Context, parent *os.Root, name string) (*Tree, error) {
	info, err := parent.Lstat(name)
	if err != nil || !info.IsDir() {
		return nil, ErrUnsafe
	}
	root, err := parent.OpenRoot(name)
	if err != nil {
		return nil, ErrUnsafe
	}
	return scanTree(ctx, root)
}
func scanTree(ctx context.Context, root *os.Root) (*Tree, error) {
	tree := &Tree{Root: root, Entries: []contracts.DigestEntry{}, identities: make(map[string]os.FileInfo), fileIdentities: make(map[string]clientfs.FileIdentity)}
	keep := false
	defer func() {
		if !keep {
			root.Close()
		}
	}()
	var walk func(string) error
	walk = func(prefix string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		name := prefix
		if name == "" {
			name = "."
		}
		return eachDirectory(ctx, root, name, func(item os.DirEntry) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			name := item.Name()
			if !nativePackageComponent(name) {
				return ErrUnsafe
			}
			if prefix != "" {
				name = prefix + "/" + name
			}
			if err := safePath(name); err != nil {
				return err
			}
			if len(tree.Entries) >= MaxEntries {
				return ErrLimit
			}
			info, err := root.Lstat(name)
			if err != nil {
				return ErrUnsafe
			}
			entry := contracts.DigestEntry{Path: name}
			switch {
			case info.IsDir():
				entry.Type = "directory"
				entry.Mode = 0755
			case info.Mode().IsRegular():
				file, err := openTreeFile(root, name)
				if err != nil {
					return ErrUnsafe
				}
				identity, identityErr := clientfs.Identity(file)
				opened, statErr := file.Stat()
				closeErr := file.Close()
				if identityErr != nil || statErr != nil || closeErr != nil || !os.SameFile(info, opened) || info.Size() != identity.Size || !info.ModTime().Equal(opened.ModTime()) {
					return ErrUnsafe
				}
				tree.fileIdentities[name] = identity
				entry.Type = "file"
				entry.Mode = 0644
				if info.Mode()&0111 != 0 {
					entry.Mode = 0755
				}
				entry.Size = info.Size()
				if entry.Size > FileBytes {
					return ErrLimit
				}
				tree.RestoredBytes += entry.Size
				entry.Open = func() (io.ReadCloser, error) {
					if ctx.Err() != nil {
						return nil, ctx.Err()
					}
					file, err := tree.openFile(name)
					if err != nil {
						return nil, err
					}
					return &contextFile{ctx: ctx, File: file, check: func() error { return tree.checkFile(name, file) }}, nil
				}
			case info.Mode()&os.ModeSymlink != 0:
				entry.Type = "symlink"
				entry.Mode = 0777
				entry.Target, err = readTreeLink(root, name)
				if err != nil {
					return ErrUnsafe
				}
				if err := safeLink(name, entry.Target); err != nil {
					return err
				}
				if _, err := root.Stat(name); err != nil {
					return ErrUnsafe
				}
				entry.Size = int64(len(entry.Target))
				tree.RestoredBytes += entry.Size
			default:
				return ErrUnsafe
			}
			if tree.RestoredBytes > RestoredBytes {
				return ErrLimit
			}
			tree.Entries = append(tree.Entries, entry)
			tree.identities[name] = info
			if info.IsDir() {
				if err := walk(name); err != nil {
					return err
				}
			}
			return nil
		})
	}
	if err := walk(""); err != nil {
		return nil, err
	}
	sort.Slice(tree.Entries, func(i, j int) bool { return tree.Entries[i].Path < tree.Entries[j].Path })
	manifestInfo, ok := tree.identities["package.json"]
	if !ok || !manifestInfo.Mode().IsRegular() || manifestInfo.Size() > ManifestBytes {
		return nil, ErrManifest
	}
	file, err := tree.openFile("package.json")
	if err != nil {
		return nil, err
	}
	raw, err := io.ReadAll(io.LimitReader(file, ManifestBytes+1))
	closeErr := errors.Join(tree.checkFile("package.json", file), file.Close())
	if err != nil || closeErr != nil || int64(len(raw)) > ManifestBytes {
		return nil, ErrManifest
	}
	manifest, err := ParseManifest(raw)
	if err != nil {
		return nil, err
	}
	tree.Manifest, tree.ManifestBytes = manifest, raw
	keep = true
	return tree, nil
}

// os.Root pins containment for every parent component; O_NOFOLLOW prevents a
// raced leaf from becoming a link, and NONBLOCK avoids blocking on a raced FIFO.
func (tree *Tree) openFile(name string) (*os.File, error) {
	file, err := openTreeFile(tree.Root, name)
	if err != nil {
		return nil, ErrUnsafe
	}
	info, err := file.Stat()
	identity, identityErr := clientfs.Identity(file)
	prior, ok := tree.identities[name]
	if err != nil || identityErr != nil || identity != tree.fileIdentities[name] || !info.Mode().IsRegular() || !ok || !os.SameFile(info, prior) || info.Mode() != prior.Mode() || info.Size() != prior.Size() || !info.ModTime().Equal(prior.ModTime()) {
		file.Close()
		return nil, ErrUnsafe
	}
	return file, nil
}

func (tree *Tree) checkFile(name string, file *os.File) error {
	identity, err := clientfs.Identity(file)
	if err != nil || identity != tree.fileIdentities[name] {
		return ErrUnsafe
	}
	current, err := tree.openFile(name)
	if err != nil {
		return ErrUnsafe
	}
	return current.Close()
}

func (tree *Tree) ValidateDependencies() error {
	for name := range tree.Manifest.Dependencies {
		if IsHostModule(name) {
			return ErrManifest
		}
		info, err := tree.Root.Stat("node_modules/" + name)
		if err != nil || !info.IsDir() {
			return ErrManifest
		}
	}
	return nil
}

func (tree *Tree) Digest() (string, error) {
	digest, err := contracts.PiPackageDigest(tree.Entries)
	if err != nil {
		return "", ErrUnsafe
	}
	return digest, nil
}

// Measure counts logical bytes without following symlinks and without reading
// sparse file contents. Exceeding the preparation cap is a measurement result.
func Measure(ctx context.Context, directory string) (int64, error) {
	root, err := openTreeRoot(directory)
	if err != nil {
		return 0, ErrSource
	}
	defer root.Close()
	var total int64
	entries := 0
	var walk func(string) error
	walk = func(name string) error {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return eachDirectory(ctx, root, name, func(item os.DirEntry) error {
			if total > PreparationBytes {
				return errMeasuredLimit
			}
			if ctx.Err() != nil {
				return ctx.Err()
			}
			entries++
			if entries > 1000000 {
				total = PreparationBytes + 1
				return errMeasuredLimit
			}
			child := item.Name()
			if name != "." {
				child = name + "/" + child
			}
			info, err := root.Lstat(child)
			if os.IsNotExist(err) {
				return nil
			}
			if err != nil {
				return ErrUnsafe
			}
			if info.IsDir() {
				if err := walk(child); err != nil {
					return err
				}
			} else {
				if info.Size() > PreparationBytes-total {
					total = PreparationBytes + 1
				} else {
					total += info.Size()
				}
			}
			if total > PreparationBytes {
				return errMeasuredLimit
			}
			return nil
		})
	}
	if err := walk("."); err != nil && err != errMeasuredLimit {
		return 0, err
	}
	return total, nil
}

var errMeasuredLimit = errors.New("measurement limit reached")

type contextFile struct {
	ctx context.Context
	*os.File
	check func() error
}

func (file *contextFile) Close() error {
	return errors.Join(file.check(), file.File.Close())
}

func (file *contextFile) Read(data []byte) (int, error) {
	if file.ctx.Err() != nil {
		return 0, file.ctx.Err()
	}
	return file.File.Read(data)
}

func eachDirectory(ctx context.Context, root *os.Root, name string, visit func(os.DirEntry) error) error {
	dir, err := openTreeDirectory(root, name)
	if err != nil {
		return ErrUnsafe
	}
	defer dir.Close()
	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		items, err := dir.ReadDir(256)
		if err != nil && err != io.EOF {
			return ErrUnsafe
		}
		for _, item := range items {
			if err := visit(item); err != nil {
				return err
			}
		}
		if err == io.EOF {
			return nil
		}
	}
}
