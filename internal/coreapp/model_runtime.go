package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
)

type runtimeModelSelection struct {
	Version        int            `json:"version"`
	SourceRevision int64          `json:"sourceRevision"`
	Profile        RuntimeProfile `json:"profile"`
}

func bindProfileModel(profile *RuntimeProfile, ref string, metadata catalogModelMetadata) {
	profile.ModelRef = ref
	profile.Model.Provider = metadata.Provider
	profile.Model.ID = metadata.ID
	profile.Model.BaseURL = metadata.BaseURL
	profile.Model.CredentialRef = metadata.CredentialRef
	profile.Model.API = metadata.API
	profile.Model.Capabilities = append(json.RawMessage(nil), metadata.Capabilities...)
}
func (a *Application) runtimeSelectionHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal, input contracts.AdminRuntimeSelection, admin bool) error {
	view, err := a.configureRuntimeSelection(r.Context(), actor, input)
	if err != nil {
		return err
	}
	if err := a.ScheduleRuntimeRefresh(); err != nil {
		return err
	}
	if admin {
		send(w, 200, map[string]any{"runtime": adminRuntime(view), "status": adminStatus(a.Status())})
	} else {
		send(w, 200, view)
	}
	return nil
}
func (a *Application) configureRuntimeSelection(ctx context.Context, actor identity.Principal, input contracts.AdminRuntimeSelection) (RuntimeView, error) {
	if err := contracts.Validate("AdminRuntimeSelectionSchema", input); err != nil {
		return RuntimeView{}, err
	}
	a.Settings.mu.Lock()
	defer a.Settings.mu.Unlock()
	current, _, err := a.Settings.LoadRuntime()
	if err != nil {
		return RuntimeView{}, err
	}
	if current.Revision >= contracts.MaxSafeInteger {
		return RuntimeView{}, contracts.NewError("CONFLICT", "")
	}
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.Identity.AuthorizeAdministratorTx(tx, actor); err != nil {
			return err
		}
		base, source, err := a.runtimeSelectionBaseTx(tx)
		if err != nil {
			return err
		}
		if base.Revision >= contracts.MaxSafeInteger {
			return contracts.NewError("CONFLICT", "")
		}
		profile := RuntimeProfile{Version: 1, Revision: base.Revision + 1, AgentImage: input.AgentImage, UpdatedAt: modelNow()}
		metadata, _, _, err := a.catalogModelTx(tx, string(input.ModelRef), true)
		if err != nil {
			return err
		}
		bindProfileModel(&profile, string(input.ModelRef), metadata)
		imageMetadata, _ := json.Marshal(struct {
			Version               int   `json:"version"`
			SourceRuntimeRevision int64 `json:"sourceRuntimeRevision"`
		}{1, profile.Revision})
		_, err = tx.Exec("INSERT INTO catalog_entries(id,kind,name,mutable_reference,resolved_digest,metadata_json,enabled,created_at,updated_at) VALUES(?,'agent_image',?,?,NULL,?,1,?,?)", runtimeImageCatalogID(profile.Revision), fmt.Sprintf("Runtime image revision %d", profile.Revision), profile.AgentImage, string(imageMetadata), profile.UpdatedAt, profile.UpdatedAt)
		if err != nil {
			return err
		}
		raw, err := json.Marshal(runtimeModelSelection{Version: 1, SourceRevision: source, Profile: profile})
		if err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES('runtime_model_selection',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", string(raw), modelNow()); err != nil {
			return err
		}
		return corestore.SyncDefaultWorkRuntimeTx(ctx, tx, profile.Revision, runtimeImageCatalogID(profile.Revision), input.ModelRef, defaultWorkConfiguration(profile))
	})
	if err != nil {
		return RuntimeView{}, err
	}
	a.invalidateRuntimePreparation()
	return a.Settings.RuntimeView()
}

func (a *Application) runtimeSelectionBaseTx(tx *sql.Tx) (RuntimeProfile, int64, error) {
	var profile RuntimeProfile
	raw, err := a.files.Read("runtime-profile.json", 2<<20)
	if err != nil && !corestore.IsMissingPlatformFile(err) {
		return profile, 0, err
	}
	if err == nil && strictMetadata(raw, &profile) != nil {
		return profile, 0, corestore.ErrStorage
	}
	source := profile.Revision
	var selectedRaw string
	err = tx.QueryRow("SELECT value_json FROM control_metadata WHERE key='runtime_model_selection'").Scan(&selectedRaw)
	if err != nil && err != sql.ErrNoRows {
		return profile, source, err
	}
	if err == nil {
		var selected runtimeModelSelection
		if strictMetadata([]byte(selectedRaw), &selected) != nil || selected.Version != 1 {
			return profile, source, corestore.ErrStorage
		}
		if selected.SourceRevision == source {
			profile = selected.Profile
		}
	}
	return profile, source, nil
}

func (a *Application) defaultModelSelectionTx(tx *sql.Tx, ref contracts.ResourceId) error {
	profile, source, err := a.runtimeSelectionBaseTx(tx)
	if err != nil {
		return err
	}
	if profile.Revision < 1 {
		return contracts.NewError("DEFAULT_WORK_NOT_CONFIGURED", "")
	}
	metadata, _, _, err := a.catalogModelTx(tx, string(ref), true)
	if err != nil {
		return err
	}
	bindProfileModel(&profile, string(ref), metadata)
	profile.UpdatedAt = modelNow()
	encoded, err := json.Marshal(runtimeModelSelection{Version: 1, SourceRevision: source, Profile: profile})
	if err != nil {
		return err
	}
	_, err = tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES('runtime_model_selection',?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at", string(encoded), modelNow())
	return err
}
