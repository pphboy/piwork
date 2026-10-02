package cli

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"piwork/internal/client"
)

type desktopIdentity struct {
	coreURL       string
	credential    *client.Credential
	generation    int
	checked       bool
	offline       bool
	errorCode     string
	lastKnown     *client.Identity
	lastConfirmed string
}

func desktopError(w http.ResponseWriter, status int, code string) {
	desktopJSON(w, status, map[string]string{"code": code, "message": code})
}

func desktopJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func (d *nativeDesktop) sameOrigin(r *http.Request) bool {
	if r.Host != fmt.Sprintf("desktop.localhost:%d", d.port) {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != d.origin {
		return false
	}
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	return true
}

func (d *nativeDesktop) cookieName() string { return fmt.Sprintf("__Host-piwork-desktop-%d", d.port) }

func equalDesktopSecret(left, right string) bool {
	return len(left) == len(right) && subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func (d *nativeDesktop) authorize(r *http.Request, mutation bool) (desktopSession, bool) {
	if !d.sameOrigin(r) {
		return desktopSession{}, false
	}
	name := d.cookieName()
	value := ""
	matches := 0
	for _, part := range strings.Split(r.Header.Get("Cookie"), ";") {
		part = strings.TrimSpace(part)
		if strings.HasPrefix(part, name+"=") {
			matches++
			value = strings.TrimPrefix(part, name+"=")
		}
	}
	if matches != 1 {
		return desktopSession{}, false
	}
	d.mu.Lock()
	session, ok := d.sessions[value]
	if ok && !time.Now().Before(session.end) {
		delete(d.sessions, value)
		ok = false
	}
	d.mu.Unlock()
	if !ok || mutation && !equalDesktopSecret(r.Header.Get("X-Piwork-Csrf"), session.csrf) {
		return desktopSession{}, false
	}
	return session, true
}

func readDesktopObject(r *http.Request, limit int64) (map[string]json.RawMessage, error) {
	if r.Header.Get("Content-Type") != "application/json" {
		return nil, errors.New("JSON_REQUIRED")
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > limit {
		return nil, errors.New("REQUEST_TOO_LARGE")
	}
	var value map[string]json.RawMessage
	if json.Unmarshal(raw, &value) != nil || value == nil {
		return nil, errors.New("INVALID_JSON")
	}
	return value, nil
}

func desktopInputError(w http.ResponseWriter, err error) {
	switch err.Error() {
	case "JSON_REQUIRED":
		desktopError(w, 415, "JSON_REQUIRED")
	case "REQUEST_TOO_LARGE":
		desktopError(w, 413, "REQUEST_TOO_LARGE")
	default:
		desktopError(w, 400, "INVALID_JSON")
	}
}

func (d *nativeDesktop) bootstrap(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost || r.Header.Get("Origin") != d.origin || !d.sameOrigin(r) {
		desktopError(w, 403, "LOCAL_BOOTSTRAP_DENIED")
		return
	}
	input, err := readDesktopObject(r, 1024)
	if err != nil {
		desktopInputError(w, err)
		return
	}
	var supplied string
	if json.Unmarshal(input["ticket"], &supplied) != nil {
		desktopError(w, 403, "LOCAL_BOOTSTRAP_DENIED")
		return
	}
	d.mu.Lock()
	if d.used || time.Now().After(d.ticketEnd) || !equalDesktopSecret(supplied, d.ticket) {
		d.mu.Unlock()
		desktopError(w, 403, "LOCAL_BOOTSTRAP_DENIED")
		return
	}
	d.used = true
	sessionID, errID := desktopSecret()
	csrf, errCSRF := desktopSecret()
	if errID != nil || errCSRF != nil {
		d.mu.Unlock()
		desktopError(w, 503, "LOCAL_SESSION_UNAVAILABLE")
		return
	}
	d.sessions[sessionID] = desktopSession{id: sessionID, csrf: csrf, end: time.Now().Add(12 * time.Hour)}
	d.mu.Unlock()
	w.Header().Set("Set-Cookie", fmt.Sprintf("%s=%s; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200", d.cookieName(), sessionID))
	desktopJSON(w, 200, map[string]any{"authorized": true, "csrf": csrf})
}

func (d *nativeDesktop) revokeLocked() {
	if d.transfers != nil {
		d.transfers.revoke(d.identity.credential != nil)
	}
	d.identity.credential = nil
	d.identity.checked = false
	d.identity.offline = false
	d.identity.errorCode = ""
	d.identity.lastKnown = nil
	d.identity.lastConfirmed = ""
	d.identity.generation++
	d.serviceEntries = map[string]*desktopServiceEntry{}
	d.serviceGrants = map[string]string{}
	d.serviceConns = map[string]int{}
}

func (d *nativeDesktop) revokeToken(coreURL, token string) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.identity.credential == nil || d.identity.credential.Token != token || !sameCoreOrigin(d.identity.coreURL, coreURL) {
		return
	}
	d.revokeLocked()
	_ = d.store.ClearSession(coreURL, token)
}

func (d *nativeDesktop) verifyLocked(ctx context.Context) {
	record := d.identity.credential
	if record == nil {
		return
	}
	api, err := client.New(d.identity.coreURL, record.Token)
	if err != nil {
		d.identity.checked = false
		d.identity.offline = true
		d.identity.errorCode = "CORE_UNAVAILABLE"
		return
	}
	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var me client.Identity
	err = api.Request(checkCtx, http.MethodGet, "/api/v1/me", nil, &me)
	if err == nil && me.ID != record.User.ID {
		err = &client.APIError{Status: 401, Code: "IDENTITY_CHANGED", Text: "Core identity changed"}
	}
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && (apiErr.Status == 401 || apiErr.Status == 403) {
			d.revokeLocked()
			_ = d.store.ClearSession(record.CoreURL, record.Token)
			return
		}
		d.identity.checked = false
		d.identity.offline = true
		d.identity.errorCode = "CORE_UNAVAILABLE"
		return
	}
	d.identity.checked = true
	d.identity.offline = false
	d.identity.errorCode = ""
	known := record.User
	d.identity.lastKnown = &known
	d.identity.lastConfirmed = time.Now().UTC().Format(time.RFC3339Nano)
}

func (d *nativeDesktop) view(ctx context.Context, csrf string) map[string]any {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.verifyLocked(ctx)
	state := "signed-out"
	if d.identity.offline {
		state = "offline"
	} else if d.identity.checked && d.identity.credential != nil {
		state = "authenticated"
	}
	value := map[string]any{"coreUrl": d.identity.coreURL, "state": state, "generation": d.identity.generation, "csrf": csrf}
	if state == "authenticated" {
		value["user"] = d.identity.credential.User
		value["expiresAt"] = d.identity.credential.ExpiresAt
	}
	if state == "offline" && d.identity.lastKnown != nil {
		value["lastKnownUser"] = d.identity.lastKnown
		value["lastConfirmedAt"] = d.identity.lastConfirmed
	}
	if d.identity.errorCode != "" {
		value["error"] = d.identity.errorCode
	}
	return value
}

func (d *nativeDesktop) serveAPI(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/_desktop/api/bootstrap" {
		d.bootstrap(w, r)
		return
	}
	if !d.sameOrigin(r) {
		desktopError(w, 403, "LOCAL_ORIGIN_DENIED")
		return
	}
	mutation := r.Method != http.MethodGet
	session, ok := d.authorize(r, mutation)
	if !ok {
		if mutation {
			desktopError(w, 403, "LOCAL_CSRF_OR_AUTH_REQUIRED")
		} else {
			desktopError(w, 401, "LOCAL_AUTH_REQUIRED")
		}
		return
	}
	switch {
	case path == "/_desktop/api/session" && r.Method == http.MethodGet:
		desktopJSON(w, 200, d.view(r.Context(), session.csrf))
	case path == "/_desktop/api/login" && r.Method == http.MethodPost:
		d.login(w, r, session.csrf)
	case path == "/_desktop/api/logout" && r.Method == http.MethodPost:
		d.logout(w, r, session.csrf)
	case path == "/_desktop/api/connection" && r.Method == http.MethodPut:
		d.switchCore(w, r, session.csrf)
	case path == "/_desktop/api/status" && r.Method == http.MethodGet:
		d.status(w, r)
	default:
		if d.serveTransfer(w, r, session) {
			return
		}
		if d.serveServiceEntryAPI(w, r) {
			return
		}
		if d.serveRunEvents(w, r) {
			return
		}
		if d.serveKnownOperations(w, r) {
			return
		}
		if !d.serveControl(w, r) {
			desktopError(w, 501, "DESKTOP_ROUTE_UNAVAILABLE")
		}
	}
}

func (d *nativeDesktop) login(w http.ResponseWriter, r *http.Request, csrf string) {
	input, err := readDesktopObject(r, 1<<20)
	if err != nil {
		desktopInputError(w, err)
		return
	}
	var account, password string
	if json.Unmarshal(input["account"], &account) != nil || json.Unmarshal(input["password"], &password) != nil || strings.TrimSpace(account) == "" || password == "" {
		desktopError(w, 400, "INVALID_LOGIN")
		return
	}
	d.mu.Lock()
	d.revokeLocked()
	coreURL, generation := d.identity.coreURL, d.identity.generation
	d.mu.Unlock()
	api, err := client.New(coreURL, "")
	if err != nil {
		desktopError(w, 400, "INVALID_CORE_URL")
		return
	}
	record, err := api.Login(r.Context(), account, password)
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status >= 400 {
			desktopError(w, apiErr.Status, apiErr.Code)
		} else {
			desktopError(w, 503, "CORE_UNAVAILABLE")
		}
		return
	}
	d.mu.Lock()
	if generation != d.identity.generation {
		d.mu.Unlock()
		if revoke, err := client.New(coreURL, record.Token); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = revoke.Request(ctx, http.MethodPost, "/api/v1/logout", nil, nil)
			cancel()
		}
		desktopError(w, 409, "CONNECTION_CHANGED")
		return
	}
	if err := d.store.Save(record); err != nil {
		d.mu.Unlock()
		if revoke, err := client.New(coreURL, record.Token); err == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_ = revoke.Request(ctx, http.MethodPost, "/api/v1/logout", nil, nil)
			cancel()
		}
		desktopError(w, 503, "CREDENTIAL_STORAGE_UNAVAILABLE")
		return
	}
	d.identity.credential = &record
	d.identity.checked = true
	d.identity.offline = false
	known := record.User
	d.identity.lastKnown = &known
	d.identity.lastConfirmed = time.Now().UTC().Format(time.RFC3339Nano)
	d.mu.Unlock()
	desktopJSON(w, 200, d.view(r.Context(), csrf))
}

func (d *nativeDesktop) logout(w http.ResponseWriter, r *http.Request, csrf string) {
	d.mu.Lock()
	record, coreURL := d.identity.credential, d.identity.coreURL
	d.revokeLocked()
	d.mu.Unlock()
	confirmed := record == nil
	if record != nil {
		if api, err := client.New(coreURL, record.Token); err == nil {
			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			confirmed = api.Request(ctx, http.MethodPost, "/api/v1/logout", nil, nil) == nil
			cancel()
		}
		_ = d.store.ClearSession(record.CoreURL, record.Token)
	}
	desktopJSON(w, 200, map[string]any{"remoteRevocationConfirmed": confirmed, "view": d.view(r.Context(), csrf)})
}

func (d *nativeDesktop) switchCore(w http.ResponseWriter, r *http.Request, csrf string) {
	input, err := readDesktopObject(r, 1<<20)
	if err != nil {
		desktopInputError(w, err)
		return
	}
	var raw string
	if json.Unmarshal(input["coreUrl"], &raw) != nil || len(raw) > 2048 {
		desktopError(w, 400, "INVALID_CORE_URL")
		return
	}
	parsed, err := client.ParseCoreURL(raw)
	if err != nil || parsed.Scheme == "http" && !isLocalCoreHost(parsed.Hostname()) {
		desktopError(w, 400, "INVALID_CORE_URL")
		return
	}
	d.mu.Lock()
	if d.transfers != nil {
		d.transfers.revoke(true)
	}
	d.revokeLocked()
	d.identity.coreURL = parsed.Scheme + "://" + parsed.Host
	if saved, err := d.store.Load(); err == nil && saved != nil && sameCoreOrigin(saved.CoreURL, parsed.String()) {
		d.identity.credential = saved
	}
	d.mu.Unlock()
	desktopJSON(w, 200, d.view(r.Context(), csrf))
}

func (d *nativeDesktop) status(w http.ResponseWriter, r *http.Request) {
	view := d.view(r.Context(), "")
	coreURL, _ := view["coreUrl"].(string)
	anonymous, _ := client.New(coreURL, "")
	check := func(path string) map[string]any {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()
		var value json.RawMessage
		if err := anonymous.Request(ctx, http.MethodGet, path, nil, &value); err != nil {
			return map[string]any{"available": false, "error": "Core is unavailable"}
		}
		return map[string]any{"available": true, "value": value}
	}
	service := map[string]any{"available": false, "reason": "Sign in to check service access"}
	files := map[string]any{"available": false, "reason": "Sign in to check file access"}
	if view["state"] == "authenticated" {
		d.mu.Lock()
		token := ""
		if d.identity.credential != nil && d.identity.checked {
			token = d.identity.credential.Token
		}
		d.mu.Unlock()
		if token != "" {
			api, _ := client.New(coreURL, token)
			var capability struct {
				Protocols []string `json:"protocols"`
			}
			if err := api.Request(r.Context(), http.MethodGet, "/api/v1/service-access", nil, &capability); err == nil {
				available := false
				for _, protocol := range capability.Protocols {
					if protocol == "http" {
						available = true
					}
				}
				service = map[string]any{"available": available, "value": capability}
			}
			var file proxyFileCapability
			if err := api.Request(r.Context(), http.MethodGet, "/api/v1/file-access", nil, &file); err == nil {
				files = map[string]any{"available": file.valid() && file.Available, "value": file}
			}
		}
	}
	desktopJSON(w, 200, map[string]any{"coreUrl": coreURL, "health": check("/healthz"), "readiness": check("/readyz"), "service": service, "files": files, "checkedAt": time.Now().UTC().Format(time.RFC3339Nano)})
}
