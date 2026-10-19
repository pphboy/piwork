package webapp

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/localweb"
)

func secretEqual(a, b string) bool {
	return a != "" && len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func (s *Server) invalidateSetupLocked() {
	s.proofHash = [32]byte{}
	s.proofEnd = time.Time{}
	s.proofUsed = true
	s.setupSessions = map[string]challenge{}
}

// SetupLink is installer-only output. Only its hash is retained by the server.
func (s *Server) SetupLink(ctx context.Context) (string, error) {
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	hasUsers, err := s.options.Core.Identity.HasUsers(ctx)
	if err != nil {
		return "", err
	}
	if hasUsers {
		s.invalidateSetupLocked()
		return "", errors.New("first-user setup is already complete")
	}
	proof, err := localweb.Secret()
	if err != nil {
		return "", err
	}
	s.proofHash = sha256.Sum256([]byte(proof))
	s.proofEnd = time.Now().Add(10 * time.Minute)
	s.proofUsed = false
	s.setupSessions = map[string]challenge{}
	return s.options.Origin + "/setup#setup=" + proof, nil
}

func (s *Server) operatorSetupLink(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		webError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Operator ") || !s.options.Core.Settings.VerifyOperator(r.Context(), strings.TrimPrefix(values[0], "Operator ")) {
		webError(w, 401, "OPERATOR_AUTHENTICATION_REQUIRED")
		return
	}
	link, err := s.SetupLink(r.Context())
	if err != nil {
		webError(w, 409, "SETUP_UNAVAILABLE")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	webJSON(w, 200, map[string]string{"url": link})
}

func (s *Server) serveSetup(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/_web/api/setup/session" && r.Method == http.MethodGet {
		s.setupMu.Lock()
		defer s.setupMu.Unlock()
		hasUsers, err := s.options.Core.Identity.HasUsers(r.Context())
		if err != nil {
			sendError(w, err)
			return
		}
		if hasUsers {
			s.invalidateSetupLocked()
			webJSON(w, 200, map[string]any{"authorized": false, "complete": true})
			return
		}
		ch, ok := s.setupSessions[requestCookie(r, s.setupCookie)]
		if !ok || !time.Now().Before(ch.expires) {
			webJSON(w, 200, map[string]any{"authorized": false})
			return
		}
		webJSON(w, 200, map[string]any{"authorized": true, "csrfToken": ch.csrf})
		return
	}
	if r.Method != http.MethodPost {
		webError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	var proof, account, password string
	if r.URL.Path == "/_web/api/setup/redeem" {
		input, err := contracts.Decode[contracts.WebSetupProofInput](r.Body, "WebSetupProofInputSchema", 4096)
		if err != nil {
			webError(w, 403, "SETUP_AUTHORIZATION_INVALID")
			return
		}
		proof = input.Proof
	} else {
		input, err := contracts.Decode[contracts.WebCredentialsInput](r.Body, "WebCredentialsInputSchema", 4096)
		if err != nil {
			webError(w, 400, "INVALID_REQUEST")
			return
		}
		account, password = input.Account, input.Password
	}
	s.setupMu.Lock()
	defer s.setupMu.Unlock()
	hasUsers, err := s.options.Core.Identity.HasUsers(r.Context())
	if err != nil {
		sendError(w, err)
		return
	}
	if hasUsers {
		s.invalidateSetupLocked()
		webError(w, 409, "SETUP_COMPLETE")
		return
	}
	now := time.Now()
	for id, ch := range s.setupSessions {
		if !now.Before(ch.expires) {
			delete(s.setupSessions, id)
		}
	}
	if r.URL.Path == "/_web/api/setup/redeem" {
		hash := sha256.Sum256([]byte(proof))
		if s.proofUsed || !now.Before(s.proofEnd) || subtle.ConstantTimeCompare(hash[:], s.proofHash[:]) != 1 {
			webError(w, 403, "SETUP_AUTHORIZATION_INVALID")
			return
		}
		if len(s.setupSessions) >= 128 {
			webError(w, 503, "SETUP_SESSION_CAPACITY")
			return
		}
		id, errID := localweb.Secret()
		csrf, errCSRF := localweb.Secret()
		if errID != nil || errCSRF != nil {
			webError(w, 503, "SETUP_SESSION_UNAVAILABLE")
			return
		}
		s.proofUsed = true
		s.proofHash = [32]byte{}
		s.setupSessions[id] = challenge{csrf: csrf, expires: s.proofEnd}
		s.setCookie(w, s.setupCookie, id, int(time.Until(s.proofEnd).Seconds()))
		webJSON(w, 200, map[string]any{"authorized": true, "csrfToken": csrf})
		return
	}
	ch, ok := s.setupSessions[requestCookie(r, s.setupCookie)]
	if !ok || !now.Before(ch.expires) || !secretEqual(csrfHeader(r), ch.csrf) {
		webError(w, 403, "SETUP_AUTHORIZATION_INVALID")
		return
	}
	if r.URL.Path != "/_web/api/setup/administrator" {
		webError(w, 404, "NOT_FOUND")
		return
	}
	user, err := s.options.Core.Identity.Bootstrap(r.Context(), account, password)
	password = ""
	if err != nil {
		sendError(w, err)
		return
	}
	s.invalidateSetupLocked()
	s.setCookie(w, s.setupCookie, "", -1)
	_ = s.options.Core.ScheduleRuntimeRefresh()
	webJSON(w, 201, map[string]any{"created": true, "account": user.Account, "next": "/login"})
}

func (s *Server) onboarding(w http.ResponseWriter, r *http.Request, ss *session) {
	status := s.options.Core.Status()
	value := map[string]any{"user": ss.credential.User, "status": status, "administrator": ss.credential.User.Role == "admin"}
	if ss.credential.User.Role == "admin" {
		var runtime json.RawMessage
		api := s.api(ss.credential.Token)
		if err := api.Request(r.Context(), "GET", "/api/v1/admin/runtime", nil, &runtime); err != nil {
			webError(w, 502, "CORE_UNAVAILABLE")
			return
		}
		defaults, err := s.options.Core.RuntimeDefaults()
		value["runtime"], value["preparation"] = runtime, s.options.Core.Preparation()
		if err != nil {
			value["releaseError"] = "RELEASE_DEFAULTS_UNAVAILABLE"
		} else {
			value["defaultAgentImage"] = defaults.AgentImage
		}
	}
	webJSON(w, 200, value)
}
