package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"piwork/internal/contracts"
)

type catalogModelMetadata struct {
	Version               int     `json:"version"`
	Provider              string  `json:"provider"`
	ID                    string  `json:"id"`
	BaseURL               *string `json:"baseUrl,omitempty"`
	CredentialRef         string  `json:"credentialRef"`
	SourceRuntimeRevision int64   `json:"sourceRuntimeRevision"`
	UpdatedAt             string  `json:"updatedAt"`
}

// resolveWorkBinding uses enabled catalog references only for a newly chosen
// image/model. The returned profile is captured into the Work revision, so
// later default edits cannot silently change this Work's runtime.
func (a *Application) resolveWorkBinding(ctx context.Context, config contracts.WorkConfig, priorImageID, priorProfileJSON string, imageChanged, modelChanged bool) (string, string, int64, error) {
	imageID := priorImageID
	profile := RuntimeProfile{}
	if priorProfileJSON != "" {
		if strictMetadata([]byte(priorProfileJSON), &profile) != nil || profile.Version != 1 || profile.Revision < 1 {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "")
		}
	}
	if imageChanged {
		var kind string
		var enabled bool
		var reference, digest sql.NullString
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT kind,enabled,mutable_reference,resolved_digest FROM catalog_entries WHERE id=?`, config.AgentImage.CatalogId).Scan(&kind, &enabled, &reference, &digest)
		})
		if err != nil || kind != "agent_image" || !enabled || !reference.Valid && !digest.Valid {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "agentImage")
		}
		selected := reference.String
		if !reference.Valid {
			selected = digest.String
		}
		if a.engine == nil || a.inspector == nil {
			return "", "", 0, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		image, err := a.engine.PrepareImage(ctx, selected)
		if err != nil {
			return "", "", 0, contracts.NewError("RUNTIME_UNAVAILABLE", "agentImage")
		}
		if _, err := a.inspector.InspectNativeAgent(ctx, image.ID); err != nil {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "agentImage")
		}
		imageID = image.ID
		profile.AgentImage = selected
	}
	if modelChanged {
		var kind string
		var enabled bool
		var raw string
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx, `SELECT kind,enabled,metadata_json FROM catalog_entries WHERE id=?`, config.ModelRef).Scan(&kind, &enabled, &raw)
		})
		if err != nil || kind != "model" || !enabled {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "modelRef")
		}
		var metadata catalogModelMetadata
		if strictMetadata([]byte(raw), &metadata) != nil || metadata.Version != 1 || !providerPattern.MatchString(metadata.Provider) || strings.TrimSpace(metadata.ID) == "" || metadata.CredentialRef == "" || metadata.SourceRuntimeRevision < 1 {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "modelRef")
		}
		if _, err := time.Parse(time.RFC3339Nano, metadata.UpdatedAt); err != nil {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "modelRef")
		}
		if secret, err := a.files.ReadSecret(metadata.CredentialRef); err != nil || len(secret) < 2 || secret[len(secret)-1] != '\n' {
			return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "modelRef")
		}
		profile.Version = 1
		profile.Revision = metadata.SourceRuntimeRevision
		profile.Model.Provider = metadata.Provider
		profile.Model.ID = metadata.ID
		profile.Model.BaseURL = metadata.BaseURL
		profile.Model.CredentialRef = metadata.CredentialRef
		profile.UpdatedAt = metadata.UpdatedAt
	}
	if profile.Version != 1 || profile.Revision < 1 || !capturedImageID.MatchString(imageID) || profile.AgentImage == "" || profile.Model.CredentialRef == "" {
		return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "")
	}
	raw, err := json.Marshal(profile)
	if err != nil {
		return "", "", 0, contracts.NewError("INVALID_CONFIGURATION", "")
	}
	return imageID, string(raw), profile.Revision, nil
}
