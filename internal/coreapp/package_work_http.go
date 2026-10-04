package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/pipackage"
	"piwork/internal/workaccess"
	"piwork/internal/workcontext"
)

func (a *Application) workPackageHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	const prefix = "/api/v1/works/"
	if !strings.HasPrefix(r.URL.EscapedPath(), prefix) {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), prefix), "/")
	if len(parts) < 2 || len(parts) > 4 || parts[1] != "packages" {
		return false, nil
	}
	workID, err := url.PathUnescape(parts[0])
	if err != nil || !validResourceID(workID) {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	permission := workaccess.Metadata
	if r.Method != http.MethodGet {
		permission = workaccess.Control
	}
	work, err := workaccess.Work(r.Context(), a.Store, actor, workID, permission)
	if err != nil {
		return true, err
	}
	name := ""
	if len(parts) >= 3 {
		name, err = url.PathUnescape(parts[2])
		if err != nil || !pipackage.ValidName(name) {
			return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		}
	}
	if r.Method == http.MethodPost && (len(parts) == 2 || len(parts) == 4 && parts[3] == "update") {
		input, err := readControlJSON[contracts.PiPackageUpdateRequest](r, "PiPackageUpdateRequestSchema", false)
		if err != nil {
			return true, err
		}
		kind := "install"
		if len(parts) == 4 {
			kind = "update"
		}
		accepted, err := a.acceptPackage(r, actor, workID, kind, name, input.Source, input.IdempotencyKey, false)
		if err != nil {
			return true, packagePublicError(err)
		}
		nameJSON := json.RawMessage(`null`)
		if name != "" {
			nameJSON, _ = json.Marshal(name)
		}
		workJSON, _ := json.Marshal(workID)
		send(w, http.StatusAccepted, contracts.PiPackageOperationAcceptance{OperationId: contracts.ResourceId(accepted.OperationID), WorkId: workJSON, CorrelationId: contracts.ResourceId(accepted.OperationID), Reused: accepted.Reused, Scope: "work", Kind: "pi-package-" + kind, Name: nameJSON})
		return true, nil
	}
	if r.Method == http.MethodGet && len(parts) <= 3 {
		entries, err := a.workPackageList(r.Context(), work)
		if err != nil {
			return true, err
		}
		if len(parts) == 2 {
			send(w, 200, map[string]any{"packages": entries})
			return true, nil
		}
		for _, entry := range entries {
			if string(entry.Name) == name {
				send(w, 200, entry)
				return true, nil
			}
		}
		return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
	}
	action := ""
	if r.Method == http.MethodDelete && len(parts) == 3 {
		action = "remove"
	}
	if r.Method == http.MethodPost && len(parts) == 4 && (parts[3] == "enable" || parts[3] == "disable") {
		action = parts[3]
		if err := readEmptyAction(r, false); err != nil {
			return true, err
		}
	}
	if action == "" {
		return false, nil
	}
	if err := a.assertPackageScopeIdle(r.Context(), workID); err != nil {
		return true, err
	}
	state, err := a.Store.Configuration(r.Context(), workID)
	if err != nil {
		return true, err
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil {
		return true, corestore.ErrStorage
	}
	found, noOp := false, false
	for _, entry := range config.Packages {
		if string(entry.Name) == name {
			found = true
			noOp = action != "remove" && entry.Enabled == (action == "enable")
		}
	}
	if !found {
		return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
	}
	if !noOp {
		_, err = a.saveBasicWorkConfiguration(r.Context(), actor, workID, work.OwnerUserID, false, false, func(config contracts.WorkConfig) (contracts.WorkConfig, error) {
			selection := contracts.PiPackageSelection{}
			found := false
			for _, entry := range config.Packages {
				if string(entry.Name) == name {
					found = true
					if action == "remove" {
						continue
					}
					entry.Enabled = action == "enable"
				}
				selection = append(selection, entry)
			}
			if !found {
				return config, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
			}
			config.Packages = selection
			return config, nil
		}, func(tx *sql.Tx) error { return assertPackageScopeIdleTx(tx, workID) })
		if err != nil {
			return true, err
		}
	}
	if action == "remove" {
		send(w, 200, map[string]any{"name": name, "removed": true})
		return true, nil
	}
	entries, err := a.workPackageList(r.Context(), work)
	if err != nil {
		return true, err
	}
	for _, entry := range entries {
		if string(entry.Name) == name {
			send(w, 200, entry)
			return true, nil
		}
	}
	return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
}

func assertPackageScopeIdleTx(tx *sql.Tx, workID string) error {
	var busy bool
	if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM pi_package_jobs WHERE work_id=? AND phase IN ('queued','source','prepare','validate','publish','cleanup-pending'))`, workID).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return contracts.NewError("PI_PACKAGE_BUSY", "")
	}
	return nil
}
func (a *Application) assertPackageScopeIdle(ctx context.Context, workID string) error {
	return a.Store.Read(ctx, func(tx *sql.Tx) error { return assertPackageScopeIdleTx(tx, workID) })
}

func (a *Application) workPackageList(ctx context.Context, work corestore.WorkRecord) ([]contracts.PiPackageWorkEntry, error) {
	state, err := a.Store.Configuration(ctx, work.ID)
	if err != nil {
		return nil, err
	}
	if state.DesiredContextID == nil {
		return nil, contracts.NewError("NOT_FOUND", "")
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil {
		return nil, err
	}
	desired, err := workcontext.Metadata(a.Store, work.ID, *state.DesiredContextID)
	if err != nil {
		return nil, err
	}
	var active contracts.WorkContextMetadata
	var activeConfig contracts.WorkConfig
	if state.ActiveContextID != nil {
		active, err = workcontext.Metadata(a.Store, work.ID, *state.ActiveContextID)
		if err != nil {
			return nil, err
		}
		if state.ActiveConfigJSON == nil {
			return nil, corestore.ErrStorage
		}
		activeConfig, err = contracts.Decode[contracts.WorkConfig](strings.NewReader(*state.ActiveConfigJSON), "WorkConfigSchema", 2<<20)
		if err != nil {
			return nil, err
		}
	}
	ids := []string{}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		rows, err := tx.Query(`SELECT snapshot_id FROM work_context_snapshots WHERE work_id=? ORDER BY created_at,snapshot_id`, work.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				return err
			}
			ids = append(ids, id)
		}
		return rows.Err()
	}); err != nil {
		return nil, err
	}
	names := map[string]bool{}
	for _, id := range ids {
		metadata, err := workcontext.Metadata(a.Store, work.ID, id)
		if err != nil {
			return nil, err
		}
		for _, binding := range metadata.PackageBindings {
			names[binding.Name] = true
		}
	}
	observation := a.currentSkillState(ctx, work, &activeConfig)
	version := func(metadata contracts.WorkContextMetadata, config contracts.WorkConfig, name string) (json.RawMessage, string, bool) {
		for _, entry := range config.Packages {
			if string(entry.Name) != name {
				continue
			}
			for _, binding := range metadata.PackageBindings {
				if binding.Name == name {
					raw, _ := json.Marshal(contracts.PiPackageWorkVersion{Version: binding.Artifact.Version, Enabled: entry.Enabled})
					return raw, string(binding.Artifact.ContentDigest), entry.Enabled
				}
			}
		}
		return json.RawMessage(`null`), "", false
	}
	result := make([]contracts.PiPackageWorkEntry, 0, len(names))
	for name := range names {
		desiredVersion, desiredDigest, desiredEnabled := version(desired, config, name)
		activeVersion, activeDigest, activeEnabled := version(active, activeConfig, name)
		runtime := contracts.PiPackageRuntimeState{Availability: "unavailable", Loaded: json.RawMessage(`null`), Diagnostics: []string{}}
		for _, observed := range observation.Packages.Value {
			if observed.Name == contracts.PiPackageName(name) {
				runtime.Diagnostics = observed.Diagnostics
			}
		}
		if observation.State == "ready" {
			runtime.Availability = "available"
			loaded := false
			for _, observed := range observation.Packages.Value {
				if observed.Name == contracts.PiPackageName(name) {
					loaded = observed.Loaded
				}
			}
			runtime.Loaded, _ = json.Marshal(loaded)
		}
		entry := contracts.PiPackageWorkEntry{Name: contracts.PiPackageName(name), Desired: desiredVersion, Active: activeVersion, PendingApply: desiredDigest != activeDigest || desiredEnabled != activeEnabled, Runtime: runtime}
		if name == brainPackageName {
			if err := a.projectBrainCandidate(ctx, work, desiredDigest, activeDigest, desiredEnabled, activeEnabled, &entry); err != nil {
				return nil, err
			}
		}
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result, nil
}
