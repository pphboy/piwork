package coreapp

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"piwork/internal/agentclient"
	"piwork/internal/contracts"
)

func feedbackRoute(method, resource, item, action string) bool {
	if resource == "evidence" {
		return method == "GET" && item != "" && action == ""
	}
	if resource != "agent-requests" {
		return false
	}
	return method == "GET" && action == "" || method == "POST" && item != "" && (action == "cancel" || action == "retry")
}
func feedbackQuery(r *http.Request, schema string) ([]byte, error) {
	query := map[string]any{}
	parsed, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, contracts.NewError("INVALID_REQUEST", "")
	}
	for key, values := range parsed {
		if len(values) != 1 || values[0] == "" {
			return nil, contracts.NewError("INVALID_REQUEST", key)
		}
		if key == "limit" {
			n, err := strconv.ParseInt(values[0], 10, 64)
			if err != nil {
				return nil, contracts.NewError("INVALID_REQUEST", key)
			}
			query[key] = n
		} else {
			query[key] = values[0]
		}
	}
	raw, _ := json.Marshal(query)
	value, err := contracts.ParseJSON(strings.NewReader(string(raw)), 4096)
	if err != nil || contracts.Validate(schema, value) != nil {
		return nil, contracts.NewError("INVALID_REQUEST", "")
	}
	return raw, nil
}
func (a *Application) feedbackHTTP(w http.ResponseWriter, r *http.Request, agent *agentclient.Client, workID, resource, item, action string) (bool, error) {
	if r.Method == "GET" {
		if resource == "evidence" {
			if len(r.URL.Query()) != 0 {
				return true, contracts.NewError("INVALID_REQUEST", "")
			}
			value, err := agent.GetAgentEvidence(r.Context(), item)
			if err != nil {
				return true, conversationError(err)
			}
			send(w, 200, value)
			return true, nil
		}
		if item == "" {
			raw, err := feedbackQuery(r, "AgentRequestQuerySchema")
			if err != nil {
				return true, err
			}
			var query contracts.AgentRequestQuery
			_ = json.Unmarshal(raw, &query)
			value, err := agent.ListAgentRequests(r.Context(), query)
			if err != nil {
				return true, conversationError(err)
			}
			send(w, 200, value)
			return true, nil
		}
		raw, err := feedbackQuery(r, "AgentEvidenceQuerySchema")
		if err != nil {
			return true, err
		}
		var query contracts.AgentEvidenceQuery
		_ = json.Unmarshal(raw, &query)
		value, err := agent.GetAgentRequest(r.Context(), item, query)
		if err != nil {
			return true, conversationError(err)
		}
		send(w, 200, value)
		return true, nil
	}
	if len(r.URL.Query()) != 0 {
		return true, contracts.NewError("INVALID_REQUEST", "")
	}
	var retry contracts.RetryAgentRequest
	if action == "retry" {
		input, err := readControlJSON[contracts.RetryAgentRequest](r, "RetryAgentRequestSchema", false)
		if err != nil {
			return true, err
		}
		retry = input
	} else {
		if _, err := readJSON[struct{}](r); err != nil {
			return true, err
		}
	}
	release, err := a.Store.BeginTransientMutation(r.Context(), workID)
	if err != nil {
		return true, conversationError(err)
	}
	defer release()
	var value *contracts.AgentRequest
	if action == "retry" {
		value, err = agent.RetryAgentRequest(r.Context(), item, retry)
	} else {
		value, err = agent.CancelAgentRequest(r.Context(), item)
	}
	if err != nil {
		return true, conversationError(err)
	}
	send(w, 200, value)
	return true, nil
}
