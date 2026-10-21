package webapp

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"

	"piwork/internal/contracts"
)

func secretEqual(a, b string) bool {
	return a != "" && len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func (s *Server) serveSetup(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/_web/api/setup/administrator" {
		webError(w, 404, "NOT_FOUND")
		return
	}
	if r.Method != http.MethodPost {
		webError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	input, err := contracts.Decode[contracts.WebCredentialsInput](r.Body, "WebCredentialsInputSchema", 4096)
	if err != nil {
		webError(w, 400, "INVALID_REQUEST")
		return
	}
	hasUsers, err := s.hasUsers(r.Context())
	if err != nil {
		sendError(w, err)
		return
	}
	if hasUsers {
		webError(w, 409, "SETUP_COMPLETE")
		return
	}
	// First-user creation shares the ordinary sign-in challenge. The identity
	// transaction enforces the empty-user constraint across every bootstrap path.
	s.mu.Lock()
	s.pruneLocked()
	ch, ok := s.challenges[requestCookie(r, s.challengeCookie)]
	valid := !s.closed && ok && secretEqual(csrfHeader(r), ch.csrf)
	s.mu.Unlock()
	if !valid {
		webError(w, 403, "CSRF_INVALID")
		return
	}
	user, err := s.setup.Bootstrap(r.Context(), input.Account, input.Password)
	input.Password = ""
	if err != nil {
		sendError(w, err)
		return
	}
	webJSON(w, 201, map[string]any{"created": true, "account": user.Account, "next": "/login"})
}

func (s *Server) onboarding(w http.ResponseWriter, r *http.Request, ss *session) {
	status, err := s.api("").ControlStatus(r.Context())
	if err != nil {
		sendError(w, err)
		return
	}
	value := map[string]any{"user": ss.credential.User, "status": status.CoreStatus, "administrator": ss.credential.User.Role == "admin"}
	if ss.credential.User.Role == "admin" {
		var runtime json.RawMessage
		api := s.api(ss.credential.Token)
		if err := api.Request(r.Context(), "GET", "/api/v1/admin/runtime", nil, &runtime); err != nil {
			webError(w, 502, "CORE_UNAVAILABLE")
			return
		}
		var defaults contracts.WebRuntimeDefaults
		err := api.Request(r.Context(), "GET", "/api/v1/admin/runtime-defaults", nil, &defaults)
		value["runtime"], value["preparation"] = runtime, status.Preparation
		if err != nil {
			value["releaseError"] = "RELEASE_DEFAULTS_UNAVAILABLE"
		} else {
			value["defaultAgentImage"] = defaults.AgentImage
		}
	}
	webJSON(w, 200, value)
}
