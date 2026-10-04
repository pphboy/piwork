package coreapp

import (
	"database/sql"
	"encoding/json"
	"reflect"
	"sort"

	"errors"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

type snapshotBoundModel struct {
	CatalogID string         `json:"catalogId"`
	Profile   RuntimeProfile `json:"profile"`
}
type snapshotBindings map[string]snapshotBoundModel

func snapshotModelURL(raw *string) (string, error) {
	if raw == nil {
		return "", nil
	}
	endpoint, err := contracts.NormalizeModelEndpoint(raw)
	if err != nil {
		return "", contracts.NewError("TARGET_MODEL_UNAVAILABLE", "models")
	}
	return *endpoint, nil
}

// Package requirements are logical references, never recipient catalog IDs.
func (a *Application) resolveSnapshotBindings(tx *sql.Tx, owner string, requirements contracts.WorkBindingRequirements, captured snapshotBindings) (snapshotBindings, error) {
	if len(requirements.Secrets) > 0 {
		return nil, contracts.NewError("EXTERNAL_MCP_SECRET_UNAVAILABLE", "secrets")
	}
	var enabled bool
	if err := tx.QueryRow(`SELECT enabled FROM users WHERE id=?`, owner).Scan(&enabled); err != nil || !enabled {
		return nil, contracts.NewError("TARGET_MODEL_UNAVAILABLE", "owner")
	}
	rows, err := tx.Query(`SELECT id,metadata_json FROM catalog_entries WHERE kind='model' AND enabled=1 ORDER BY id`)
	if err != nil {
		return nil, err
	}
	candidates := []snapshotBoundModel{}
	for rows.Next() {
		var id, raw string
		if err := rows.Scan(&id, &raw); err != nil {
			rows.Close()
			return nil, err
		}
		var m catalogModelMetadata
		if strictMetadata([]byte(raw), &m) != nil || m.Version != 1 || m.SourceRuntimeRevision < 1 || m.CredentialRef == "" {
			continue
		}
		secret, err := a.files.ReadSecret(m.CredentialRef)
		if err != nil || len(secret) < 2 || secret[len(secret)-1] != '\n' {
			continue
		}
		p := RuntimeProfile{Version: 1, Revision: m.SourceRuntimeRevision, UpdatedAt: m.UpdatedAt}
		p.Model.Provider = m.Provider
		p.Model.ID = m.ID
		p.Model.BaseURL = m.BaseURL
		p.Model.CredentialRef = m.CredentialRef
		candidates = append(candidates, snapshotBoundModel{id, p})
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Profile.Revision != candidates[j].Profile.Revision {
			return candidates[i].Profile.Revision > candidates[j].Profile.Revision
		}
		return candidates[i].CatalogID < candidates[j].CatalogID
	})
	result := snapshotBindings{}
	for _, r := range requirements.Models {
		key := string(r.Key)
		var base *string
		if len(r.BaseUrl) > 0 && string(r.BaseUrl) != "null" {
			var s string
			if json.Unmarshal(r.BaseUrl, &s) != nil {
				return nil, snapshotInvalid("bindings.models")
			}
			base = &s
		}
		expected, err := snapshotModelURL(base)
		if err != nil {
			return nil, err
		}
		for _, candidate := range candidates {
			if captured != nil && candidate.CatalogID != captured[key].CatalogID {
				continue
			}
			actual, err := snapshotModelURL(candidate.Profile.Model.BaseURL)
			if err != nil || candidate.Profile.Model.Provider != r.Provider || candidate.Profile.Model.ID != r.Model || actual != expected {
				continue
			}
			if captured != nil && !reflect.DeepEqual(candidate, captured[key]) {
				continue
			}
			result[key] = candidate
			break
		}
		if _, found := result[key]; !found {
			return nil, contracts.NewError("TARGET_MODEL_UNAVAILABLE", "models."+key)
		}
	}
	if captured != nil && len(captured) != len(result) {
		return nil, contracts.NewError("TARGET_MODEL_UNAVAILABLE", "models")
	}
	return result, nil
}

// Only safe, currently enabled descriptions are given to the isolated history rebuild.
// Ambiguous identities remain unavailable rather than picking a catalog ID.
func (a *Application) snapshotHistoryModels(tx *sql.Tx) ([]runModelSnapshot, error) {
	rows, err := tx.Query("SELECT id FROM catalog_entries WHERE kind='model' AND enabled=1 ORDER BY id LIMIT 257")
	if err != nil {
		return nil, err
	}
	refs := []string{}
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			rows.Close()
			return nil, err
		}
		refs = append(refs, ref)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(refs) > 256 {
		return nil, contracts.NewError("MODEL_LIST_UNAVAILABLE", "")
	}
	models := []runModelSnapshot{}
	for _, ref := range refs {
		model, _, err := a.resolveRunModelEntry(tx, ref, &ref)
		if errors.Is(err, corestore.ErrStorage) {
			return nil, err
		}
		if err == nil {
			models = append(models, model)
		}
	}
	return models, nil
}
