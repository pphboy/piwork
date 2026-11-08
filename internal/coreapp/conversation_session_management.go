package coreapp

import (
	"net/http"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/agentclient"
	"piwork/internal/contracts"
)

func sessionManagementRoute(method, resource, item, action string) bool {
	return method == http.MethodGet && resource == "session-management-capabilities" && item == "" && action == "" ||
		method == http.MethodGet && resource == "session-management-operations" && item != "" && action != "" ||
		resource == "sessions" && item != "" && (method == http.MethodGet && action == "management" || method == http.MethodPatch && action == "name" || method == http.MethodPost && (action == "delete" || action == "auto-name"))
}

func (a *Application) sessionManagementHTTP(w http.ResponseWriter, r *http.Request, agent *agentclient.Client, workID, resource, item, action string) error {
	if r.URL.RawQuery != "" {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	capabilities, err := agent.SessionManagementCapabilities(r.Context())
	if status.Code(err) == codes.Unimplemented {
		if resource == "session-management-capabilities" {
			send(w, http.StatusOK, map[string]int{"contractVersion": 0})
			return nil
		}
		return contracts.NewError("CHAT_OPTIONS_UNSUPPORTED", "")
	}
	if err != nil {
		return conversationError(err)
	}
	if resource == "session-management-capabilities" {
		send(w, http.StatusOK, capabilities)
		return nil
	}
	if capabilities.ContractVersion != 1 {
		return contracts.NewError("CHAT_OPTIONS_UNSUPPORTED", "")
	}
	var result any
	switch {
	case resource == "session-management-operations":
		if contracts.Validate("ChatSubmissionKeySchema", action) != nil {
			return contracts.NewError("INVALID_REQUEST", "")
		}
		result, err = agent.LookupSessionManagementOperation(r.Context(), item, action)
	case r.Method == http.MethodGet:
		result, err = agent.SessionManagementState(r.Context(), item)
	case r.Method == http.MethodPatch:
		input, readErr := readControlJSON[contracts.RenameSessionInput](r, "RenameSessionInputSchema", false)
		if readErr != nil {
			return readErr
		}
		release, lockErr := a.Store.BeginTransientMutation(r.Context(), workID)
		if lockErr != nil {
			return conversationError(lockErr)
		}
		defer release()
		result, err = agent.RenameSession(r.Context(), item, input)
	case r.Method == http.MethodPost && action == "auto-name":
		input, readErr := readControlJSON[contracts.AutoNameSessionInput](r, "AutoNameSessionInputSchema", false)
		if readErr != nil {
			return readErr
		}
		release, lockErr := a.Store.BeginTransientMutation(r.Context(), workID)
		if lockErr != nil {
			return conversationError(lockErr)
		}
		defer release()
		result, err = agent.AutoNameSession(r.Context(), item, input)
	case r.Method == http.MethodPost:
		input, readErr := readControlJSON[contracts.DeleteSessionInput](r, "DeleteSessionInputSchema", false)
		if readErr != nil {
			return readErr
		}
		release, lockErr := a.Store.BeginTransientMutation(r.Context(), workID)
		if lockErr != nil {
			return conversationError(lockErr)
		}
		defer release()
		result, err = agent.DeleteSession(r.Context(), item, input)
	}
	if err != nil {
		return conversationError(err)
	}
	if r.Context().Err() != nil {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	send(w, http.StatusOK, result)
	return nil
}
