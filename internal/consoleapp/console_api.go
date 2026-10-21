package consoleapp

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"piwork/internal/client"
	"piwork/internal/contracts"
	"piwork/internal/localweb"
)

type consoleSession struct {
	token, csrf string
	user        client.Identity
	expiresAt   time.Time
}

func (c *nativeConsole) sameConsoleOrigin(r *http.Request) bool {
	origin := c.hosted.Origin(r)
	if origin == "" || r.Header.Get("Origin") != origin {
		return false
	}
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin" || site == "none"
}

func consoleEqual(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func (c *nativeConsole) activeSession(r *http.Request) (string, consoleSession, bool, error) {
	session, err := c.hosted.Resolve(r)
	return session.ID, consoleSession{token: session.Token, csrf: session.CSRF, user: session.User, expiresAt: session.ExpiresAt}, err == nil && session.User.Role == "admin", err
}

func (c *nativeConsole) serveAPI(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
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
	if path == "/console/api/about" && r.Method == http.MethodGet {
		api, _ := c.client(c.options.coreURL, session.token)
		var value json.RawMessage
		if err := api.Request(r.Context(), "GET", "/api/v1/about", nil, &value); err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && apiErr.Status == 404 {
				consoleFailure(w, 501, "ABOUT_UNSUPPORTED")
			} else {
				consoleFailure(w, 502, "CORE_UNAVAILABLE")
			}
			return
		}
		consoleJSON(w, 200, value)
		return
	}
	if path == "/console/api/health" && r.Method == "GET" {
		api, _ := c.client(c.options.coreURL, "")
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
		case "runtime-defaults":
			return method == "GET"
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
	api, _ := c.client(c.options.coreURL, session.token)
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
	if path == "/runtime" && r.Method == http.MethodPut {
		input, err := contracts.Decode[contracts.WebRuntimeSelectionInput](r.Body, "WebRuntimeSelectionInputSchema", limit)
		if err != nil {
			consoleFailure(w, 400, "INVALID_REQUEST")
			return
		}
		// Core resolves the image at its write boundary. Keep a supplied legacy
		// field for Core to validate, never substitute the Console's defaults.
		var value json.RawMessage
		if err := api.Request(ctx, http.MethodPut, "/api/v1/admin/runtime", contracts.AdminRuntimeSelection{AgentImage: input.AgentImage, ModelRef: input.ModelRef}, &value); err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && (apiErr.Status >= 400 && apiErr.Status < 500 || apiErr.Code == "RELEASE_DEFAULTS_UNAVAILABLE") {
				consoleJSON(w, apiErr.Status, apiErr.Details)
			} else {
				consoleFailure(w, 502, "RUNTIME_RESULT_UNKNOWN")
			}
			return
		}
		consoleJSON(w, 200, value)
		return
	}
	if path == "/default-work" && r.Method == http.MethodPatch {
		input, err := localweb.ReadObject(r, limit)
		if err != nil {
			consoleFailure(w, 400, "INVALID_REQUEST")
			return
		}
		if _, supplied := input["baseImage"]; supplied {
			consoleJSON(w, 400, map[string]string{"code": "INVALID_REQUEST", "field": "agentImage"})
			return
		}
		raw, err := json.Marshal(input)
		if err != nil {
			consoleFailure(w, 400, "INVALID_REQUEST")
			return
		}
		r.Body = io.NopCloser(strings.NewReader(string(raw)))
		r.ContentLength = int64(len(raw))
	}
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
