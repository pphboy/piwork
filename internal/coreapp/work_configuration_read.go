package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/internaltls"
	"piwork/internal/rpc/agentv1"
	"piwork/internal/workaccess"
	"piwork/internal/workcontext"
	"piwork/internal/workruntime"
)

func (a *Application) workConfigurationRead(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	const prefix, suffix = "/api/v1/works/", "/configuration"
	path := r.URL.EscapedPath()
	if r.Method != http.MethodGet || !strings.HasPrefix(path, prefix) {
		return false, nil
	}
	projection := ""
	for _, candidate := range []string{"skills", "packages", "agents"} {
		if strings.HasSuffix(path, suffix+"/"+candidate) {
			projection = candidate
			path = strings.TrimSuffix(path, "/"+candidate)
			break
		}
	}
	if !strings.HasSuffix(path, suffix) {
		return false, nil
	}
	rawID := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if rawID == "" || strings.Contains(rawID, "/") {
		return false, nil
	}
	id, err := url.PathUnescape(rawID)
	if err != nil || id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\\x00") {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	view, err := a.configurationView(r.Context(), actor, id)
	if err != nil {
		return true, err
	}
	var activeConfig *contracts.WorkConfig
	if string(view.Active) != "null" {
		decoded, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(string(view.Active)), "WorkConfigSchema", 2<<20)
		if err != nil {
			return true, corestore.ErrStorage
		}
		activeConfig = &decoded
	}
	if projection == "skills" {
		activeSkills := contracts.SkillSelection{}
		if activeConfig != nil {
			activeSkills = activeConfig.Skills
		}
		send(w, http.StatusOK, map[string]any{"skills": view.Desired.Skills, "active": activeSkills, "pendingApply": view.PendingApply, "runtime": view.Runtime})
		return true, nil
	}
	if projection == "packages" {
		activePackages := contracts.PiPackageSelection{}
		if activeConfig != nil {
			activePackages = activeConfig.Packages
		}
		send(w, http.StatusOK, map[string]any{"packages": view.Desired.Packages, "active": activePackages, "pendingApply": view.PendingApply})
		return true, nil
	}
	if projection == "agents" {
		send(w, http.StatusOK, map[string]any{"agentsMd": view.Desired.AgentsMd})
		return true, nil
	}
	send(w, http.StatusOK, view)
	return true, nil
}

func (a *Application) configurationView(ctx context.Context, actor identity.Principal, id string) (contracts.WorkConfigurationView, error) {
	work, err := workaccess.Work(ctx, a.Store, actor, id, workaccess.Metadata)
	if err != nil {
		return contracts.WorkConfigurationView{}, err
	}
	state, err := a.Store.Configuration(ctx, id)
	if errors.Is(err, corestore.ErrNotFound) {
		return contracts.WorkConfigurationView{}, contracts.NewError("NOT_FOUND", "")
	}
	if err != nil {
		return contracts.WorkConfigurationView{}, err
	}
	desired, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil {
		return contracts.WorkConfigurationView{}, corestore.ErrStorage
	}
	active := json.RawMessage("null")
	var activeConfig *contracts.WorkConfig
	if state.ActiveConfigJSON != nil {
		decoded, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(*state.ActiveConfigJSON), "WorkConfigSchema", 2<<20)
		if err != nil {
			return contracts.WorkConfigurationView{}, corestore.ErrStorage
		}
		activeConfig = &decoded
		active, _ = json.Marshal(decoded)
	}
	runtime := a.currentSkillState(ctx, work, activeConfig)
	return contracts.WorkConfigurationView{WorkId: contracts.ResourceId(id), Active: active, Desired: desired, PendingApply: state.PendingApply, Runtime: runtime}, nil
}

func (a *Application) currentSkillState(ctx context.Context, work corestore.WorkRecord, active *contracts.WorkConfig) contracts.RuntimeSkillState {
	result := contracts.RuntimeSkillState{State: "unavailable", CheckedAt: json.RawMessage("null"), Skills: []contracts.RuntimeSkill{}}
	switch work.ObservedState {
	case "failed":
		result.State = "failed"
		return result
	case "starting", "provisioning":
		result.State = "initializing"
		return result
	case "ready", "degraded":
	default:
		return result
	}
	if work.ActiveContextID == nil || active == nil {
		return result
	}
	var generation int64
	var instanceID, generationState string
	if a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT generation,instance_id,state FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, work.ID).Scan(&generation, &instanceID, &generationState)
	}) != nil || generationState != "ready" || generation < 1 || instanceID == "" {
		return result
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work.ID, Generation: generation, InstanceID: instanceID}
	agent, lifetime, err := a.agentRoutes.Admission(scope, *work.ActiveContextID)
	if err != nil {
		return result
	}
	query, cancel := context.WithCancel(ctx)
	defer cancel()
	stopWatch := context.AfterFunc(lifetime, cancel)
	defer stopWatch()
	readiness, err := agent.ObserveReadiness(query, *work.ActiveContextID)
	checkedAt, _ := json.Marshal(time.Now().UTC().Format(time.RFC3339Nano))
	result.CheckedAt = checkedAt
	if err != nil {
		return result
	}
	metadata, err := workcontext.Metadata(a.Store, work.ID, *work.ActiveContextID)
	if err != nil {
		return result
	}
	return projectRuntimeResources(result, *active, metadata, readiness)
}

func projectRuntimeResources(result contracts.RuntimeSkillState, active contracts.WorkConfig, metadata contracts.WorkContextMetadata, readiness *agentv1.ReadinessResponse) contracts.RuntimeSkillState {
	result.Packages.Present = true
	result.Packages.Value = []struct {
		Name        contracts.PiPackageName `json:"name"`
		Loaded      bool                    `json:"loaded"`
		Diagnostics []string                `json:"diagnostics"`
	}{}
	for _, selected := range active.Packages {
		item := struct {
			Name        contracts.PiPackageName `json:"name"`
			Loaded      bool                    `json:"loaded"`
			Diagnostics []string                `json:"diagnostics"`
		}{Name: selected.Name, Diagnostics: []string{}}
		for _, actual := range readiness.GetLoadedPackages() {
			if actual.GetName() == string(selected.Name) {
				item.Loaded = true
			}
		}
		for _, diagnostic := range readiness.GetPackageDiagnostics() {
			if diagnostic.GetPackageName() == string(selected.Name) && len(item.Diagnostics) < 64 {
				// Never forward arbitrary messages or caller-controlled codes.
				item.Diagnostics = append(item.Diagnostics, "PACKAGE_LOAD_FAILED")
			}
		}
		result.Packages.Value = append(result.Packages.Value, item)
	}
	if readiness.GetDraining() {
		return result
	}
	if !readiness.GetInitializationComplete() || !readiness.GetAcceptingRuns() || workruntime.VerifyResources(readiness, active, metadata) != nil {
		result.State = "failed"
		return result
	}
	for i, skill := range readiness.GetLoadedSkills() {
		if skill.GetName() != string(active.Skills[i]) || !skill.GetLoaded() {
			result.State = "failed"
			result.Skills = []contracts.RuntimeSkill{}
			return result
		}
		reason := json.RawMessage("null")
		if value := skill.GetVisibilityReason(); value != "" {
			if value != "model-invocation-disabled" {
				value = "read-tools-disabled"
			}
			reason, _ = json.Marshal(value)
		}
		result.Skills = append(result.Skills, contracts.RuntimeSkill{Name: contracts.SkillName(skill.GetName()), Loaded: true, ModelVisible: skill.GetModelVisible(), VisibilityReason: reason})
	}
	result.State = "ready"
	return result
}
