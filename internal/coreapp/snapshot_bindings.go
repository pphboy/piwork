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

func samePortableCapabilities(required, actual json.RawMessage, provider, model, endpoint string) bool {
	if len(required) == 0 && len(actual) == 0 {
		return true
	}
	normalize := func(raw json.RawMessage) any {
		if len(raw) == 0 {
			return map[string]any{"kind": "sdk", "provider": provider, "model": model}
		}
		var v any
		if json.Unmarshal(raw, &v) != nil {
			return nil
		}
		return v
	}
	a, b := normalize(required), normalize(actual)
	if reflect.DeepEqual(a, b) {
		return true
	}
	// The existing exact DeepSeek Messages adapter inherits its SDK definition.
	if provider == "anthropic" && endpoint == "https://api.deepseek.com/anthropic" {
		canonical := map[string]any{"kind": "sdk", "provider": "deepseek", "model": model}
		if len(required) == 0 {
			a = canonical
		}
		if len(actual) == 0 {
			b = canonical
		}
		return reflect.DeepEqual(a, b)
	}
	return false
}

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
		m, _, _, resolveErr := a.catalogModelTx(tx, id, true)
		if resolveErr != nil {
			if errors.Is(resolveErr, corestore.ErrStorage) {
				rows.Close()
				return nil, resolveErr
			}
			continue
		}
		secret, err := a.files.ReadSecret(m.CredentialRef)
		if err != nil || len(secret) < 2 || secret[len(secret)-1] != '\n' {
			continue
		}
		p := RuntimeProfile{Version: 1, Revision: m.SourceRuntimeRevision, UpdatedAt: m.UpdatedAt}
		bindProfileModel(&p, id, m)

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
		expected, err := logicalModelEndpoint(r.Provider, base)
		if err != nil {
			return nil, err
		}
		for _, candidate := range candidates {
			if captured != nil && candidate.CatalogID != captured[key].CatalogID {
				continue
			}
			actual, err := logicalModelEndpoint(candidate.Profile.Model.Provider, candidate.Profile.Model.BaseURL)
			if err != nil || candidate.Profile.Model.Provider != r.Provider || candidate.Profile.Model.ID != r.Model || actual != expected {
				continue
			}
			actualAPI := candidate.Profile.Model.API
			if actualAPI == "" {
				actualAPI = modelAPI(candidate.Profile.Model.Provider)
			}
			if r.Api.Present && string(r.Api.Value) != actualAPI {
				continue
			}
			var required json.RawMessage
			if r.Capabilities.Present {
				required = r.Capabilities.Value
			}
			if !samePortableCapabilities(required, candidate.Profile.Model.Capabilities, candidate.Profile.Model.Provider, candidate.Profile.Model.ID, expected) {
				continue
			}
			// Preserve the source's exact descriptor for its fixed harness.
			candidate.Profile.Model.BaseURL = base
			candidate.Profile.Model.API = ""
			if r.Api.Present {
				candidate.Profile.Model.API = string(r.Api.Value)
			}
			candidate.Profile.Model.Capabilities = append(json.RawMessage(nil), required...)
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
	reg, err := modelRegistryTx(tx)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query("SELECT id FROM catalog_entries WHERE kind='model' AND enabled=1 ORDER BY id")
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
		if id := reg.References[ref]; id != "" {
			m := reg.Models[id]
			p := modelConnection(reg, m)
			if m.Deleted || p.Deleted || !m.Enabled || !p.Enabled || m.ModelRef != ref {
				continue
			}
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
