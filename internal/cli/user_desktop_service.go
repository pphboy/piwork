package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"piwork/internal/client"
)

const desktopServiceReserved = "/.well-known/piwork-local/"

var desktopServiceHostPattern = regexp.MustCompile(`^s-([a-f0-9]{36})\.desktop\.localhost:([0-9]+)$`)

type desktopServiceEntry struct {
	id, workID, serviceID, hostname, sessionID string
	port                                       int
	generation                                 int
	ticket                                     string
	ticketEnd                                  time.Time
	grant                                      string
	embed                                      string
}

func (d *nativeDesktop) serveServiceOrigin(w http.ResponseWriter, r *http.Request) bool {
	entry, ok := d.serviceEntryFromHost(r.Host)
	if !ok {
		return false
	}
	origin := d.serviceOrigin(entry)
	path := r.URL.EscapedPath()
	if path == desktopServiceReserved+"enter" && r.Method == http.MethodGet {
		content := `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Opening Service</title></head><body><p>Opening Service…</p><script type="module" src="` + desktopServiceReserved + `entry.js"></script></body></html>`
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors "+d.origin)
		_, _ = io.WriteString(w, content)
		return true
	}
	if path == desktopServiceReserved+"entry.js" && r.Method == http.MethodGet {
		script := `const ticket=new URLSearchParams(location.hash.slice(1)).get('ticket');history.replaceState(null,'',location.pathname);fetch('` + desktopServiceReserved + `redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ticket})}).then(r=>{if(!r.ok)throw Error('Open this Service from its Work.');location.replace('/')}).catch(e=>{document.body.textContent=e.message});`
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		_, _ = io.WriteString(w, script)
		return true
	}
	if path == desktopServiceReserved+"redeem" && r.Method == http.MethodPost {
		if r.Header.Get("Origin") != origin || r.Header.Get("Content-Type") != "application/json" ||
			r.Header.Get("Sec-Fetch-Site") != "" && r.Header.Get("Sec-Fetch-Site") != "same-origin" {
			desktopError(w, 403, "LOCAL_ENTRY_DENIED")
			return true
		}
		input, err := readDesktopObject(r, 1024)
		if err != nil {
			desktopInputError(w, err)
			return true
		}
		var ticket string
		if json.Unmarshal(input["ticket"], &ticket) != nil {
			desktopError(w, 403, "LOCAL_ENTRY_DENIED")
			return true
		}
		d.mu.Lock()
		current := d.serviceEntries[entry.id]
		session, live := d.sessions[entry.sessionID]
		valid := current != nil && current.ticket != "" && consoleEqual(current.ticket, ticket) &&
			time.Now().Before(current.ticketEnd) && live && time.Now().Before(session.end) &&
			current.generation == d.identity.generation && d.identity.checked && d.identity.credential != nil
		if valid {
			grant, err := desktopSecret()
			if err == nil {
				current.ticket = ""
				current.grant = grant
				if d.serviceGrants == nil {
					d.serviceGrants = map[string]string{}
				}
				d.serviceGrants[grant] = entry.id
			} else {
				valid = false
			}
		}
		grant := ""
		if valid {
			grant = current.grant
		}
		d.mu.Unlock()
		if !valid {
			desktopError(w, 403, "LOCAL_ENTRY_DENIED")
			return true
		}
		w.Header().Set("Set-Cookie", "__Host-piwork-route="+grant+"; Path=/; HttpOnly; Secure; SameSite=Strict")
		desktopJSON(w, 200, map[string]bool{"authorized": true})
		return true
	}
	if strings.HasPrefix(r.URL.Path, desktopServiceReserved) {
		desktopError(w, 404, "NOT_FOUND")
		return true
	}
	grant := desktopSessionID(r, "__Host-piwork-route")
	d.mu.Lock()
	current := d.serviceEntries[entry.id]
	valid := current != nil && grant != "" && d.serviceGrants[grant] == entry.id && current.grant == grant
	d.mu.Unlock()
	if !valid || !d.serviceLive(entry) {
		desktopError(w, 401, "LOCAL_SERVICE_AUTH_REQUIRED")
		return true
	}
	d.forwardServiceHTTP(w, r, entry)
	return true
}

func desktopSessionID(r *http.Request, name string) string {
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

func (d *nativeDesktop) serviceOrigin(entry desktopServiceEntry) string {
	return fmt.Sprintf("http://s-%s.desktop.localhost:%d", entry.id, d.port)
}

func (d *nativeDesktop) serviceEntryFromHost(host string) (desktopServiceEntry, bool) {
	parts := desktopServiceHostPattern.FindStringSubmatch(host)
	if parts == nil || parts[2] != strconv.Itoa(d.port) {
		return desktopServiceEntry{}, false
	}
	d.mu.Lock()
	entry := d.serviceEntries[parts[1]]
	if entry == nil {
		d.mu.Unlock()
		return desktopServiceEntry{}, false
	}
	copy := *entry
	d.mu.Unlock()
	return copy, d.serviceOrigin(copy) == "http://"+host
}

func (d *nativeDesktop) serviceLive(entry desktopServiceEntry) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	session, ok := d.sessions[entry.sessionID]
	return ok && time.Now().Before(session.end) && d.identity.checked && d.identity.credential != nil && d.identity.generation == entry.generation
}

func desktopResolveService(ctx context.Context, api *client.Client, hostname string, port int) (struct {
	Hostname, WorkID, ServiceID string
	Port                        int
}, error) {
	var result struct {
		Hostname, WorkID, ServiceID string
		Port                        int
	}
	path := "/api/v1/service-access/resolve?hostname=" + url.QueryEscape(hostname) + "&port=" + strconv.Itoa(port)
	response, err := api.Binary(ctx, "GET", path, http.Header{"X-Piwork-Gateway-Token": {api.Token}}, nil, 0)
	if err != nil {
		return result, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 32769))
	if err != nil || len(raw) > 32768 {
		return result, &client.APIError{Code: "MALFORMED_RESPONSE", Text: "Core service resolution is malformed"}
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var failure struct{ Code, Message string }
		_ = json.Unmarshal(raw, &failure)
		if failure.Code == "" {
			failure.Code = "SERVICE_UNAVAILABLE"
		}
		return result, &client.APIError{Status: response.StatusCode, Code: failure.Code, Text: failure.Message}
	}
	if json.Unmarshal(raw, &result) != nil || result.Hostname != hostname || result.Port != port || result.WorkID == "" || result.ServiceID == "" {
		return result, &client.APIError{Code: "MALFORMED_RESPONSE", Text: "Core service resolution is malformed"}
	}
	return result, nil
}

func (d *nativeDesktop) serveServiceEntryAPI(w http.ResponseWriter, r *http.Request) bool {
	path := r.URL.EscapedPath()
	if path != "/_desktop/api/service-entries" && !strings.HasPrefix(path, "/_desktop/api/service-entries/") {
		return false
	}
	if r.URL.RawQuery != "" {
		desktopError(w, 400, "INVALID_SERVICE_ENTRY")
		return true
	}
	if d.view(r.Context(), "")["state"] != "authenticated" {
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	sessionID := desktopSessionID(r, d.cookieName())
	d.mu.Lock()
	if d.identity.credential == nil || !d.identity.checked {
		d.mu.Unlock()
		desktopError(w, 401, "AUTH_REQUIRED")
		return true
	}
	coreURL, token, generation := d.identity.coreURL, d.identity.credential.Token, d.identity.generation
	d.mu.Unlock()
	api, err := client.New(coreURL, token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return true
	}
	if path == "/_desktop/api/service-entries" && r.Method == http.MethodPost {
		input, err := desktopControlInput(r, "workId", "serviceId", "port")
		if err != nil {
			desktopControlFailure(w, err)
			return true
		}
		workID, validWork := desktopFieldString(input, "workId", 128)
		serviceID, validService := desktopFieldString(input, "serviceId", 128)
		if !validWork || !validService || !desktopIDPattern.MatchString(workID) || !desktopIDPattern.MatchString(serviceID) {
			desktopError(w, 400, "INVALID_SERVICE_ENTRY")
			return true
		}
		var service struct {
			Access struct {
				Hostname   string `json:"hostname"`
				DefaultURL string `json:"defaultUrl"`
				Ports      []struct {
					Port int `json:"port"`
				} `json:"ports"`
			} `json:"access"`
		}
		if err := api.Request(r.Context(), "GET", "/api/v1/works/"+workID+"/services/"+serviceID, nil, &service); err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && apiErr.Status == 401 {
				d.revokeToken(coreURL, token)
			}
			desktopControlFailure(w, err)
			return true
		}
		port := 0
		if raw, specified := input["port"]; specified {
			if json.Unmarshal(raw, &port) != nil || port < 1 || port > 65535 {
				desktopError(w, 400, "WEB_PORT_REQUIRED")
				return true
			}
		} else if service.Access.DefaultURL != "" {
			parsed, err := url.Parse(service.Access.DefaultURL)
			if err == nil && parsed.Scheme == "http" {
				port = 80
				if parsed.Port() != "" {
					port, _ = strconv.Atoi(parsed.Port())
				}
			}
		}
		allowed := false
		for _, candidate := range service.Access.Ports {
			if candidate.Port == port {
				allowed = true
			}
		}
		if !allowed || !serviceDomainPattern.MatchString(service.Access.Hostname) {
			desktopError(w, 400, "WEB_PORT_REQUIRED")
			return true
		}
		resolved, err := desktopResolveService(r.Context(), api, service.Access.Hostname, port)
		if err != nil {
			var apiErr *client.APIError
			if errors.As(err, &apiErr) && apiErr.Status == 401 {
				d.revokeToken(coreURL, token)
			}
			desktopControlFailure(w, err)
			return true
		}
		if resolved.WorkID != workID || resolved.ServiceID != serviceID {
			desktopError(w, 502, "SERVICE_IDENTITY_MISMATCH")
			return true
		}
		var entryIDRaw [18]byte
		if _, err := rand.Read(entryIDRaw[:]); err != nil {
			desktopError(w, 503, "LOCAL_ENTRY_UNAVAILABLE")
			return true
		}
		entryID := hex.EncodeToString(entryIDRaw[:])
		ticket, err := desktopSecret()
		if err != nil {
			desktopError(w, 503, "LOCAL_ENTRY_UNAVAILABLE")
			return true
		}
		entry := &desktopServiceEntry{id: entryID, workID: workID, serviceID: serviceID, hostname: service.Access.Hostname,
			port: port, sessionID: sessionID, generation: generation, ticket: ticket, ticketEnd: time.Now().Add(30 * time.Second), embed: "unknown"}
		d.mu.Lock()
		current := d.identity.generation == generation && d.identity.checked && d.identity.credential != nil && d.identity.credential.Token == token
		capacity := false
		reused := false
		if current {
			if d.serviceEntries == nil {
				d.serviceEntries = map[string]*desktopServiceEntry{}
			}
			for _, prior := range d.serviceEntries {
				if prior.workID == workID && prior.serviceID == serviceID && prior.port == port && prior.sessionID == sessionID && prior.generation == generation {
					prior.ticket, prior.ticketEnd = ticket, entry.ticketEnd
					entry = prior
					entryID = prior.id
					reused = true
					break
				}
			}
			if !reused {
				capacity = len(d.serviceEntries) >= 1024
				if !capacity {
					d.serviceEntries[entryID] = entry
				}
			}
		}
		d.mu.Unlock()
		if !current {
			desktopError(w, 409, "CONNECTION_CHANGED")
			return true
		}
		if capacity {
			desktopError(w, 429, "SERVICE_ENTRY_LIMIT")
			return true
		}
		origin := d.serviceOrigin(*entry)
		desktopJSON(w, 200, map[string]any{"entryId": entryID, "workId": workID, "serviceId": serviceID,
			"hostname": entry.hostname, "port": port, "origin": origin, "entryUrl": origin + desktopServiceReserved + "enter#ticket=" + ticket})
		return true
	}
	if strings.HasPrefix(path, "/_desktop/api/service-entries/") && r.Method == "GET" {
		entryID := strings.TrimPrefix(path, "/_desktop/api/service-entries/")
		d.mu.Lock()
		entry := d.serviceEntries[entryID]
		var copy desktopServiceEntry
		if entry != nil {
			copy = *entry
		}
		d.mu.Unlock()
		if entry == nil || copy.sessionID != sessionID || copy.generation != generation || !d.serviceLive(copy) {
			desktopError(w, 404, "NOT_FOUND")
			return true
		}
		resolved, err := desktopResolveService(r.Context(), api, copy.hostname, copy.port)
		if err != nil {
			desktopControlFailure(w, err)
			return true
		}
		if resolved.WorkID != copy.workID || resolved.ServiceID != copy.serviceID {
			desktopError(w, 403, "SERVICE_IDENTITY_CHANGED")
			return true
		}
		desktopJSON(w, 200, map[string]any{"workId": copy.workID, "serviceId": copy.serviceID,
			"hostname": copy.hostname, "port": copy.port, "status": "available", "embed": copy.embed})
		return true
	}
	desktopError(w, 404, "NOT_FOUND")
	return true
}
