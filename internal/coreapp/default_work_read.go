package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"

	"piwork/internal/contracts"
)

func (a *Application) defaultWorkView(ctx context.Context) (contracts.AdminDefaultWorkView, error) {
	view := contracts.AdminDefaultWorkView{Configuration: json.RawMessage("null"), BaseImage: json.RawMessage("null")}
	stored, err := a.Store.DefaultWork(ctx)
	if err != nil || stored.Configuration == nil {
		return view, err
	}
	configuration, err := json.Marshal(stored.Configuration)
	if err != nil {
		return view, err
	}
	view.Configuration = configuration
	var kind string
	var reference, resolved sql.NullString
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT kind,mutable_reference,resolved_digest FROM catalog_entries WHERE id=?`, stored.Configuration.AgentImage.CatalogId).Scan(&kind, &reference, &resolved)
	})
	if err == sql.ErrNoRows {
		return view, nil
	}
	if err != nil {
		return view, err
	}
	if kind == "agent_image" {
		if reference.Valid {
			view.BaseImage, _ = json.Marshal(reference.String)
		} else if resolved.Valid {
			view.BaseImage, _ = json.Marshal(resolved.String)
		}
	}
	return view, nil
}
