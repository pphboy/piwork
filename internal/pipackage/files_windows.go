package pipackage

import (
	"os"
	"path/filepath"
	"strings"

	"piwork/internal/clientfs"
)

func nativePackageComponent(name string) bool { return clientfs.ValidFileName(name) }

func openArchiveInput(filename string) (*os.File, error) {
	parent, err := clientfs.OpenDirectory(filepath.Dir(filename))
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	return parent.OpenRegular(filepath.Base(filename))
}

func openTreeRoot(name string) (*os.Root, error) {
	pinned, err := clientfs.OpenDirectory(name)
	if err != nil {
		return nil, err
	}
	defer pinned.Close()
	root, err := os.OpenRoot(name)
	if err != nil {
		return nil, err
	}
	f, err := root.Open(".")
	if err != nil {
		root.Close()
		return nil, err
	}
	same := pinned.SameDirectory(f)
	f.Close()
	if !same {
		root.Close()
		return nil, ErrUnsafe
	}
	return root, nil
}

func treeDirectory(root *os.Root, name string) (*clientfs.Directory, error) {
	f, err := root.Open(".")
	if err != nil {
		return nil, err
	}
	d, err := clientfs.PinDirectory(f, false)
	f.Close()
	if err != nil {
		return nil, err
	}
	if name == "." || name == "" {
		return d, nil
	}
	for _, part := range strings.Split(name, "/") {
		next, err := d.Child(part, false)
		d.Close()
		if err != nil {
			return nil, err
		}
		d = next
	}
	return d, nil
}

func openTreeFile(root *os.Root, name string) (*os.File, error) {
	parts := strings.Split(name, "/")
	d, err := treeDirectory(root, strings.Join(parts[:len(parts)-1], "/"))
	if err != nil {
		return nil, err
	}
	defer d.Close()
	return d.OpenRegular(parts[len(parts)-1])
}

func openTreeDirectory(root *os.Root, name string) (*os.File, error) {
	d, err := treeDirectory(root, name)
	if err != nil {
		return nil, err
	}
	defer d.Close()
	return d.OpenDirectoryFile()
}

func readTreeLink(root *os.Root, name string) (string, error) {
	// os.Root's readlink reads the link itself within the pinned root. Go's
	// Windows FileMode distinguishes real symlinks from junctions (irregular).
	target, err := root.Readlink(name)
	return strings.ReplaceAll(target, `\`, "/"), err
}
