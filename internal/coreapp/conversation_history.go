package coreapp

import (
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"net/http"
	"net/url"
	"piwork/internal/agentclient"
	"piwork/internal/contracts"
	"piwork/internal/sessionhistory"
)

func historyRoute(method, resource, item, action string) bool {
	return method == http.MethodGet && (resource == "history-capabilities" && item == "" && action == "" || resource == "sessions" && item != "" && action == "history")
}
func historyCapabilityError(err error) error {
	if status.Code(err) == codes.Unimplemented {
		return contracts.NewError("HISTORY_UNSUPPORTED", "")
	}
	return conversationError(err)
}
func serveHistoryHTTP(w http.ResponseWriter, r *http.Request, agent *agentclient.Client, resource, item string) error {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return contracts.NewError("INVALID_REQUEST", "")
	}
	if resource == "history-capabilities" {
		if len(values) != 0 {
			return contracts.NewError("INVALID_REQUEST", "")
		}
		result, err := agent.HistoryCapabilities(r.Context())
		if err != nil {
			return historyCapabilityError(err)
		}
		if r.Context().Err() != nil {
			return contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
		send(w, 200, result)
		return nil
	}
	query, err := sessionhistory.ParseQuery(values)
	if err != nil {
		return err
	}
	result, err := agent.ReadSessionPage(r.Context(), item, query)
	if err != nil {
		return historyCapabilityError(err)
	}
	if r.Context().Err() != nil {
		return contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	send(w, 200, result)
	return nil
}

// Negotiate the response-only profile before existing route query validation.
func conversationProfile(r *http.Request, agent *agentclient.Client, resource, item string) (*http.Request, *agentclient.Client, error) {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return r, agent, contracts.NewError("INVALID_REQUEST", "")
	}
	profiles, exists := values["responseProfile"]
	if !exists {
		return r, agent, nil
	}
	if len(profiles) != 1 || profiles[0] != contracts.HistoryResponseProfile || resource != "runs" && !(resource == "sessions" && item == "submissions") {
		return r, agent, contracts.NewError("INVALID_REQUEST", "")
	}
	if _, err := agent.HistoryCapabilities(r.Context()); err != nil {
		return r, agent, historyCapabilityError(err)
	}
	values.Del("responseProfile")
	copy := r.Clone(r.Context())
	u := *r.URL
	u.RawQuery = values.Encode()
	copy.URL = &u
	return copy, agent.WithHistoryProfile(), nil
}
