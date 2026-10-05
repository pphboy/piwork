//go:build linux

package client

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/unix"
	"piwork/internal/safefs"
)

var errCredentialStorage = errors.New("credential storage requires a private user-owned directory and a regular user-owned 0600 file without symbolic links")

func defaultCredentialPath() (string, error) {
	if base := os.Getenv("HOME"); base != "" {
		return filepath.Abs(filepath.Join(base, ".config", "piwork", "client.json"))
	}
	return "", errors.New("HOME, XDG_CONFIG_HOME, or PIWORK_CONFIG_PATH is required for credential storage")
}

// A credential directory is pinned once; none of the operations reopen the
// caller's pathname after checking it. Public ancestors such as /tmp are
// allowed, but no ancestor is followed through a symbolic link.
type credentialDirectory struct {
	fd   int
	name string
}

func openCredentialDirectory(input string, create bool) (*credentialDirectory, error) {
	if strings.TrimSpace(input) == "" || strings.ContainsRune(input, 0) {
		return nil, errCredentialStorage
	}
	path, err := filepath.Abs(input)
	if err != nil || !safefs.ValidFileName(filepath.Base(path)) || filepath.Dir(path) == "/" {
		return nil, errCredentialStorage
	}
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, errCredentialStorage
	}
	for _, component := range strings.Split(strings.TrimPrefix(filepath.Dir(path), "/"), "/") {
		next, openErr := unix.Openat(fd, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		if create && errors.Is(openErr, unix.ENOENT) {
			if mkdirErr := unix.Mkdirat(fd, component, 0700); mkdirErr != nil && !errors.Is(mkdirErr, unix.EEXIST) {
				unix.Close(fd)
				return nil, errCredentialStorage
			}
			if unix.Fsync(fd) != nil {
				unix.Close(fd)
				return nil, errCredentialStorage
			}
			next, openErr = unix.Openat(fd, component, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		}
		unix.Close(fd)
		if openErr != nil {
			if errors.Is(openErr, unix.ENOENT) {
				return nil, os.ErrNotExist
			}
			return nil, errCredentialStorage
		}
		fd = next
	}
	directory := &credentialDirectory{fd: fd, name: filepath.Base(path)}
	if err := directory.check(); err != nil {
		directory.close()
		return nil, err
	}
	return directory, nil
}

func (d *credentialDirectory) close() { _ = unix.Close(d.fd) }

func (d *credentialDirectory) lock() error {
	if err := d.check(); err != nil {
		return err
	}
	if err := unix.Flock(d.fd, unix.LOCK_EX|unix.LOCK_NB); err != nil {
		return errors.New("credential storage is busy or cannot be locked")
	}
	return d.check()
}

func (d *credentialDirectory) check() error {
	var info unix.Stat_t
	if unix.Fstat(d.fd, &info) != nil || !validCredentialDirectory(&info) {
		return errCredentialStorage
	}
	return nil
}

func validCredentialDirectory(info *unix.Stat_t) bool {
	return info.Mode&unix.S_IFMT == unix.S_IFDIR && info.Uid == uint32(os.Geteuid()) && info.Mode&0077 == 0
}

func validCredentialFile(info *unix.Stat_t) bool {
	return info.Mode&unix.S_IFMT == unix.S_IFREG && info.Uid == uint32(os.Geteuid()) && info.Mode&07777 == 0600 && info.Nlink == 1
}

func (d *credentialDirectory) target() (unix.Stat_t, error) {
	var info unix.Stat_t
	if err := d.check(); err != nil {
		return info, err
	}
	if err := unix.Fstatat(d.fd, d.name, &info, unix.AT_SYMLINK_NOFOLLOW); err != nil {
		if errors.Is(err, unix.ENOENT) {
			return info, os.ErrNotExist
		}
		return info, errCredentialStorage
	}
	if !validCredentialFile(&info) {
		return info, errCredentialStorage
	}
	return info, nil
}

func (d *credentialDirectory) read() ([]byte, error) {
	before, err := d.target()
	if err != nil {
		return nil, err
	}
	fd, err := unix.Openat(d.fd, d.name, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, errCredentialStorage
	}
	file := os.NewFile(uintptr(fd), "credential")
	defer file.Close()
	var opened unix.Stat_t
	if unix.Fstat(fd, &opened) != nil || !validCredentialFile(&opened) || opened.Dev != before.Dev || opened.Ino != before.Ino {
		return nil, errCredentialStorage
	}
	raw, err := io.ReadAll(io.LimitReader(file, (64<<10)+1))
	if err != nil || len(raw) > 64<<10 || d.check() != nil || unix.Fstat(fd, &opened) != nil || !validCredentialFile(&opened) {
		return nil, errCredentialStorage
	}
	return raw, nil
}

func (d *credentialDirectory) replace(raw []byte) error {
	if _, err := d.target(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var nonce [16]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		return errCredentialStorage
	}
	temporary := ".client." + hex.EncodeToString(nonce[:]) + ".tmp"
	fd, err := unix.Openat(d.fd, temporary, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0600)
	if err != nil {
		return errCredentialStorage
	}
	defer unix.Unlinkat(d.fd, temporary, 0)
	file := os.NewFile(uintptr(fd), "credential temporary")
	// Chmod only this exclusively created, pinned file; never an existing path.
	modeErr := file.Chmod(0600)
	_, writeErr := file.Write(raw)
	syncErr := file.Sync()
	closeErr := file.Close()
	if errors.Join(modeErr, writeErr, syncErr, closeErr) != nil {
		return errCredentialStorage
	}
	if _, err := d.target(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if unix.Renameat(d.fd, temporary, d.fd, d.name) != nil || unix.Fsync(d.fd) != nil {
		return errCredentialStorage
	}
	return nil
}

func (d *credentialDirectory) remove() error {
	if _, err := d.target(); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	if unix.Unlinkat(d.fd, d.name, 0) != nil || unix.Fsync(d.fd) != nil {
		return errCredentialStorage
	}
	return nil
}
