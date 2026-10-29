package corestore

import (
	"context"
	"errors"
)

func (s *Store) Close() error { return s.CloseContext(context.Background()) }

// CloseDatabase stops admission and drains SQL within the caller's budget,
// retaining installation ownership for the final application log. A single
// cleanup owner outlives an expired caller only until actual database I/O ends.
func (s *Store) CloseDatabase(ctx context.Context) error {
	s.life.Lock()
	if s.databaseCloseDone == nil {
		s.closed = true
		s.databaseCloseDone = make(chan struct{})
		go s.closeDatabase(ctx)
	}
	done := s.databaseCloseDone
	s.life.Unlock()
	// Preserve a completed outcome even if a repeat caller's context expired.
	select {
	case <-done:
	default:
		select {
		case <-done:
		case <-ctx.Done():
			s.life.Lock()
			s.recordShutdownTimeout(ctx)
			s.life.Unlock()
			s.cancelTransactions()
		}
	}
	s.life.Lock()
	defer s.life.Unlock()
	return s.databaseCloseErr
}

// CloseContext requests the final ownership release. Pending rollback/driver
// cleanup retains the lock until it is safe; application callers reach this
// phase only after attempting their final log write and close.
func (s *Store) CloseContext(ctx context.Context) error {
	err := s.CloseDatabase(ctx)
	s.life.Lock()
	defer s.life.Unlock()
	s.releaseRoot = true
	select {
	case <-s.databaseCloseDone:
		s.closeRoot()
	default:
	}
	return errors.Join(err, s.rootCloseErr)
}

// Called under life, which protects only state, never SQL or user callbacks.
func (s *Store) recordShutdownTimeout(ctx context.Context) {
	if s.databaseCloseErr == nil {
		s.databaseCloseErr = errors.Join(ErrShutdown, ErrCheckpoint, ctx.Err())
	}
}

func (s *Store) closeDatabase(ctx context.Context) {
	drained := make(chan struct{})
	go func() { s.transactions.Wait(); close(drained) }()
	select {
	case <-drained:
	case <-ctx.Done():
		s.life.Lock()
		s.recordShutdownTimeout(ctx)
		s.life.Unlock()
		s.cancelTransactions()
		<-drained
	}
	s.cancelTransactions()
	touchErr := s.flushPreparationTouches(ctx)
	var readErr, writeErr error
	if s.reader.Close() != nil {
		readErr = ErrShutdown
	}
	checkpointErr := checkpointDatabase(ctx, s.writer)
	if s.writer.Close() != nil {
		writeErr = ErrShutdown
	}
	s.life.Lock()
	defer s.life.Unlock()
	s.databaseCloseErr = errors.Join(s.databaseCloseErr, touchErr, readErr, checkpointErr, writeErr)
	if s.releaseRoot {
		s.closeRoot()
	}
	close(s.databaseCloseDone)
}

func (s *Store) closeRoot() {
	if !s.rootClosed {
		s.rootClosed = true
		if s.root.Close() != nil {
			s.rootCloseErr = ErrShutdown
		}
	}
}
