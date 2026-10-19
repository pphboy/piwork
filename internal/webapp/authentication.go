package webapp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"piwork/internal/cli"
	"piwork/internal/client"
	"piwork/internal/clientfs"
	"piwork/internal/contracts"
	"piwork/internal/localweb"
)

func (s *Server) pruneLocked() {
	now := time.Now()
	for id, challenge := range s.challenges {
		if !now.Before(challenge.expires) {
			delete(s.challenges, id)
		}
	}
	for id, bucket := range s.failures {
		if now.Sub(bucket.started) >= time.Minute {
			delete(s.failures, id)
		}
	}
}

func (s *Server) serveAuthentication(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.Path
	if path == "/_web/api/state" && r.Method == http.MethodGet {
		hasUsers, err := s.options.Core.Identity.HasUsers(r.Context())
		if err != nil {
			sendError(w, err)
			return true
		}
		webJSON(w, 200, map[string]any{"administratorInitialized": hasUsers})
		return true
	}
	if path == "/_web/api/session" || path == "/_desktop/api/session" || path == "/console/api/session" {
		if r.Method != http.MethodGet {
			webError(w, 405, "METHOD_NOT_ALLOWED")
			return true
		}
		ss, err := s.authenticate(r)
		if err == nil {
			webJSON(w, 200, s.sessionView(ss))
			return true
		}
		if status, _ := contracts.ProjectError(err); status >= 500 {
			sendError(w, err)
			return true
		}
		s.mu.Lock()
		s.pruneLocked()
		id := requestCookie(r, s.challengeCookie)
		ch, ok := s.challenges[id]
		if !ok {
			if len(s.challenges) >= 2048 {
				s.mu.Unlock()
				webError(w, 429, "CONSOLE_CHALLENGE_CAPACITY")
				return true
			}
			var secretErr error
			id, secretErr = localweb.Secret()
			if secretErr == nil {
				ch.csrf, secretErr = localweb.Secret()
			}
			if secretErr != nil {
				s.mu.Unlock()
				webError(w, 503, "CONSOLE_SESSION_UNAVAILABLE")
				return true
			}
			ch.expires = time.Now().Add(10 * time.Minute)
			s.challenges[id] = ch
		}
		s.mu.Unlock()
		s.setCookie(w, s.challengeCookie, id, int(time.Until(ch.expires).Seconds()))
		webJSON(w, 200, map[string]any{"authenticated": false, "state": "signed-out", "mode": "hosted", "csrf": ch.csrf, "csrfToken": ch.csrf, "generation": 0, "coreUrl": s.options.Origin})
		return true
	}
	if path == "/_web/api/login" || path == "/_desktop/api/login" || path == "/console/api/login" {
		if r.Method != http.MethodPost {
			webError(w, 405, "METHOD_NOT_ALLOWED")
			return true
		}
		s.login(w, r)
		return true
	}
	if path == "/_web/api/logout" || path == "/_desktop/api/logout" || path == "/console/api/logout" {
		if r.Method != http.MethodPost {
			webError(w, 405, "METHOD_NOT_ALLOWED")
			return true
		}
		ss, err := s.authenticate(r)
		if err != nil {
			sendError(w, err)
			return true
		}
		if !secretEqual(csrfHeader(r), ss.csrf) {
			webError(w, 403, "CSRF_INVALID")
			return true
		}
		if err := s.api(ss.credential.Token).Logout(r.Context()); err != nil {
			var apiErr *client.APIError
			if !errors.As(err, &apiErr) || apiErr.Status != 401 {
				webError(w, 502, "CORE_UNAVAILABLE")
				return true
			}
		}
		s.removeSession(ss)
		s.setCookie(w, s.cookie, "", -1)
		webJSON(w, 200, map[string]any{"loggedOut": true, "localCleared": true, "remoteRevocationConfirmed": true, "credentialCleared": true,
			"view": map[string]any{"state": "signed-out", "mode": "hosted", "generation": 2, "coreUrl": s.options.Origin}})
		return true
	}
	return false
}

func (s *Server) sessionView(ss *session) map[string]any {
	next := "/"
	if ss.credential.User.Role == "admin" && !s.options.Core.Status().Checks.RuntimeConfigured {
		next = "/admin/setup"
	}
	return map[string]any{"authenticated": true, "state": "authenticated", "mode": "hosted", "user": ss.credential.User,
		"expiresAt": ss.credential.ExpiresAt, "csrf": ss.csrf, "csrfToken": ss.csrf, "generation": 1, "coreUrl": s.options.Origin, "next": next}
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	input, err := contracts.Decode[contracts.WebCredentialsInput](r.Body, "WebCredentialsInputSchema", 4096)
	if err != nil || strings.TrimSpace(input.Account) == "" {
		webError(w, 400, "INVALID_REQUEST")
		return
	}
	account, password := input.Account, input.Password
	id := requestCookie(r, s.challengeCookie)
	source, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		source = r.RemoteAddr
	}
	accountHash := sha256.Sum256([]byte(strings.ToLower(account)))
	keys := []string{"source:" + source, "account:" + hex.EncodeToString(accountHash[:])}
	s.mu.Lock()
	s.pruneLocked()
	ch, ok := s.challenges[id]
	if s.closed || !ok || !secretEqual(csrfHeader(r), ch.csrf) {
		s.mu.Unlock()
		webError(w, 403, "CSRF_INVALID")
		return
	}
	for _, key := range keys {
		bucket := s.failures[key]
		if time.Since(bucket.started) < time.Minute && bucket.count >= 5 {
			remaining := time.Until(bucket.started.Add(time.Minute)).Milliseconds()
			s.mu.Unlock()
			webJSON(w, 429, map[string]any{"code": "RATE_LIMITED", "message": "Too many sign-in attempts. Wait before retrying.", "retryAfterMs": remaining})
			return
		}
	}
	if len(s.failures) >= 4096 {
		s.mu.Unlock()
		webError(w, 429, "RATE_LIMITED")
		return
	}
	if len(s.sessions) >= 1024 {
		s.mu.Unlock()
		webError(w, 503, "CONSOLE_SESSION_CAPACITY")
		return
	}
	// Consume the challenge before expensive authentication to reject replay and
	// concurrent submissions. A failed attempt obtains a fresh challenge by GET.
	delete(s.challenges, id)
	s.mu.Unlock()
	record, err := s.api("").Login(r.Context(), account, password)
	password = ""
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 429 {
			webError(w, 429, "RATE_LIMITED")
			return
		}
		if !errors.As(err, &apiErr) || apiErr.Status == 0 || apiErr.Status >= 500 {
			webError(w, 502, "CORE_UNAVAILABLE")
			return
		}
		s.mu.Lock()
		for _, key := range keys {
			bucket := s.failures[key]
			if time.Since(bucket.started) >= time.Minute {
				bucket = failureBucket{started: time.Now()}
			}
			bucket.count++
			s.failures[key] = bucket
		}
		s.mu.Unlock()
		webError(w, 401, "AUTHENTICATION_FAILED")
		return
	}
	sessionID, secretErr := localweb.Secret()
	csrf, csrfErr := localweb.Secret()
	expiry, expiryErr := time.Parse(time.RFC3339Nano, record.ExpiresAt)
	if secretErr != nil || csrfErr != nil || expiryErr != nil || !expiry.After(time.Now()) {
		_ = s.api(record.Token).Logout(r.Context())
		webError(w, 503, "CONSOLE_SESSION_UNAVAILABLE")
		return
	}
	stateDirectory := filepath.Join(s.options.DataDirectory, "runtime", "browser-sessions", sessionID)
	userHash := sha256.Sum256([]byte(record.User.ID))
	recordDirectory := filepath.Join(s.options.DataDirectory, "runtime", "browser-users", hex.EncodeToString(userHash[:]))
	for _, directory := range []string{stateDirectory, recordDirectory} {
		private, err := clientfs.OpenPrivateDirectory(directory, true)
		if err != nil {
			_ = s.api(record.Token).Logout(r.Context())
			_ = os.RemoveAll(stateDirectory)
			webError(w, 503, "BROWSER_STORAGE_UNAVAILABLE")
			return
		}
		_ = private.Close()
	}
	desktop, err := cli.NewHostedDesktop(cli.HostedDesktopOptions{Origin: s.options.Origin, SessionID: sessionID, CSRF: csrf, CookieName: s.cookie,
		StateDirectory: stateDirectory, RecordDirectory: recordDirectory, Credential: record, Transport: s.transport, Services: s.services})
	if err != nil {
		_ = s.api(record.Token).Logout(r.Context())
		_ = os.RemoveAll(stateDirectory)
		webError(w, 503, "BROWSER_SESSION_UNAVAILABLE")
		return
	}
	ss := &session{id: sessionID, csrf: csrf, credential: record, expires: expiry, desktop: desktop, stateDirectory: stateDirectory}
	watch, cancel, watchErr := s.options.Core.Identity.WatchSession(s.ctx, record.Token)
	if watchErr != nil {
		desktop.Close()
		_ = os.RemoveAll(stateDirectory)
		sendError(w, watchErr)
		return
	}
	ss.cancel = cancel
	s.mu.Lock()
	if s.closed || len(s.sessions) >= 1024 || r.Context().Err() != nil {
		s.mu.Unlock()
		cancel()
		desktop.Close()
		_ = os.RemoveAll(stateDirectory)
		_ = s.api(record.Token).Logout(r.Context())
		webError(w, 503, "CONSOLE_SESSION_CAPACITY")
		return
	}
	previous := s.sessions[requestCookie(r, s.cookie)]
	s.sessions[sessionID] = ss
	s.mu.Unlock()
	context.AfterFunc(watch, func() { s.removeSession(ss) })
	if previous != nil {
		s.removeSession(previous)
		_ = s.api(previous.credential.Token).Logout(r.Context())
	}
	s.setCookie(w, s.challengeCookie, "", -1)
	s.setCookie(w, s.cookie, sessionID, int(time.Until(expiry).Seconds()))
	webJSON(w, 200, s.sessionView(ss))
}

func csrfHeader(r *http.Request) string {
	if value := r.Header.Get("X-Piwork-Csrf"); value != "" {
		return value
	}
	return r.Header.Get("X-Csrf-Token")
}
