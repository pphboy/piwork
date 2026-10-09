package coreapp

import (
	"context"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

const modelRegistryKey = "ai_model_registry"

// Generated from the fixed SDK's static provider definitions at build time.
//
//go:embed model-sdk-catalog.json
var modelSDKCatalog []byte
var modelSDKAPIs = func() map[string]string {
	var result map[string]string
	if json.Unmarshal(modelSDKCatalog, &result) != nil {
		panic("invalid built-in model catalog")
	}
	return result
}()

type managedProvider struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	API               string `json:"api"`
	BaseURL           string `json:"baseUrl"`
	Enabled           bool   `json:"enabled"`
	CredentialRef     string `json:"credentialRef"`
	CredentialVersion string `json:"credentialVersion"`
	Deleted           bool   `json:"deleted"`
	CreatedAt         string `json:"createdAt"`
	UpdatedAt         string `json:"updatedAt"`
}
type managedModel struct {
	Connection   *managedProvider `json:"connection,omitempty"`
	ID           string           `json:"id"`
	ProviderID   string           `json:"providerId"`
	Name         string           `json:"name"`
	Model        string           `json:"model"`
	ModelRef     string           `json:"modelRef"`
	Capabilities json.RawMessage  `json:"capabilities,omitempty"`
	Enabled      bool             `json:"enabled"`
	Deleted      bool             `json:"deleted"`
	CreatedAt    string           `json:"createdAt"`
	UpdatedAt    string           `json:"updatedAt"`
}
type modelRegistry struct {
	Version      int                         `json:"version"`
	NextRevision int64                       `json:"nextRevision"`
	Providers    map[string]*managedProvider `json:"providers"`
	Models       map[string]*managedModel    `json:"models"`
	References   map[string]string           `json:"references"`
}

func modelRegistryTx(tx *sql.Tx) (modelRegistry, error) {
	r := modelRegistry{Version: 2, NextRevision: 1, Providers: map[string]*managedProvider{}, Models: map[string]*managedModel{}, References: map[string]string{}}
	var raw string
	err := tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", modelRegistryKey).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return r, nil
	}
	if err != nil {
		return r, corestore.ErrStorage
	}
	if strictMetadata([]byte(raw), &r) != nil || (r.Version != 1 && r.Version != 2) || r.NextRevision < 1 || r.Providers == nil || r.Models == nil || r.References == nil {
		return r, corestore.ErrStorage
	}
	for id, p := range r.Providers {
		if p == nil || id != p.ID || contracts.Validate("ResourceIdSchema", id) != nil || (p.API != "openai-responses" && p.API != "anthropic-messages") || p.CredentialRef == "" || p.CredentialVersion == "" {
			return r, corestore.ErrStorage
		}
	}
	for id, m := range r.Models {
		if m == nil || id != m.ID || r.Providers[m.ProviderID] == nil || r.References[m.ModelRef] != id || contracts.Validate("ResourceIdSchema", id) != nil {
			return r, corestore.ErrStorage
		}
		if len(m.Capabilities) > 0 && contracts.Validate("ModelCapabilitiesSchema", m.Capabilities) != nil {
			return r, corestore.ErrStorage
		}
	}
	for _, m := range r.Models {
		if m.Connection == nil {
			copy := *r.Providers[m.ProviderID]
			m.Connection = &copy
		}
		p := m.Connection
		if p.ID != m.ProviderID || (p.API != "openai-responses" && p.API != "anthropic-messages") || p.CredentialRef == "" || p.CredentialVersion == "" {
			return r, corestore.ErrStorage
		}
	}
	r.Version = 2
	for ref, id := range r.References {
		if r.Models[id] == nil || contracts.Validate("ResourceIdSchema", ref) != nil {
			return r, corestore.ErrStorage
		}
	}
	return r, nil
}
func saveModelRegistryTx(tx *sql.Tx, r modelRegistry) error {
	raw, err := json.Marshal(r)
	if err != nil || len(raw) > 2<<20 {
		return corestore.ErrStorage
	}
	_, err = tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", modelRegistryKey, string(raw), modelNow())
	return err
}
func modelNow() string             { return time.Now().UTC().Format(time.RFC3339Nano) }
func modelID(prefix string) string { return prefix + "-" + uuid.NewString() }
func modelProviderID(api string) string {
	if api == "anthropic-messages" {
		return "anthropic"
	}
	return "openai"
}
func modelAPI(provider string) string {
	switch provider {
	case "openai":
		return "openai-responses"
	case "anthropic":
		return "anthropic-messages"
	}
	return ""
}
func validManagedEndpoint(api, value string) (string, error) {
	endpoint, err := contracts.NormalizeProtocolModelEndpoint(api, &value)
	if err != nil || endpoint == nil {
		return "", contracts.NewError("INVALID_REQUEST", "baseUrl")
	}
	if ValidateRuntime(RuntimeInput{AgentImage: "validation", Provider: modelProviderID(api), Model: "validation", Credential: "validation", BaseURL: endpoint}) != nil {
		return "", contracts.NewError("INVALID_REQUEST", "baseUrl")
	}
	return *endpoint, nil
}
func validManagedCredential(value string) error {
	if strings.TrimSpace(value) == "" || len(value) > 65536 || strings.ContainsAny(value, "\x00\r\n") {
		return contracts.NewError("INVALID_REQUEST", "credential")
	}
	return nil
}

// Compatibility DTOs retain their original 128-character display limit.
// Projection never changes the canonical model or immutable execution identity.
func legacyModelDisplayName(value string) string {
	runes := []rune(value)
	if len(runes) > 128 {
		return string(runes[:128])
	}
	return value
}

func (a *Application) providerView(p *managedProvider) contracts.ModelProvider {
	key, err := a.files.ReadSecret(p.CredentialRef)
	return contracts.ModelProvider{Id: contracts.ResourceId(p.ID), Name: legacyModelDisplayName(p.Name), Api: contracts.ModelApi(p.API), BaseUrl: p.BaseURL, Enabled: p.Enabled, CredentialAvailable: err == nil && len(key) > 1, CreatedAt: contracts.Timestamp(p.CreatedAt), UpdatedAt: contracts.Timestamp(p.UpdatedAt)}
}
func (a *Application) managedModelView(r modelRegistry, m *managedModel) contracts.ManagedModel {
	p := modelConnection(r, m)
	pv := a.providerView(p)
	status := "sdk"
	sourceProvider, sourceModel := modelProviderID(p.API), m.Model
	if len(m.Capabilities) > 0 {
		var c struct {
			Kind     string `json:"kind"`
			Provider string `json:"provider"`
			Model    string `json:"model"`
		}
		_ = json.Unmarshal(m.Capabilities, &c)
		if c.Kind == "explicit" {
			status = "explicit"
		} else {
			sourceProvider, sourceModel = c.Provider, c.Model
		}
	}
	if status == "sdk" && modelSDKAPIs[sourceProvider+"/"+sourceModel] != p.API {
		status = "unconfirmed"
		if len(m.Capabilities) == 0 && p.API == "anthropic-messages" && p.BaseURL == "https://api.deepseek.com/anthropic" && modelSDKAPIs["deepseek/"+m.Model] != "" {
			status = "sdk"
		}
	}
	v := contracts.ManagedModel{Id: contracts.ResourceId(m.ID), ProviderId: contracts.ResourceId(m.ProviderID), Name: legacyModelDisplayName(m.Name), Model: m.Model, ModelRef: contracts.ResourceId(m.ModelRef), Api: contracts.ModelApi(p.API), ProviderName: legacyModelDisplayName(p.Name), ProviderEnabled: p.Enabled && !p.Deleted, CredentialAvailable: pv.CredentialAvailable, Enabled: m.Enabled, CapabilityStatus: status, CreatedAt: contracts.Timestamp(m.CreatedAt), UpdatedAt: contracts.Timestamp(m.UpdatedAt)}
	if len(m.Capabilities) > 0 {
		v.Capabilities = contracts.Supplied(append(json.RawMessage(nil), m.Capabilities...))
	}
	return v
}
func (a *Application) registryViews(ctx context.Context) ([]contracts.ModelProvider, []contracts.ManagedModel, error) {
	providers := []contracts.ModelProvider{}
	models := []contracts.ManagedModel{}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		for _, p := range r.Providers {
			if !p.Deleted {
				providers = append(providers, a.providerView(p))
			}
		}
		for _, m := range r.Models {
			if !m.Deleted {
				models = append(models, a.managedModelView(r, m))
			}
		}
		return nil
	})
	sort.Slice(providers, func(i, j int) bool {
		if providers[i].Name == providers[j].Name {
			return providers[i].Id < providers[j].Id
		}
		return providers[i].Name < providers[j].Name
	})
	sort.Slice(models, func(i, j int) bool {
		if models[i].ProviderName == models[j].ProviderName {
			if models[i].Name == models[j].Name {
				return models[i].Id < models[j].Id
			}
			return models[i].Name < models[j].Name
		}
		return models[i].ProviderName < models[j].ProviderName
	})
	return providers, models, err
}
func (a *Application) createModelProvider(ctx context.Context, actor identity.Principal, in contracts.CreateModelProvider) (contracts.ModelProvider, error) {
	var view contracts.ModelProvider
	if err := contracts.Validate("CreateModelProviderSchema", in); err != nil {
		return view, err
	}
	base, err := validManagedEndpoint(string(in.Api), in.BaseUrl)
	if err != nil {
		return view, err
	}
	if err := validManagedCredential(in.Credential); err != nil {
		return view, err
	}
	if strings.TrimSpace(in.Name) == "" {
		return view, contracts.NewError("INVALID_REQUEST", "name")
	}
	if err := a.Identity.AuthorizeAdministrator(ctx, actor); err != nil {
		return view, err
	}
	secret := "model-" + uuid.NewString() + ".secret"
	if err := a.files.WriteSecret(secret, []byte(in.Credential+"\n")); err != nil {
		return view, err
	}
	prepared := false
	defer func() {
		if !prepared {
			_ = a.files.RemoveSecret(secret)
		}
	}()
	if a.modelRegistryFault != nil {
		if err := a.modelRegistryFault("after-key-write"); err != nil {
			return view, err
		}
	}
	// A successful callback may have committed even when Commit reports failure.
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		count := 0
		for _, p := range r.Providers {
			if !p.Deleted {
				count++
			}
		}
		if count >= 256 {
			return contracts.NewError("CONFLICT", "providers")
		}
		now := modelNow()
		p := &managedProvider{ID: modelID("provider"), Name: in.Name, API: string(in.Api), BaseURL: base, Enabled: true, CredentialRef: secret, CredentialVersion: modelID("credential"), CreatedAt: now, UpdatedAt: now}
		r.Providers[p.ID] = p
		if err := saveModelRegistryTx(tx, r); err != nil {
			return err
		}
		if a.modelRegistryFault != nil {
			if err := a.modelRegistryFault("before-head-commit"); err != nil {
				return err
			}
		}
		prepared = true
		view = a.providerView(p)
		return nil
	})
	return view, err
}
func (a *Application) publishModelBindingTx(tx *sql.Tx, r *modelRegistry, m *managedModel) error {
	p := modelConnection(*r, m)
	ref := modelID("model-config")
	now := modelNow()
	metadata := catalogModelMetadata{Version: 2, Provider: modelProviderID(p.API), ID: m.Model, BaseURL: &p.BaseURL, CredentialRef: p.CredentialRef, SourceRuntimeRevision: r.NextRevision, UpdatedAt: now, API: p.API, ProviderID: p.ID, ManagedModelID: m.ID, Capabilities: append(json.RawMessage(nil), m.Capabilities...)}
	raw, err := json.Marshal(metadata)
	if err != nil {
		return err
	}
	_, err = tx.Exec("INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'model',?,NULL,NULL,?,1,?,?)", ref, ref, string(raw), now, now)
	if err != nil {
		return err
	}
	r.NextRevision++
	m.ModelRef = ref
	r.References[ref] = m.ID
	return nil
}
func (a *Application) createManagedModel(ctx context.Context, actor identity.Principal, providerID string, in contracts.CreateManagedModel) (contracts.ManagedModel, error) {
	var view contracts.ManagedModel
	if err := contracts.Validate("CreateManagedModelSchema", in); err != nil {
		return view, err
	}
	if strings.TrimSpace(in.Name) == "" || strings.TrimSpace(in.Model) == "" {
		return view, contracts.NewError("INVALID_REQUEST", "model")
	}
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		p := r.Providers[providerID]
		if p == nil || p.Deleted {
			return contracts.NewError("NOT_FOUND", "providerId")
		}
		count := 0
		for _, m := range r.Models {
			if !m.Deleted {
				count++
				if m.ProviderID == providerID && m.Model == in.Model {
					return contracts.NewError("CONFLICT", "model")
				}
			}
		}
		if count >= 256 {
			return contracts.NewError("CONFLICT", "models")
		}
		now := modelNow()
		m := &managedModel{ID: modelID("managed-model"), ProviderID: providerID, Name: in.Name, Model: in.Model, Enabled: true, CreatedAt: now, UpdatedAt: now}
		if in.Capabilities.Present {
			m.Capabilities = append(json.RawMessage(nil), in.Capabilities.Value...)
		}
		copy := *p
		m.Connection = &copy
		r.Models[m.ID] = m
		if err := a.publishModelBindingTx(tx, &r, m); err != nil {
			return err
		}
		if err := saveModelRegistryTx(tx, r); err != nil {
			return err
		}
		view = a.managedModelView(r, m)
		return nil
	})
	return view, err
}
func (a *Application) patchModelProvider(ctx context.Context, actor identity.Principal, id string, in contracts.PatchModelProvider) (contracts.ModelProvider, error) {
	var view contracts.ModelProvider
	if err := contracts.Validate("PatchModelProviderSchema", in); err != nil {
		return view, err
	}
	if in.Name.Present && strings.TrimSpace(in.Name.Value) == "" {
		return view, contracts.NewError("INVALID_REQUEST", "name")
	}
	secret := ""
	prepared := false
	defer func() {
		if secret != "" && !prepared {
			_ = a.files.RemoveSecret(secret)
		}
	}()
	if in.Credential.Present {
		if err := validManagedCredential(in.Credential.Value); err != nil {
			return view, err
		}
		if err := a.Identity.AuthorizeAdministrator(ctx, actor); err != nil {
			return view, err
		}
		secret = "model-" + uuid.NewString() + ".secret"
		if err := a.files.WriteSecret(secret, []byte(in.Credential.Value+"\n")); err != nil {
			return view, err
		}
		if a.modelRegistryFault != nil {
			if err := a.modelRegistryFault("after-key-write"); err != nil {
				return view, err
			}
		}
	}
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		p := r.Providers[id]
		if p == nil || p.Deleted {
			return contracts.NewError("NOT_FOUND", "providerId")
		}
		changed := false
		if in.BaseUrl.Present {
			base, err := validManagedEndpoint(p.API, in.BaseUrl.Value)
			if err != nil {
				return err
			}
			changed = base != p.BaseURL
			p.BaseURL = base
		}
		if in.Name.Present {
			p.Name = in.Name.Value
		}
		if secret != "" {
			p.CredentialRef = secret
			p.CredentialVersion = modelID("credential")
		}
		p.UpdatedAt = modelNow()
		for _, m := range r.Models {
			if m.ProviderID == id && !m.Deleted {
				copy := *p
				m.Connection = &copy
			}
		}
		if changed {
			for _, m := range r.Models {
				if m.ProviderID == id && !m.Deleted {
					if err := a.publishModelBindingTx(tx, &r, m); err != nil {
						return err
					}
					m.UpdatedAt = p.UpdatedAt
				}
			}
		}
		if err := saveModelRegistryTx(tx, r); err != nil {
			return err
		}
		if a.modelRegistryFault != nil {
			if err := a.modelRegistryFault("before-head-commit"); err != nil {
				return err
			}
		}
		prepared = true
		view = a.providerView(p)
		return nil
	})
	return view, err
}
func (a *Application) patchManagedModel(ctx context.Context, actor identity.Principal, id string, in contracts.PatchManagedModel) (contracts.ManagedModel, error) {
	var view contracts.ManagedModel
	if err := contracts.Validate("PatchManagedModelSchema", in); err != nil {
		return view, err
	}
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		m := r.Models[id]
		if m == nil || m.Deleted {
			return contracts.NewError("NOT_FOUND", "modelId")
		}
		changed := false
		if in.Model.Present {
			if strings.TrimSpace(in.Model.Value) == "" {
				return contracts.NewError("INVALID_REQUEST", "model")
			}
			for _, other := range r.Models {
				if !other.Deleted && other.ID != id && other.ProviderID == m.ProviderID && other.Model == in.Model.Value {
					return contracts.NewError("CONFLICT", "model")
				}
			}
			changed = m.Model != in.Model.Value
			m.Model = in.Model.Value
		}
		if in.Name.Present {
			if strings.TrimSpace(in.Name.Value) == "" {
				return contracts.NewError("INVALID_REQUEST", "name")
			}
			m.Name = in.Name.Value
		}
		if in.Capabilities.Present {
			raw := in.Capabilities.Value
			if in.Capabilities.Null || string(raw) == "null" {
				raw = nil
			}
			changed = changed || string(m.Capabilities) != string(raw)
			m.Capabilities = append(json.RawMessage(nil), raw...)
		}
		if changed {
			if err := a.publishModelBindingTx(tx, &r, m); err != nil {
				return err
			}
		}
		m.UpdatedAt = modelNow()
		if err := saveModelRegistryTx(tx, r); err != nil {
			return err
		}
		view = a.managedModelView(r, m)
		return nil
	})
	return view, err
}
func modelDeleteDependenciesTx(tx *sql.Tx, r modelRegistry, id string) error {
	refs := []string{}
	for ref, modelID := range r.References {
		if modelID == id {
			refs = append(refs, ref)
		}
	}
	defaults, err := corestore.ReadDefaultWorkTx(tx)
	if err != nil {
		return err
	}
	if defaults.Configuration != nil {
		for _, ref := range refs {
			if string(defaults.Configuration.ModelRef) == ref {
				return contracts.NewError("MODEL_IN_USE", "defaultModel")
			}
		}
	}
	for _, ref := range refs {
		var count int
		err := tx.QueryRow(`SELECT count(*) FROM works w JOIN work_context_snapshots c ON c.work_id=w.id AND (c.snapshot_id=w.active_context_id OR c.snapshot_id=w.desired_context_id) WHERE w.deleted_at IS NULL AND json_extract(c.configuration_json,'$.modelRef')=?`, ref).Scan(&count)
		if err != nil {
			return err
		}
		if count > 0 {
			return contracts.NewError("MODEL_IN_USE", "workConfiguration")
		}
	}
	return nil
}
func (a *Application) modelLifecycle(ctx context.Context, actor identity.Principal, provider bool, id, action string) (any, error) {
	var view any
	err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		if provider {
			p := r.Providers[id]
			if p == nil || p.Deleted {
				return contracts.NewError("NOT_FOUND", "providerId")
			}
			if action == "delete" {
				for _, m := range r.Models {
					if m.ProviderID == id && !m.Deleted {
						return contracts.NewError("MODEL_IN_USE", "models")
					}
				}
				p.Deleted = true
				p.Enabled = false
			} else {
				p.Enabled = action == "enable"
			}
			p.UpdatedAt = modelNow()
			for _, m := range r.Models {
				if m.ProviderID == id && m.Connection != nil {
					m.Connection.Enabled = p.Enabled
					m.Connection.Deleted = p.Deleted
				}
			}
			view = a.providerView(p)
		} else {
			m := r.Models[id]
			if m == nil || m.Deleted {
				return contracts.NewError("NOT_FOUND", "modelId")
			}
			if action == "delete" {
				if err := modelDeleteDependenciesTx(tx, r, id); err != nil {
					return err
				}
				m.Deleted = true
				m.Enabled = false
			} else {
				m.Enabled = action == "enable"
			}
			if action == "enable" {
				modelConnection(r, m).Enabled = true
				modelConnection(r, m).Deleted = false
			}
			m.UpdatedAt = modelNow()
			view = a.managedModelView(r, m)
		}
		return saveModelRegistryTx(tx, r)
	})
	return view, err
}

// Adopt supported current-format runtime entries once, preserving every old
// reference and its enabled flag. Subsequent refreshes never undo user actions.
func (a *Application) adoptRuntimeModels(ctx context.Context) error {
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		rows, err := tx.Query("SELECT id,metadata_json,enabled FROM catalog_entries WHERE kind='model' ORDER BY id")
		if err != nil {
			return err
		}
		type item struct {
			ref      string
			metadata catalogModelMetadata
			enabled  bool
		}
		items := []item{}
		for rows.Next() {
			var ref, raw string
			var enabled bool
			if err := rows.Scan(&ref, &raw, &enabled); err != nil {
				rows.Close()
				return err
			}
			var m catalogModelMetadata
			if strictMetadata([]byte(raw), &m) != nil {
				continue
			}
			if m.Version == 1 && modelAPI(m.Provider) != "" && r.References[ref] == "" {
				items = append(items, item{ref, m, enabled})
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		for _, i := range items {
			p := &managedProvider{ID: modelID("provider"), Name: "Runtime " + i.metadata.Provider + " / " + i.metadata.ID, API: modelAPI(i.metadata.Provider), Enabled: i.enabled, CredentialRef: i.metadata.CredentialRef, CredentialVersion: modelID("credential"), CreatedAt: i.metadata.UpdatedAt, UpdatedAt: i.metadata.UpdatedAt}
			if i.metadata.BaseURL != nil {
				p.BaseURL = *i.metadata.BaseURL
			} else if p.API == "openai-responses" {
				p.BaseURL = "https://api.openai.com/v1"
			} else {
				p.BaseURL = "https://api.anthropic.com"
			}
			r.Providers[p.ID] = p
			m := &managedModel{ID: modelID("managed-model"), ProviderID: p.ID, Name: i.metadata.ID, Model: i.metadata.ID, ModelRef: i.ref, Enabled: i.enabled, CreatedAt: i.metadata.UpdatedAt, UpdatedAt: i.metadata.UpdatedAt}
			copy := *p
			m.Connection = &copy
			r.Models[m.ID] = m
			r.References[i.ref] = m.ID
		}
		if a.modelRegistryFault != nil {
			if err := a.modelRegistryFault("before-registry-migration"); err != nil {
				return err
			}
		}
		return saveModelRegistryTx(tx, r)
	})
}

// Each model owns its mutable connection. Legacy provider IDs remain private
// identity anchors for previously captured immutable execution references.
func modelConnection(r modelRegistry, m *managedModel) *managedProvider {
	if m.Connection != nil {
		return m.Connection
	}
	return r.Providers[m.ProviderID]
}
