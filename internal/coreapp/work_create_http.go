package coreapp

import (
	"encoding/json"
	"net/http"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

type createWorkInput struct {
	Name           contracts.Field[string]                       `json:"name"`
	Configuration  contracts.Field[json.RawMessage]              `json:"configuration"`
	BaseImage      contracts.Field[string]                       `json:"baseImage"`
	Skills         contracts.Field[contracts.SkillSelection]     `json:"skills"`
	Packages       contracts.Field[contracts.PiPackageSelection] `json:"packages"`
	AgentsMd       contracts.Field[string]                       `json:"agentsMd"`
	IdempotencyKey contracts.Field[string]                       `json:"idempotencyKey"`
}

func (a *Application) workCreateHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	if r.URL.EscapedPath() != "/api/v1/works" || r.Method != http.MethodPost {
		return false, nil
	}
	input, err := readJSON[createWorkInput](r)
	if err != nil {
		return true, err
	}
	if !input.Name.Present || input.Name.Null || !input.IdempotencyKey.Present || input.IdempotencyKey.Null {
		return true, contracts.NewError("INVALID_REQUEST", "")
	}
	if input.Configuration.Null || input.BaseImage.Null || input.Skills.Null || input.Packages.Null || input.AgentsMd.Null {
		return true, contracts.NewError("INVALID_REQUEST", "")
	}
	accepted, err := a.createWork(r.Context(), actor, input)
	if err != nil {
		return true, err
	}
	send(w, http.StatusAccepted, accepted)
	return true, nil
}
