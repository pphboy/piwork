package client

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"

	"piwork/internal/clientfs"
)

var errCredentialStorage = errors.New("credential storage requires private current-user storage and a regular file without reparse points or extra hard links")

func defaultCredentialPath() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", errors.New("user configuration directory, XDG_CONFIG_HOME, or PIWORK_CONFIG_PATH is required for credential storage")
	}
	return filepath.Abs(filepath.Join(base, "piwork", "client.json"))
}

type credentialDirectory struct {
	directory *clientfs.Directory
	name      string
	mutation  *clientfs.Lock
}

func openCredentialDirectory(input string, create bool) (*credentialDirectory, error) {
	if strings.TrimSpace(input) == "" || strings.ContainsRune(input, 0) {
		return nil, errCredentialStorage
	}
	path, err := filepath.Abs(input)
	if err != nil || !clientfs.ValidFileName(filepath.Base(path)) || filepath.Dir(path) == filepath.VolumeName(path)+string(filepath.Separator) {
		return nil, errCredentialStorage
	}
	directory, err := clientfs.OpenPrivateDirectory(filepath.Dir(path), create)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, os.ErrNotExist
		}
		return nil, errCredentialStorage
	}
	return &credentialDirectory{directory: directory, name: filepath.Base(path)}, nil
}

func (d *credentialDirectory) close() {
	_ = d.mutation.Close()
	_ = d.directory.Close()
}

func (d *credentialDirectory) lock() error {
	// A directory-scoped lock serializes all credential mutations. Keeping it
	// in a private child avoids treating any valid credential filename as a lock.
	lockDirectory, err := d.directory.Child(".credential-lock", true)
	if err != nil {
		return errCredentialStorage
	}
	defer lockDirectory.Close()
	d.mutation, err = lockDirectory.TryLock(".lock")
	if errors.Is(err, clientfs.ErrBusy) {
		return errors.New("credential storage is busy or cannot be locked")
	}
	if err != nil {
		return errCredentialStorage
	}
	return d.directory.Check()
}

func (d *credentialDirectory) read() ([]byte, error) {
	raw, err := d.directory.ReadFile(d.name, 64<<10)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, errCredentialStorage
	}
	return raw, err
}

func (d *credentialDirectory) replace(raw []byte) error {
	err := d.directory.AtomicWrite(context.Background(), d.name, raw)
	if err != nil {
		return errors.Join(errCredentialStorage, err)
	}
	return nil
}

func (d *credentialDirectory) remove() error {
	if err := d.directory.Remove(d.name); err != nil {
		return errors.Join(errCredentialStorage, err)
	}
	return nil
}
