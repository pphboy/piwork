package corestore

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

type RuntimeGeneration struct {
	WorkID               string
	Generation           int64
	InstanceID           *string
	State                string
	RetryCount           int
	RetryWindowStartedAt *string
	NextRetryAt          *string
	ReadySince           *string
	CreatedAt            string
	UpdatedAt            string
}

func readRuntimeGeneration(tx *sql.Tx, workID string, generation int64) (RuntimeGeneration, error) {
	var value RuntimeGeneration
	err := tx.QueryRow(`SELECT work_id,generation,instance_id,state,retry_count,retry_window_started_at,next_retry_at,ready_since,created_at,updated_at
		FROM runtime_generations WHERE work_id=? AND generation=?`, workID, generation).Scan(
		&value.WorkID, &value.Generation, &value.InstanceID, &value.State, &value.RetryCount,
		&value.RetryWindowStartedAt, &value.NextRetryAt, &value.ReadySince, &value.CreatedAt, &value.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return value, ErrNotFound
	}
	return value, err
}

func (s *Store) RuntimeGeneration(ctx context.Context, workID string, generation int64) (RuntimeGeneration, error) {
	var value RuntimeGeneration
	err := s.Read(ctx, func(tx *sql.Tx) error {
		var err error
		value, err = readRuntimeGeneration(tx, workID, generation)
		return err
	})
	return value, err
}

var retryBackoff = [...]time.Duration{time.Second, 5 * time.Second, 15 * time.Second}

// RecordRuntimeFailure stores the retry count and deadline in the same
// transaction. Process restart cannot grant a fresh retry budget.
func (s *Store) RecordRuntimeFailure(ctx context.Context, workID string, generation int64, at time.Time) (RuntimeGeneration, error) {
	var output RuntimeGeneration
	now := at.UTC().Format(time.RFC3339Nano)
	err := s.Write(ctx, func(tx *sql.Tx) error {
		current, err := readRuntimeGeneration(tx, workID, generation)
		if err != nil {
			return err
		}
		windowStart := at.UTC()
		count := current.RetryCount
		if current.RetryWindowStartedAt == nil {
			count = 0
		} else {
			parsed, err := time.Parse(time.RFC3339Nano, *current.RetryWindowStartedAt)
			if err != nil {
				return ErrStorage
			}
			if at.Sub(parsed) >= 10*time.Minute {
				count = 0
			} else {
				windowStart = parsed
			}
		}
		state := "recovering"
		var next *string
		if count < len(retryBackoff) {
			deadline := at.UTC().Add(retryBackoff[count]).Format(time.RFC3339Nano)
			next = &deadline
			count++
		} else {
			state = "failed"
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state=?,retry_count=?,retry_window_started_at=?,next_retry_at=?,ready_since=NULL,updated_at=?
			WHERE work_id=? AND generation=?`, state, count, windowStart.Format(time.RFC3339Nano), next, now, workID, generation); err != nil {
			return err
		}
		output, err = readRuntimeGeneration(tx, workID, generation)
		return err
	})
	return output, err
}

func (s *Store) ResetRuntimeRetryBudget(ctx context.Context, workID string, generation int64, at time.Time) (RuntimeGeneration, error) {
	var output RuntimeGeneration
	err := s.Write(ctx, func(tx *sql.Tx) error {
		if _, err := readRuntimeGeneration(tx, workID, generation); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state='preparing',retry_count=0,retry_window_started_at=NULL,next_retry_at=NULL,ready_since=NULL,updated_at=? WHERE work_id=? AND generation=?`, at.UTC().Format(time.RFC3339Nano), workID, generation); err != nil {
			return err
		}
		var err error
		output, err = readRuntimeGeneration(tx, workID, generation)
		return err
	})
	return output, err
}

func (s *Store) ResetStableRuntimeRetryBudget(ctx context.Context, workID string, generation int64, at time.Time) (RuntimeGeneration, error) {
	var output RuntimeGeneration
	err := s.Write(ctx, func(tx *sql.Tx) error {
		current, err := readRuntimeGeneration(tx, workID, generation)
		if err != nil {
			return err
		}
		if current.ReadySince != nil {
			ready, err := time.Parse(time.RFC3339Nano, *current.ReadySince)
			if err != nil {
				return ErrStorage
			}
			if at.Sub(ready) >= 10*time.Minute {
				if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET retry_count=0,retry_window_started_at=NULL,next_retry_at=NULL,updated_at=? WHERE work_id=? AND generation=?`, at.UTC().Format(time.RFC3339Nano), workID, generation); err != nil {
					return err
				}
			}
		}
		output, err = readRuntimeGeneration(tx, workID, generation)
		return err
	})
	return output, err
}

func (s *Store) DueRuntimeRetries(ctx context.Context, at time.Time) ([]RuntimeGeneration, error) {
	result := make([]RuntimeGeneration, 0)
	err := s.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT work_id,generation FROM runtime_generations WHERE state='recovering' AND next_retry_at<=? ORDER BY next_retry_at,work_id,generation`, at.UTC().Format(time.RFC3339Nano))
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var workID string
			var generation int64
			if err := rows.Scan(&workID, &generation); err != nil {
				return err
			}
			value, err := readRuntimeGeneration(tx, workID, generation)
			if err != nil {
				return err
			}
			result = append(result, value)
		}
		return rows.Err()
	})
	return result, err
}
