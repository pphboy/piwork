package corestore

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// EnableTemporaryServiceStorage publishes the backwards-compatibility guard
// before a transaction can persist anything in temporaryServiceNamespace. It
// is intentionally permanent, including after all temporary work is cleaned.
// Holding the Store's lifetime lock excludes shutdown and competing callers.
func (s *Store) EnableTemporaryServiceStorage() error {
	s.life.Lock()
	defer s.life.Unlock()
	if s.closed {
		return ErrClosed
	}
	file, err := s.root.OpenFile(temporaryServiceGuard, unix.O_RDWR|unix.O_CREAT|unix.O_EXCL)
	if errors.Is(err, os.ErrExist) {
		// A crash may leave the empty file before its directory sync. Sync it
		// again before permitting a database record to be committed.
		if _, err := s.root.ReadFile(temporaryServiceGuard, 0); err != nil {
			return ErrUnsupported
		}
		file, err = s.root.OpenFile(temporaryServiceGuard, unix.O_RDWR)
	}
	if err != nil {
		return ErrStorage
	}
	err = file.Sync()
	closeErr := file.Close()
	if err != nil || closeErr != nil || s.root.Sync() != nil {
		return ErrStorage
	}
	return nil
}
