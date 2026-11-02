package coreapp

import (
	"context"
	"database/sql"

	"piwork/internal/corestore"
)

func (a *Application) temporaryEngineUnavailableLocked(epoch uint64) bool {
	p := a.preparation
	entry := p.entries["docker"]
	return !a.closed && p.engineEpoch == epoch && !p.engineOnline && entry.State == "retrying" && entry.Code != nil && *entry.Code == "DOCKER_UNAVAILABLE"
}

// No Engine effect is attempted with a revoked Engine context. Keep the original
// durable request actionable until the healthy reconciler can confirm removal.
func (a *Application) observeUnavailableTemporaryCleanups(ctx context.Context) {
	a.mu.Lock()
	epoch := a.preparation.engineEpoch
	confirmed := a.temporaryEngineUnavailableLocked(epoch)
	a.mu.Unlock()
	if !confirmed {
		return
	}
	records, err := a.Store.TemporaryCleanupCandidates(ctx)
	if err != nil {
		return
	}

	for _, record := range records {
		if ctx.Err() != nil {
			return
		}
		var cleanup corestore.TemporaryCleanupRecord
		var found bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			cleanup, found, err = corestore.ReadTemporaryCleanupTx(tx, record.Owner.WorkID, record.ServiceID)
			return err
		}); err != nil || !found || cleanup.State != "requested" {
			continue
		}
		_ = a.observeUnavailableTemporaryCleanup(ctx, epoch, record, cleanup.OperationID)
	}
}
func (a *Application) observeUnavailableTemporaryCleanup(ctx context.Context, epoch uint64, record corestore.TemporaryServiceRecord, operationID string) error {
	return a.Store.ObserveTemporaryCleanupUnavailable(ctx, record, operationID, packageNow(), func(publish func() error) error {
		a.mu.Lock()
		defer a.mu.Unlock()
		if !a.temporaryEngineUnavailableLocked(epoch) {
			return nil
		}
		return publish()
	})
}
