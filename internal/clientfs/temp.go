package clientfs

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
)

// TempDirectory creates private storage beneath an ordinary pinned parent.
// cleanup refuses links or foreign objects instead of following their paths.
func TempDirectory(base, prefix string) (*Directory, string, func() error, error) {
	parent, err := OpenDirectory(base)
	if err != nil {
		return nil, "", nil, err
	}
	child, name, err := parent.CreateTempDirectory(prefix)
	if err != nil {
		parent.Close()
		return nil, "", nil, err
	}
	cleanup := func() error { return errors.Join(parent.RemoveTree(name), child.Close(), parent.Close()) }
	return child, filepath.Join(base, name), cleanup, nil
}

func (d *Directory) CreateTempDirectory(prefix string) (*Directory, string, error) {
	if !validName(prefix) || len(prefix) > 180 {
		return nil, "", ErrUnsafe
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return nil, "", err
	}
	name := prefix + hex.EncodeToString(nonce[:])
	child, err := d.createPrivateChild(name)
	return child, name, err
}

// RemoveTree only descends into private, owned, no-follow directories. An
// unsafe child stops cleanup; it cannot redirect deletion outside the handle.
func (d *Directory) RemoveTree(name string) error {
	child, err := d.Child(name, false)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer child.Close()
	child.private = true
	if err := child.Check(); err != nil {
		return err
	}
	items, err := child.Entries()
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.IsDir() {
			err = child.RemoveTree(item.Name())
		} else {
			err = child.Remove(item.Name())
		}
		if err != nil {
			return err
		}
	}
	return d.removeChildDirectory(name, child)
}

func (d *Directory) HasSpace(bytes, reserve int64) (bool, error) {
	if bytes < 0 || reserve < 0 {
		return false, ErrUnsafe
	}
	available, err := d.FreeBytes()
	if err != nil {
		return false, err
	}
	return available >= uint64(bytes)+uint64(reserve), nil
}
