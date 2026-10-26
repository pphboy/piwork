package coreapp

import (
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workaccess"
)

// Cleanup history remains addressable to the Work owner after deletion. It
// never includes container output, command/environment, or private leases.
func (a *Application) temporaryCleanupHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), "/"), "/")
	if len(parts) < 5 || len(parts) > 6 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "works" || parts[4] != "temporary-cleanups" || r.Method != http.MethodGet {
		return false, nil
	}
	for _, index := range []int{3, 5} {
		if index >= len(parts) {
			continue
		}
		value, err := url.PathUnescape(parts[index])
		if err != nil || !validResourceID(value) {
			return true, contracts.NewError("NOT_FOUND", "")
		}
		parts[index] = value
	}
	work, err := workaccess.WorkOperation(r.Context(), a.Store, actor, parts[3])
	if err != nil {
		return true, err
	}
	if actor.UserID != work.OwnerUserID {
		return true, contracts.NewError("PERMISSION_DENIED", "")
	}
	query := r.URL.Query()
	if len(query) > 1 || len(query["runId"]) > 1 || len(query) == 1 && len(query["runId"]) != 1 {
		return true, contracts.NewError("INVALID_REQUEST", "runId")
	}
	runID := query.Get("runId")
	if runID != "" && !validResourceID(runID) {
		return true, contracts.NewError("INVALID_REQUEST", "runId")
	}
	var items []corestore.TemporaryCleanupRecord
	var retention corestore.TemporaryHistoryRetention
	err = a.Store.Read(r.Context(), func(tx *sql.Tx) error {
		var err error
		retention, err = corestore.TemporaryHistoryRetentionTx(tx, work.ID)
		if err != nil {
			return err
		}
		if len(parts) == 6 {
			item, found, err := corestore.ReadTemporaryCleanupTx(tx, work.ID, parts[5])
			if err != nil {
				return err
			}
			if !found || runID != "" && item.RunID != runID {
				return corestore.ErrNotFound
			}
			items = append(items, item)
			return nil
		}
		records, err := corestore.ListTemporaryServicesTx(tx, work.ID, runID)
		if err != nil {
			return err
		}
		items = make([]corestore.TemporaryCleanupRecord, 0, len(records))
		for _, record := range records {
			item, found, err := corestore.ReadTemporaryCleanupTx(tx, work.ID, record.ServiceID)
			if err != nil {
				return err
			}
			if found {
				items = append(items, item)
			}
		}
		return nil
	})
	if err != nil {
		return true, servicePublicError(err)
	}
	if len(parts) == 6 {
		send(w, 200, items[0])
		return true, nil
	}
	send(w, 200, map[string]any{"items": items, "truncated": retention.Dropped > 0})
	return true, nil
}
