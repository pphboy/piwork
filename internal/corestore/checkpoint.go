package corestore

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"time"
)

var ErrCheckpoint = errors.New("Core storage checkpoint was not confirmed")
var ErrShutdown = errors.New("Core storage shutdown was not confirmed")

func checkpointDatabase(ctx context.Context, db *sql.DB) error {
	failure := func() error { return errors.Join(ErrCheckpoint, ctx.Err()) }
	if ctx.Err() != nil {
		return failure()
	}
	connection, err := db.Conn(ctx)
	if err != nil {
		return failure()
	}
	defer connection.Close()
	// Interrupting a query alone does not necessarily interrupt SQLite's busy
	// sleep. Limit that sleep to the caller's remaining shutdown budget too.
	wait := 5000
	if deadline, ok := ctx.Deadline(); ok {
		remaining := time.Until(deadline).Milliseconds()
		if remaining < int64(wait) {
			wait = int(max(remaining, 0))
		}
	}
	if _, err := connection.ExecContext(ctx, "PRAGMA busy_timeout="+strconv.Itoa(wait)); err != nil {
		return failure()
	}
	var busy, frames, backfilled int
	err = connection.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &frames, &backfilled)
	// A busy checkpoint returns a SQL row, not a driver error. TRUNCATE has
	// completed only when it reports all three zeroes on this WAL connection.
	if err != nil || busy != 0 || frames != 0 || backfilled != 0 || ctx.Err() != nil {
		return failure()
	}
	return nil
}
