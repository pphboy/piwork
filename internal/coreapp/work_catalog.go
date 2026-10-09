package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

var errRuntimeCatalog = errors.New("runtime catalog conflicts with the captured profile")

// ensureRuntimeCatalog preserves every runtime revision as independently
// selectable image/model references. Existing entries are checked but never
// silently reenabled or changed when the installation default is edited.
func (a *Application) ensureRuntimeCatalog(ctx context.Context, profile RuntimeProfile) error {
	imageMetadata, _ := json.Marshal(struct {
		Version               int   `json:"version"`
		SourceRuntimeRevision int64 `json:"sourceRuntimeRevision"`
	}{1, profile.Revision})
	modelMetadata, _ := json.Marshal(struct {
		Version               int     `json:"version"`
		Provider              string  `json:"provider"`
		ID                    string  `json:"id"`
		BaseURL               *string `json:"baseUrl,omitempty"`
		CredentialRef         string  `json:"credentialRef"`
		SourceRuntimeRevision int64   `json:"sourceRuntimeRevision"`
		UpdatedAt             string  `json:"updatedAt"`
	}{1, profile.Model.Provider, profile.Model.ID, profile.Model.BaseURL, profile.Model.CredentialRef, profile.Revision, profile.UpdatedAt})
	now := profile.UpdatedAt
	if now == "" {
		now = time.Now().UTC().Format(time.RFC3339Nano)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, entry := range []struct {
			id, kind, name, metadata string
			mutable                  *string
		}{
			{string(runtimeImageCatalogID(profile.Revision)), "agent_image", fmt.Sprintf("Runtime image revision %d", profile.Revision), string(imageMetadata), &profile.AgentImage},
			{string(runtimeModelCatalogID(profile.Revision)), "model", fmt.Sprintf("Runtime model revision %d", profile.Revision), string(modelMetadata), nil},
		} {
			if entry.kind == "model" && profile.ModelRef != "" {
				continue
			}
			var kind, metadata string
			var mutable *string
			err := tx.QueryRowContext(ctx, `SELECT kind,mutable_reference,metadata_json FROM catalog_entries WHERE id=?`, entry.id).Scan(&kind, &mutable, &metadata)
			if errors.Is(err, sql.ErrNoRows) {
				if _, err := tx.ExecContext(ctx, `INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,?,?,?,NULL,?,1,?,?)`, entry.id, entry.kind, entry.name, entry.mutable, entry.metadata, now, now); err != nil {
					return err
				}
				continue
			}
			if err != nil {
				return err
			}
			if kind != entry.kind || metadata != entry.metadata || (mutable == nil) != (entry.mutable == nil) || mutable != nil && *mutable != *entry.mutable {
				return errRuntimeCatalog
			}
		}
		return nil
	}); err != nil {
		return err
	}
	return a.adoptRuntimeModels(ctx)
}
