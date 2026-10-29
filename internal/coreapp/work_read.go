package coreapp

import (
	"context"
	"database/sql"
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/workaccess"
)

func workView(work corestore.WorkRecord) any {
	return struct {
		ID              string  `json:"id"`
		OwnerUserID     string  `json:"ownerUserId"`
		Name            string  `json:"name"`
		DesiredState    string  `json:"desiredState"`
		ObservedState   string  `json:"observedState"`
		DesiredRevision int64   `json:"desiredRevision"`
		ActiveRevision  *int64  `json:"activeRevision"`
		ControlVersion  int64   `json:"controlVersion"`
		DeletedAt       *string `json:"deletedAt"`
		CreatedAt       string  `json:"createdAt"`
		UpdatedAt       string  `json:"updatedAt"`
	}{work.ID, work.OwnerUserID, work.Name, work.DesiredState, work.ObservedState,
		work.DesiredRevision, work.ActiveRevision, work.ControlVersion, work.DeletedAt, work.CreatedAt, work.UpdatedAt}
}

// Durable observations describe the last completed reconciliation. A Ready
// Work is usable only while its current Agent route is still admitted.
func (a *Application) currentWorkView(ctx context.Context, work corestore.WorkRecord) any {
	if work.DesiredState == "running" && (work.ObservedState == "ready" || work.ObservedState == "degraded") {
		if !a.serviceGateway.accepting() {
			work.ObservedState = "unknown"
		} else if _, admitted := a.serviceGateway.workAdmission(ctx, work); !admitted {
			work.ObservedState = "unknown"
		}
	}
	return workView(work)
}

func (a *Application) workRead(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	if r.Method != http.MethodGet {
		return false, nil
	}
	if r.URL.EscapedPath() == "/api/v1/works" {
		records := make([]corestore.WorkRecord, 0)
		err := a.Store.Read(r.Context(), func(tx *sql.Tx) error {
			rows, err := tx.QueryContext(r.Context(), `SELECT id FROM works WHERE deleted_at IS NULL ORDER BY created_at,id`)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					return err
				}
				work, err := corestore.ReadWork(tx, id, false)
				if err != nil {
					return err
				}
				if work.OwnerUserID == actor.UserID || actor.Role == "admin" {
					records = append(records, work)
				}
			}
			return rows.Err()
		})
		if err != nil {
			return true, err
		}
		works := make([]any, 0, len(records))
		for _, work := range records {
			works = append(works, a.currentWorkView(r.Context(), work))
		}
		send(w, 200, map[string]any{"works": works})
		return true, nil
	}
	const prefix = "/api/v1/works/"
	if !strings.HasPrefix(r.URL.EscapedPath(), prefix) {
		return false, nil
	}
	rawID := strings.TrimPrefix(r.URL.EscapedPath(), prefix)
	if rawID == "" || strings.Contains(rawID, "/") {
		return false, nil
	}
	id, err := url.PathUnescape(rawID)
	if err != nil || id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\\x00") {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	work, err := workaccess.Work(r.Context(), a.Store, actor, id, workaccess.Metadata)
	if err != nil {
		return true, err
	}
	send(w, 200, a.currentWorkView(r.Context(), work))
	return true, nil
}
