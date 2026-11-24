package coreapp

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/skillartifact"
	"piwork/internal/workaccess"
)

// workSkillImport adds one complete local Skill directory to the Work's latest
// desired context. It reuses the existing bounded SKM-004 upload tree and never
// creates or updates a Core catalog entry.
func (a *Application) workSkillImport(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	if r.Method != http.MethodPost {
		return false, nil
	}
	id, matched := workEditorID(r, "/configuration/skills/import")
	if !matched {
		return false, nil
	}
	work, err := workaccess.Work(r.Context(), a.Store, actor, id, workaccess.Content)
	if err != nil {
		return true, err
	}
	if r.ContentLength > skillUploadMaxBody {
		return true, contracts.NewError("SKILL_UPLOAD_LIMIT_EXCEEDED", "")
	}
	if !acquireSkillUploadSlot(a) {
		return true, contracts.NewError("SKILL_UPLOAD_BUSY", "").WithRetryAfter(1000)
	}
	defer a.skillUploads.Add(-1)
	name, files, err := readSkillUploadParts(w, r)
	if err != nil {
		return true, err
	}
	snapshot, err := skillartifact.FromFiles(name, files)
	if err != nil {
		return true, contracts.NewError("SKILL_UPLOAD_INVALID", "")
	}
	imports := map[string]skillartifact.Snapshot{name: snapshot}
	update := func(current contracts.WorkConfig) (contracts.WorkConfig, error) {
		if slices.Contains(current.Skills, contracts.SkillName(name)) {
			return contracts.WorkConfig{}, contracts.NewError("SKILL_ALREADY_EXISTS", "skills")
		}
		config := current
		config.Skills = append(append(contracts.SkillSelection{}, current.Skills...), contracts.SkillName(name))
		return config, nil
	}
	view, err := a.saveBasicWorkConfiguration(r.Context(), actor, work.ID, work.OwnerUserID, false, false, update, nil, imports)
	if err != nil {
		return true, err
	}
	state, err := workSettingsState(work.ID, view)
	if err != nil {
		return true, err
	}
	send(w, http.StatusOK, state)
	return true, nil
}

func workSettingsState(workID string, view contracts.WorkConfigurationView) (contracts.WorkSettingsState, error) {
	active := json.RawMessage("null")
	if len(view.Active) > 0 && string(view.Active) != "null" {
		config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(string(view.Active)), "WorkConfigSchema", 2<<20)
		if err != nil {
			return contracts.WorkSettingsState{}, corestore.ErrStorage
		}
		active, _ = json.Marshal(workSettingsFacts(&config))
	}
	return contracts.WorkSettingsState{
		WorkId:       contracts.ResourceId(workID),
		Desired:      workSettingsFacts(&view.Desired),
		Active:       active,
		PendingApply: view.PendingApply,
	}, nil
}
