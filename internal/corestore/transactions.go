package corestore

import (
	"context"
	"database/sql"
	"errors"
	"sync"
)

// Track SQL connection leases rather than callback lifetimes. A canceled
// transaction can be rolled back and its connection returned even if its caller
// is stuck outside SQLite. That caller can never use the old transaction again.
func (s *Store) beginTransaction(ctx context.Context, readonly bool) (*sql.Tx, func(), error) {
	s.life.Lock()
	if s.closed {
		s.life.Unlock()
		return nil, nil, ErrClosed
	}
	s.transactions.Add(1)
	txCtx, cancel := context.WithCancel(ctx)
	stopShutdown := context.AfterFunc(s.transactionCtx, cancel)
	s.life.Unlock()

	db := s.writer
	if readonly {
		db = s.reader
	}
	connection, err := db.Conn(txCtx)
	if err != nil {
		stopShutdown()
		cancel()
		s.transactions.Done()
		return nil, nil, ErrStorage
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			// Conn.Close waits for the actual rollback/commit and queries to finish;
			// Tx.Rollback alone can return ErrTxDone while rollback is still running.
			if err := connection.Close(); err != nil && err != sql.ErrConnDone {
				s.life.Lock()
				s.databaseCloseErr = errors.Join(s.databaseCloseErr, ErrShutdown)
				s.life.Unlock()
			}
			stopShutdown()
			s.transactions.Done()
		})
	}
	stopRelease := context.AfterFunc(txCtx, release)
	tx, err := connection.BeginTx(txCtx, &sql.TxOptions{ReadOnly: readonly})
	if err != nil {
		stopRelease()
		cancel()
		release()
		return nil, nil, ErrStorage
	}
	return tx, func() {
		_ = tx.Rollback()
		stopRelease()
		cancel()
		release()
	}, nil
}
