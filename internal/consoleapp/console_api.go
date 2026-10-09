package consoleapp

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"piwork/internal/client"
	"piwork/internal/localweb"
)

type consoleSession struct {
	token, csrf string
	user        client.Identity
	expiresAt   time.Time
}

type consoleChallenge struct {
	csrf      string
	expiresAt time.Time
}

type consoleFailureBucket struct {
	started time.Time
	count   int
}

const consoleLoginCookie = "__Host-piwork-login"
const consoleSessionCookie = "__Host-piwork-console"

func consoleCookie(r *http.Request, name string) string {
	value := ""
	count := 0
	for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, name+"=") {
			value = strings.TrimPrefix(part, name+"=")
			count++
		}
	}
	if count != 1 {
		return ""
	}
	return value
}

func consoleSetCookie(w http.ResponseWriter, name, value string, seconds int) {
	w.Header().Add("Set-Cookie", name+"="+value+"; Path=/; Max-Age="+strconv.Itoa(seconds)+"; Secure; HttpOnly; SameSite=Strict")
}

func (c *nativeConsole) ensureStateLocked() {
	if c.sessions == nil {
		c.sessions = map[string]consoleSession{}
	}
	if c.challenges == nil {
		c.challenges = map[string]consoleChallenge{}
	}
	if c.failures == nil {
		c.failures = map[string]consoleFailureBucket{}
	}
	now := time.Now()
	for id, session := range c.sessions {
		if !now.Before(session.expiresAt) {
			delete(c.sessions, id)
		}
	}
	for id, challenge := range c.challenges {
		if !now.Before(challenge.expiresAt) {
			delete(c.challenges, id)
		}
	}
	for key, failure := range c.failures {
		if now.Sub(failure.started) >= time.Minute {
			delete(c.failures, key)
		}
	}
}

func (c *nativeConsole) sameConsoleOrigin(r *http.Request) bool {
	if r.Header.Get("Origin") != c.options.publicOrigin {
		return false
	}
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin" || site == "none"
}

func consoleEqual(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func (c *nativeConsole) activeSession(r *http.Request) (string, consoleSession, bool, error) {
	id := consoleCookie(r, consoleSessionCookie)
	c.mu.Lock()
	c.ensureStateLocked()
	session, ok := c.sessions[id]
	if ok && !time.Now().Before(session.expiresAt) {
		delete(c.sessions, id)
		ok = false
	}
	c.mu.Unlock()
	if !ok || id == "" {
		return "", consoleSession{}, false, nil
	}
	api, err := client.New(c.options.coreURL, session.token)
	if err != nil {
		return "", consoleSession{}, false, err
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	var user client.Identity
	if err := api.Request(ctx, "GET", "/api/v1/me", nil, &user); err != nil || user.ID != session.user.ID || user.Role != "admin" {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && (apiErr.Status == 401 || apiErr.Status == 403) || err == nil && (user.ID != session.user.ID || user.Role != "admin") {
			c.mu.Lock()
			delete(c.sessions, id)
			c.mu.Unlock()
		}
		if err != nil && !(errors.As(err, &apiErr) && (apiErr.Status == 401 || apiErr.Status == 403)) {
			return "", consoleSession{}, false, err
		}
		return "", consoleSession{}, false, nil
	}
	return id, session, true, nil
}

func (c *nativeConsole) serveAPI(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/console/api/availability" && r.Method == "GET" {
		api, _ := client.New(c.options.coreURL, "")
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		response, err := api.Binary(ctx, "GET", "/readyz", nil, nil, -1)
		if err != nil {
			consoleJSON(w, 200, map[string]any{"reachable": false, "administratorInitialized": nil})
			return
		}
		defer response.Body.Close()
		var value struct {
			Checks struct {
				Administrator bool `json:"administrator"`
			} `json:"checks"`
		}
		_ = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&value)
		consoleJSON(w, 200, map[string]any{"reachable": true, "administratorInitialized": value.Checks.Administrator})
		return
	}
	if path == "/console/api/session" && r.Method == "GET" {
		_, session, ok, err := c.activeSession(r)
		if err != nil {
			consoleFailure(w, 502, "CORE_UNAVAILABLE")
			return
		}
		if ok {
			consoleJSON(w, 200, map[string]any{"authenticated": true, "user": session.user,
				"expiresAt": session.expiresAt.UTC().Format(time.RFC3339), "csrfToken": session.csrf})
			return
		}
		c.mu.Lock()
		c.ensureStateLocked()
		if len(c.challenges) >= 2048 {
			c.mu.Unlock()
			consoleFailure(w, 429, "CONSOLE_CHALLENGE_CAPACITY")
			return
		}
		id, errID := localweb.Secret()
		csrf, errCSRF := localweb.Secret()
		if errID != nil || errCSRF != nil {
			c.mu.Unlock()
			consoleFailure(w, 503, "CONSOLE_SESSION_UNAVAILABLE")
			return
		}
		c.challenges[id] = consoleChallenge{csrf: csrf, expiresAt: time.Now().Add(10 * time.Minute)}
		c.mu.Unlock()
		consoleSetCookie(w, consoleLoginCookie, id, 600)
		consoleJSON(w, 200, map[string]any{"authenticated": false, "csrfToken": csrf})
		return
	}
	if path == "/console/api/login" && r.Method == "POST" {
		c.login(w, r)
		return
	}
	id, session, ok, err := c.activeSession(r)
	if err != nil {
		consoleFailure(w, 502, "CORE_UNAVAILABLE")
		return
	}
	if !ok {
		consoleFailure(w, 401, "AUTHENTICATION_REQUIRED")
		return
	}
	if r.Method != "GET" && (!c.sameConsoleOrigin(r) || !consoleEqual(r.Header.Get("X-Csrf-Token"), session.csrf)) {
		consoleFailure(w, 403, "CSRF_INVALID")
		return
	}
	if path == "/console/api/logout" && r.Method == "POST" {
		api, _ := client.New(c.options.coreURL, session.token)
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		err := api.Request(ctx, "POST", "/api/v1/logout", nil, nil)
		cancel()
		var apiErr *client.APIError
		if err != nil && (!errors.As(err, &apiErr) || apiErr.Status != 401) {
			consoleFailure(w, 502, "CORE_UNAVAILABLE")
			return
		}
		c.mu.Lock()
		delete(c.sessions, id)
		c.mu.Unlock()
		consoleSetCookie(w, consoleSessionCookie, "", 0)
		consoleJSON(w, 200, map[string]bool{"loggedOut": true})
		return
	}
	if path == "/console/api/health" && r.Method == "GET" {
		api, _ := client.New(c.options.coreURL, "")
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		response, err := api.Binary(ctx, "GET", "/healthz", nil, nil, -1)
		cancel()
		if err != nil {
			consoleFailure(w, 502, "CORE_UNAVAILABLE")
			return
		}
		response.Body.Close()
		consoleJSON(w, 200, map[string]bool{"healthy": response.StatusCode == 200})
		return
	}
	if r.Method == "POST" && (path == "/console/api/package-inputs/zip" || path == "/console/api/package-inputs/directory") {
		c.uploadPackage(w, r, id, session, strings.TrimPrefix(path, "/console/api/package-inputs/"))
		return
	}
	if strings.HasPrefix(path, "/console/api/admin/") {
		c.admin(w, r, id, session)
		return
	}
	consoleFailure(w, 404, "NOT_FOUND")
}

func (c *nativeConsole) login(w http.ResponseWriter, r *http.Request) {
	if !c.sameConsoleOrigin(r) {
		consoleFailure(w, 403, "ORIGIN_INVALID")
		return
	}
	id := consoleCookie(r, consoleLoginCookie)
	c.mu.Lock()
	c.ensureStateLocked()
	challenge, ok := c.challenges[id]
	c.mu.Unlock()
	if !ok || id == "" || !time.Now().Before(challenge.expiresAt) || !consoleEqual(r.Header.Get("X-Csrf-Token"), challenge.csrf) {
		consoleFailure(w, 403, "CSRF_INVALID")
		return
	}
	input, err := localweb.ReadObject(r, 1<<20)
	if err != nil {
		consoleFailure(w, 400, "INVALID_REQUEST")
		return
	}
	var account, password string
	if json.Unmarshal(input["account"], &account) != nil || json.Unmarshal(input["password"], &password) != nil || strings.TrimSpace(account) == "" || password == "" {
		consoleFailure(w, 400, "INVALID_REQUEST")
		return
	}
	keys := []string{"source:" + r.RemoteAddr, "account:" + strings.ToLower(account)}
	c.mu.Lock()
	for _, key := range keys {
		bucket := c.failures[key]
		if time.Since(bucket.started) < time.Minute && bucket.count >= 5 {
			c.mu.Unlock()
			consoleFailure(w, 429, "RATE_LIMITED")
			return
		}
	}
	c.mu.Unlock()
	api, err := client.New(c.options.coreURL, "")
	if err != nil {
		consoleFailure(w, 502, "CORE_UNAVAILABLE")
		return
	}
	record, err := api.Login(r.Context(), account, password)
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) {
			if apiErr.Status == 429 {
				consoleFailure(w, 429, "RATE_LIMITED")
				return
			}
			if apiErr.Status == 0 || apiErr.Status >= 500 {
				consoleFailure(w, 502, "CORE_UNAVAILABLE")
				return
			}
		}
		c.mu.Lock()
		for _, key := range keys {
			bucket := c.failures[key]
			if time.Since(bucket.started) >= time.Minute {
				bucket = consoleFailureBucket{started: time.Now()}
			}
			bucket.count++
			c.failures[key] = bucket
		}
		c.mu.Unlock()
		consoleFailure(w, 401, "AUTHENTICATION_FAILED")
		return
	}
	authenticated, _ := client.New(c.options.coreURL, record.Token)
	if record.User.Role != "admin" {
		_ = authenticated.Request(r.Context(), "POST", "/api/v1/logout", nil, nil)
		consoleFailure(w, 403, "ADMIN_ONLY")
		return
	}
	var status struct {
		AdminAPIVersion int `json:"adminApiVersion"`
	}
	if err := authenticated.Request(r.Context(), "GET", "/api/v1/admin/status", nil, &status); err != nil || status.AdminAPIVersion != 1 {
		_ = authenticated.Request(r.Context(), "POST", "/api/v1/logout", nil, nil)
		consoleFailure(w, 503, "CORE_ADMIN_API_UNAVAILABLE")
		return
	}
	expiry, err := time.Parse(time.RFC3339Nano, record.ExpiresAt)
	if err != nil || !time.Now().Before(expiry) {
		consoleFailure(w, 502, "CORE_INVALID_RESPONSE")
		return
	}
	sessionID, errID := localweb.Secret()
	csrf, errCSRF := localweb.Secret()
	if errID != nil || errCSRF != nil {
		consoleFailure(w, 503, "CONSOLE_SESSION_UNAVAILABLE")
		return
	}
	c.mu.Lock()
	if len(c.sessions) >= 1024 {
		c.mu.Unlock()
		_ = authenticated.Request(r.Context(), "POST", "/api/v1/logout", nil, nil)
		consoleFailure(w, 503, "CONSOLE_SESSION_CAPACITY")
		return
	}
	session := consoleSession{token: record.Token, csrf: csrf, user: record.User, expiresAt: expiry}
	c.sessions[sessionID] = session
	delete(c.challenges, id)
	for _, key := range keys {
		delete(c.failures, key)
	}
	c.mu.Unlock()
	consoleSetCookie(w, consoleLoginCookie, "", 0)
	consoleSetCookie(w, consoleSessionCookie, sessionID, int(time.Until(expiry).Seconds()))
	consoleJSON(w, 200, map[string]any{"authenticated": true, "user": record.User,
		"expiresAt": expiry.UTC().Format(time.RFC3339), "csrfToken": csrf})
}

func consoleAllowedAdmin(method, path string) bool {
	parts := strings.Split(strings.TrimPrefix(path, "/"), "/")
	if len(parts) > 1 {
		name, err := url.PathUnescape(parts[1])
		if err != nil {
			return false
		}
		pattern := localweb.IDPattern
		if parts[0] == "skills" || parts[0] == "packages" {
			pattern = localweb.NamePattern
		}
		if !pattern.MatchString(name) {
			return false
		}
	}
	if len(parts) == 1 {
		switch parts[0] {
		case "model-providers":
			return method == "GET" || method == "POST"
		case "models":
			return method == "GET" || method == "POST"
		case "model-tests":
			return method == "POST"
		case "status":
			return method == "GET"
		case "users", "skills", "packages":
			return method == "GET" || method == "POST"
		case "runtime":
			return method == "GET" || method == "PUT"
		case "default-work":
			return method == "GET" || method == "PATCH"
		}
	}
	if len(parts) == 2 {
		switch parts[0] {
		case "model-providers", "models":
			return method == "GET" || method == "PATCH" || method == "DELETE"
		case "skills":
			return method == "GET" || method == "PUT" || method == "DELETE"
		case "packages":
			return method == "GET" || method == "DELETE"
		case "operations":
			return method == "GET"
		}
	}
	if len(parts) == 3 && method == "POST" {
		switch parts[0] {
		case "model-providers":
			return parts[2] == "models" || parts[2] == "enable" || parts[2] == "disable"
		case "models":
			return parts[2] == "enable" || parts[2] == "disable"
		case "users":
			return parts[2] == "enable" || parts[2] == "disable" || parts[2] == "reset-credential"
		case "skills":
			return parts[2] == "enable" || parts[2] == "disable"
		case "packages":
			return parts[2] == "enable" || parts[2] == "disable" || parts[2] == "update"
		}
	}
	return false
}

func (c *nativeConsole) admin(w http.ResponseWriter, r *http.Request, sessionID string, session consoleSession) {
	path := strings.TrimPrefix(r.URL.EscapedPath(), "/console/api/admin")
	if !consoleAllowedAdmin(r.Method, path) {
		consoleFailure(w, 404, "NOT_FOUND")
		return
	}
	api, _ := client.New(c.options.coreURL, session.token)
	multipart := strings.HasPrefix(path, "/skills") && (r.Method == "POST" && path == "/skills" || r.Method == "PUT")
	limit := int64(2 << 20)
	timeout := 120 * time.Second
	if multipart {
		limit = 64 << 20
		timeout = 30 * time.Minute
		if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
			consoleFailure(w, 415, "UNSUPPORTED_MEDIA_TYPE")
			return
		}
	}
	if r.ContentLength > limit {
		consoleFailure(w, 413, "REQUEST_TOO_LARGE")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	var body io.Reader
	if r.Method != "GET" && r.Method != "DELETE" {
		body = io.LimitReader(r.Body, limit+1)
	}
	headers := make(http.Header)
	if body != nil {
		headers.Set("Content-Type", r.Header.Get("Content-Type"))
	}
	response, err := api.Binary(ctx, r.Method, "/api/v1/admin"+path, headers, body, r.ContentLength)
	if err != nil {
		consoleFailure(w, 502, "CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	if response.StatusCode == 401 || response.StatusCode == 403 {
		c.mu.Lock()
		delete(c.sessions, sessionID)
		c.mu.Unlock()
		consoleSetCookie(w, consoleSessionCookie, "", 0)
	}
	if response.StatusCode == 204 {
		w.WriteHeader(204)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err != nil || len(raw) > 1<<20 || !json.Valid(raw) {
		consoleFailure(w, 502, "CORE_INVALID_RESPONSE")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(raw)
}
