package coreapp

import (
	"context"
	"database/sql"
	"piwork/internal/contracts"
	"piwork/internal/identity"
	"sort"
	"strings"
)

func (a *Application) modelConfigView(r modelRegistry, m *managedModel) contracts.ModelConfig {
	p := modelConnection(r, m)
	v := a.providerView(p)
	return contracts.ModelConfig{Id: contracts.ResourceId(m.ID), Name: m.Name, Api: contracts.ModelApi(p.API), BaseUrl: p.BaseURL, Model: m.Model, ModelRef: contracts.ResourceId(m.ModelRef), Enabled: m.Enabled && p.Enabled && !p.Deleted, CredentialAvailable: v.CredentialAvailable, CreatedAt: contracts.Timestamp(m.CreatedAt), UpdatedAt: contracts.Timestamp(m.UpdatedAt)}
}
func (a *Application) modelConfigViews(ctx context.Context) ([]contracts.ModelConfig, error) {
	views := []contracts.ModelConfig{}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		r, err := modelRegistryTx(tx)
		if err != nil {
			return err
		}
		for _, m := range r.Models {
			if !m.Deleted {
				views = append(views, a.modelConfigView(r, m))
			}
		}
		return nil
	})
	sortModelConfigs(views)
	return views, err
}
func (a *Application) createModelConfig(ctx context.Context, actor identity.Principal, in contracts.CreateModelConfig) (contracts.ModelConfig, error) {
	patch := contracts.PatchModelConfig{Model: contracts.Supplied(in.Model), Api: contracts.Supplied(in.Api), BaseUrl: contracts.Supplied(in.BaseUrl), Credential: contracts.Supplied(in.Credential), Name: in.Name}
	return a.writeModelConfig(ctx, actor, "", patch)
}
func (a *Application) writeModelConfig(ctx context.Context, actor identity.Principal, id string, in contracts.PatchModelConfig) (contracts.ModelConfig, error) {
	var view contracts.ModelConfig
	if err := contracts.Validate("PatchModelConfigSchema", in); err != nil {
		return view, err
	}
	if in.Model.Present && strings.TrimSpace(in.Model.Value) == "" {
		return view, contracts.NewError("INVALID_REQUEST", "model")
	}
	if err := a.Identity.AuthorizeAdministrator(ctx, actor); err != nil {
		return view, err
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
		secret = modelID("model") + ".secret"
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
		m := r.Models[id]
		fresh := id == ""
		if fresh {
			count := 0
			for _, other := range r.Models {
				if !other.Deleted {
					count++
				}
			}
			if count >= 256 {
				return contracts.NewError("CONFLICT", "models")
			}
			if !in.Model.Present || !in.Api.Present || !in.BaseUrl.Present || secret == "" {
				return contracts.NewError("INVALID_REQUEST", "")
			}
			now := modelNow()
			p := &managedProvider{ID: modelID("provider"), Enabled: true, CreatedAt: now, UpdatedAt: now}
			r.Providers[p.ID] = p
			copy := *p
			m = &managedModel{ID: modelID("managed-model"), ProviderID: p.ID, Connection: &copy, Enabled: true, CreatedAt: now, UpdatedAt: now}
			r.Models[m.ID] = m
		} else if m == nil || m.Deleted {
			return contracts.NewError("NOT_FOUND", "modelId")
		}
		p := modelConnection(r, m)
		changed := fresh
		resetCapabilities := false
		if in.Api.Present {
			resetCapabilities = p.API != string(in.Api.Value)
			changed = changed || resetCapabilities
			p.API = string(in.Api.Value)
		}
		base := p.BaseURL
		if in.BaseUrl.Present {
			base = in.BaseUrl.Value
		}
		base, err = validManagedEndpoint(p.API, base)
		if err != nil {
			return err
		}
		changed = changed || p.BaseURL != base
		p.BaseURL = base
		if in.Model.Present {
			resetCapabilities = resetCapabilities || m.Model != in.Model.Value
			changed = changed || m.Model != in.Model.Value
			m.Model = in.Model.Value
		}
		if in.Name.Present {
			m.Name = strings.TrimSpace(in.Name.Value)
		}
		if m.Name == "" {
			m.Name = m.Model
		}
		p.Name = m.Name
		if secret != "" {
			p.CredentialRef = secret
			p.CredentialVersion = modelID("credential")
		}
		// A changed protocol or ID must not inherit an unrelated explicit definition.
		if resetCapabilities && !fresh {
			m.Capabilities = nil
		}
		if changed {
			if err := a.publishModelBindingTx(tx, &r, m); err != nil {
				return err
			}
		}
		if fresh {
			copy := *p
			r.Providers[p.ID] = &copy
		}
		m.UpdatedAt = modelNow()
		p.UpdatedAt = m.UpdatedAt
		if err := saveModelRegistryTx(tx, r); err != nil {
			return err
		}
		if a.modelRegistryFault != nil {
			if err := a.modelRegistryFault("before-head-commit"); err != nil {
				return err
			}
		}
		prepared = true
		view = a.modelConfigView(r, m)
		return nil
	})
	return view, err
}

func sortModelConfigs(v []contracts.ModelConfig) {
	sort.Slice(v, func(i, j int) bool {
		if v[i].Name == v[j].Name {
			return v[i].Id < v[j].Id
		}
		return v[i].Name < v[j].Name
	})
}
