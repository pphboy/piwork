package coreapp

import (
	"net/http"
	"net/url"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/identity"
)

type workActionInput struct {
	IdempotencyKey contracts.Field[string] `json:"idempotencyKey"`
}

// workActionHTTP only accepts the existing user Work action endpoint. The
// coordinator commits the target and Operation before this handler returns.
func (a *Application) workActionHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal) (bool, error) {
	const prefix = "/api/v1/works/"
	if r.Method != http.MethodPost || !strings.HasPrefix(r.URL.EscapedPath(), prefix) {
		return false, nil
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.EscapedPath(), prefix), "/")
	if len(parts) != 2 || parts[0] == "" {
		return false, nil
	}
	action := parts[1]
	if action != "start" && action != "stop" && action != "retry" && action != "delete" {
		return false, nil
	}
	id, err := url.PathUnescape(parts[0])
	if err != nil || id == "" || id == "." || id == ".." || strings.ContainsAny(id, "/\\\x00") {
		return true, contracts.NewError("NOT_FOUND", "")
	}
	input, err := readJSON[workActionInput](r)
	if err != nil {
		return true, err
	}
	if !input.IdempotencyKey.Present || input.IdempotencyKey.Null || input.IdempotencyKey.Value == "" || len(input.IdempotencyKey.Value) > 256 {
		return true, contracts.NewError("INVALID_REQUEST", "")
	}
	accepted, err := a.acceptWorkAction(r.Context(), actor, id, action, input.IdempotencyKey.Value)
	if err != nil {
		return true, err
	}
	send(w, http.StatusAccepted, accepted)
	return true, nil
}
