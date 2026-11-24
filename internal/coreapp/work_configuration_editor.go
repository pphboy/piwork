package coreapp

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"unicode/utf8"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/identity"
	"piwork/internal/safefs"
	"piwork/internal/workaccess"
	"piwork/internal/workcontext"
)

const (
	editorFileBytes   = 1 << 20
	editorTotalBytes  = 2 << 20
	editorAgentsBytes = 256 << 10
)

func workEditorID(r *http.Request, suffix string) (string, bool) {
	const prefix = "/api/v1/works/"
	path := r.URL.EscapedPath()
	if !strings.HasPrefix(path, prefix) || !strings.HasSuffix(path, suffix) {
		return "", false
	}
	raw := strings.TrimSuffix(strings.TrimPrefix(path, prefix), suffix)
	if raw == "" || strings.Contains(raw, "/") {
		return "", false
	}
	id, err := url.PathUnescape(raw)
	if err != nil || id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\\x00") {
		return "", false
	}
	return id, true
}

func workSettingsFacts(config *contracts.WorkConfig) contracts.WorkSettingsFacts {
	facts := contracts.WorkSettingsFacts{
		Skills:   contracts.WorkSettingsSkillSelection{},
		Packages: contracts.PiPackageSelection{},
		AgentsMd: "",
	}
	if config == nil {
		return facts
	}
	for _, skill := range config.Skills {
		facts.Skills = append(facts.Skills, string(skill))
	}
	facts.Packages = append(facts.Packages, config.Packages...)
	facts.AgentsMd = config.AgentsMd
	return facts
}

func (a *Application) workConfigurationEditorRead(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	if r.Method != http.MethodPost {
		return false, nil
	}
	id, matched := workEditorID(r, "/configuration/editor/read")
	if !matched {
		return false, nil
	}
	work, err := workaccess.Work(r.Context(), a.Store, actor, id, workaccess.Content)
	if err != nil {
		return true, err
	}
	request, err := readControlJSON[contracts.WorkSettingsReadRequest](r, "WorkSettingsReadRequestSchema", false)
	if err != nil {
		return true, err
	}
	state, err := a.Store.Configuration(r.Context(), work.ID)
	if err != nil {
		if err == corestore.ErrNotFound {
			return true, contracts.NewError("NOT_FOUND", "")
		}
		return true, err
	}
	desired, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(state.DesiredConfigJSON), "WorkConfigSchema", 2<<20)
	if err != nil {
		return true, corestore.ErrStorage
	}
	selected := make(map[string]struct{}, len(desired.Skills))
	for _, skill := range desired.Skills {
		selected[string(skill)] = struct{}{}
	}
	files := []contracts.WorkSettingsFileText{}
	listed := []contracts.WorkSettingsSkillFile{}
	total := 0
	wanted := make(map[string]map[string]struct{})
	for _, target := range request.Files.Value {
		if wanted[target.SkillName] == nil {
			wanted[target.SkillName] = make(map[string]struct{})
		}
		if _, duplicate := wanted[target.SkillName][target.Path]; duplicate {
			return true, contracts.NewError("INVALID_REQUEST", "files")
		}
		wanted[target.SkillName][target.Path] = struct{}{}
	}
	cache := make(map[string][]workcontext.SkillFile)
	readSkill := func(name string) ([]workcontext.SkillFile, error) {
		if value, ok := cache[name]; ok {
			return value, nil
		}
		if _, ok := selected[name]; !ok {
			return nil, contracts.NewError("INVALID_REQUEST", "skillName")
		}
		if state.DesiredContextID == nil {
			return nil, corestore.ErrStorage
		}
		value, err := workcontext.ReadSkillFiles(a.Store, a.options.DataDirectory, work.ID, *state.DesiredContextID, name)
		if err != nil {
			return nil, corestore.ErrStorage
		}
		// Retain only explicitly requested text. Binary/supporting trees from
		// each scan are released instead of accumulating across many Skills.
		requested := []workcontext.SkillFile{}
		for _, file := range value {
			editable, reason := editorFileState(file.Data)
			if request.SkillName.Present && request.SkillName.Value == name {
				listed = append(listed, contracts.WorkSettingsSkillFile{
					SkillName: name, Path: file.Path, Size: int64(len(file.Data)), Editable: editable, Reason: editorReason(reason),
				})
			}
			if _, include := wanted[name][file.Path]; !include {
				continue
			}
			if !editable {
				return nil, contracts.NewError("INVALID_REQUEST", "files")
			}
			total += len(file.Data)
			if total > editorTotalBytes {
				return nil, contracts.NewError("INVALID_REQUEST", "files")
			}
			requested = append(requested, file)
		}
		cache[name] = requested
		return requested, nil
	}
	if request.SkillName.Present {
		if _, err := readSkill(request.SkillName.Value); err != nil {
			return true, err
		}
	}
	if request.Files.Present {
		for _, target := range request.Files.Value {
			value, err := readSkill(target.SkillName)
			if err != nil {
				return true, err
			}
			var data []byte
			found := false
			for _, file := range value {
				if file.Path == target.Path {
					data, found = file.Data, true
					break
				}
			}
			if !found {
				return true, contracts.NewError("INVALID_REQUEST", "files")
			}
			files = append(files, contracts.WorkSettingsFileText{SkillName: target.SkillName, Path: target.Path, Text: string(data)})
		}
	}
	active := json.RawMessage("null")
	if state.ActiveConfigJSON != nil {
		config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(*state.ActiveConfigJSON), "WorkConfigSchema", 2<<20)
		if err != nil {
			return true, corestore.ErrStorage
		}
		active, _ = json.Marshal(workSettingsFacts(&config))
	}
	send(w, http.StatusOK, contracts.WorkSettingsReadResponse{
		WorkId:       contracts.ResourceId(work.ID),
		Desired:      workSettingsFacts(&desired),
		Active:       active,
		PendingApply: state.PendingApply,
		SkillFiles:   listed,
		Files:        files,
	})
	return true, nil
}

func editorFileState(data []byte) (bool, string) {
	if len(data) > editorFileBytes {
		return false, "too-large"
	}
	if !utf8.Valid(data) {
		return false, "invalid-utf8"
	}
	if bytes.IndexByte(data, 0) >= 0 {
		return false, "binary"
	}
	return true, ""
}

func editorReason(reason string) json.RawMessage {
	if reason == "" {
		return json.RawMessage("null")
	}
	raw, _ := json.Marshal(reason)
	return raw
}

func (a *Application) workConfigurationEditorSave(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	if r.Method != http.MethodPatch {
		return false, nil
	}
	id, matched := workEditorID(r, "/configuration/editor")
	if !matched {
		return false, nil
	}
	work, err := workaccess.Work(r.Context(), a.Store, actor, id, workaccess.Content)
	if err != nil {
		return true, err
	}
	patch, err := readControlJSON[contracts.WorkSettingsPatch](r, "WorkSettingsPatchSchema", false)
	if err != nil {
		return true, err
	}
	removes, edits, err := validateEditorPatch(patch)
	if err != nil {
		return true, err
	}
	update := func(current contracts.WorkConfig) (contracts.WorkConfig, error) {
		// Only additions absent from this retry's desired need a Core source.
		// The context builder rechecks new captures under the existing lock.
		if len(patch.AddSkills.Value) > 0 {
			if err := a.Store.Read(r.Context(), func(tx *sql.Tx) error {
				for _, name := range patch.AddSkills.Value {
					if slices.Contains(current.Skills, contracts.SkillName(name)) {
						continue
					}
					var enabled bool
					if err := tx.QueryRow(`SELECT enabled FROM catalog_entries WHERE kind='skill' AND name=?`, name).Scan(&enabled); err != nil || !enabled {
						return contracts.NewError("CONFLICT", "skills")
					}
				}
				return nil
			}); err != nil {
				return contracts.WorkConfig{}, err
			}
		}
		return mergeEditorPatch(current, patch, removes)
	}
	view, err := a.saveBasicWorkConfiguration(r.Context(), actor, work.ID, work.OwnerUserID, false, false, update, edits, nil)
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

func validateEditorPatch(patch contracts.WorkSettingsPatch) (map[string]struct{}, []workcontext.SkillEdit, error) {
	addList := []string{}
	if patch.AddSkills.Present {
		addList = append(addList, patch.AddSkills.Value...)
	}
	remove := make(map[string]struct{}, len(patch.RemoveSkills.Value))
	if patch.RemoveSkills.Present {
		for _, name := range patch.RemoveSkills.Value {
			if _, duplicate := remove[name]; duplicate {
				return nil, nil, contracts.NewError("INVALID_REQUEST", "skills")
			}
			remove[name] = struct{}{}
		}
	}
	for _, name := range addList {
		if _, conflict := remove[name]; conflict {
			return nil, nil, contracts.NewError("INVALID_REQUEST", "skills")
		}
	}
	edits := make([]workcontext.SkillEdit, 0, len(patch.SkillFiles.Value))
	seen := make(map[string]struct{}, len(patch.SkillFiles.Value))
	if patch.SkillFiles.Present {
		for _, file := range patch.SkillFiles.Value {
			if _, removed := remove[file.SkillName]; removed {
				return nil, nil, contracts.NewError("INVALID_REQUEST", "skillFiles")
			}
			if !validEditorPath(file.Path) || len(file.Text) > editorFileBytes {
				return nil, nil, contracts.NewError("INVALID_REQUEST", "skillFiles")
			}
			key := file.SkillName + "\x00" + file.Path
			if _, duplicate := seen[key]; duplicate {
				return nil, nil, contracts.NewError("INVALID_REQUEST", "skillFiles")
			}
			seen[key] = struct{}{}
			edits = append(edits, workcontext.SkillEdit{SkillName: file.SkillName, Path: file.Path, Text: file.Text})
		}
	}
	if patch.AgentsMd.Present {
		if patch.AgentsMd.Null || len(patch.AgentsMd.Value) > editorAgentsBytes {
			return nil, nil, contracts.NewError("INVALID_REQUEST", "agentsMd")
		}
	}
	flags := make(map[string]struct{}, len(patch.PackageFlags.Value))
	if patch.PackageFlags.Present {
		for _, flag := range patch.PackageFlags.Value {
			name := string(flag.Name)
			if _, duplicate := flags[name]; duplicate {
				return nil, nil, contracts.NewError("INVALID_REQUEST", "packageFlags")
			}
			flags[name] = struct{}{}
		}
	}
	effective := len(addList) > 0 || len(remove) > 0 || len(edits) > 0 || patch.AgentsMd.Present || len(flags) > 0
	if !effective {
		return nil, nil, contracts.NewError("INVALID_REQUEST", "")
	}
	return remove, edits, nil
}

func validEditorPath(path string) bool {
	if path == "" || strings.HasPrefix(path, "/") || strings.ContainsAny(path, "\\\x00") || !utf8.ValidString(path) {
		return false
	}
	for _, segment := range strings.Split(path, "/") {
		if !safefs.ValidFileName(segment) {
			return false
		}
	}
	return true
}

func mergeEditorPatch(current contracts.WorkConfig, patch contracts.WorkSettingsPatch, remove map[string]struct{}) (contracts.WorkConfig, error) {
	config := current
	config.Skills = append(contracts.SkillSelection{}, current.Skills...)
	config.Packages = append(contracts.PiPackageSelection{}, current.Packages...)
	selected := make(map[string]struct{}, len(config.Skills))
	for _, name := range config.Skills {
		selected[string(name)] = struct{}{}
	}
	if patch.AddSkills.Present {
		for _, raw := range patch.AddSkills.Value {
			if _, exists := selected[raw]; exists {
				continue
			}
			config.Skills = append(config.Skills, contracts.SkillName(raw))
			selected[raw] = struct{}{}
		}
	}
	if len(remove) > 0 {
		kept := make(contracts.SkillSelection, 0, len(config.Skills))
		for _, name := range config.Skills {
			if _, removed := remove[string(name)]; !removed {
				kept = append(kept, name)
			}
		}
		config.Skills = kept
		selected = make(map[string]struct{}, len(kept))
		for _, name := range kept {
			selected[string(name)] = struct{}{}
		}
	}
	if patch.SkillFiles.Present {
		for _, file := range patch.SkillFiles.Value {
			if _, exists := selected[file.SkillName]; !exists {
				return contracts.WorkConfig{}, contracts.NewError("INVALID_REQUEST", "skillFiles")
			}
		}
	}
	if patch.AgentsMd.Present {
		config.AgentsMd = patch.AgentsMd.Value
	}
	if patch.PackageFlags.Present {
		for _, flag := range patch.PackageFlags.Value {
			found := false
			for i := range config.Packages {
				if config.Packages[i].Name == flag.Name {
					config.Packages[i].Enabled = flag.Enabled
					found = true
					break
				}
			}
			if !found {
				return contracts.WorkConfig{}, contracts.NewError("PI_PACKAGE_NOT_INSTALLED", "packageFlags")
			}
		}
	}
	return config, nil
}
