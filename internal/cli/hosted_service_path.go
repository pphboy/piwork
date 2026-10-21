package cli

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strconv"
	"strings"

	"piwork/internal/client"
)

// ParseHostedServicePath parses only the escaped URL path. Target segments
// have one canonical spelling; the remaining application path is not decoded
// twice or routed through any platform API.
func ParseHostedServicePath(escaped string) (work, service string, port int, base, rest string, ok bool) {
	parts := strings.SplitN(escaped, "/", 6)
	if len(parts) != 6 || parts[0] != "" || parts[1] != "services" ||
		!desktopIDPattern.MatchString(parts[2]) || !desktopIDPattern.MatchString(parts[3]) {
		return
	}
	port, err := strconv.Atoi(parts[4])
	if err != nil || port < 1 || port > 65535 || strconv.Itoa(port) != parts[4] {
		return
	}
	rest = "/" + parts[5]
	for _, segment := range strings.Split(rest, "/") {
		decoded, err := url.PathUnescape(segment)
		if err != nil || decoded == "." || decoded == ".." || strings.ContainsAny(decoded, "/\\%\x00\r\n") {
			return "", "", 0, "", "", false
		}
	}
	if strings.HasPrefix(rest, "//") {
		return "", "", 0, "", "", false
	}
	work, service = parts[2], parts[3]
	base = "/services/" + work + "/" + service + "/" + parts[4] + "/"
	ok = true
	return
}

func servicePath(work, service string, port int) string {
	return "/services/" + work + "/" + service + "/" + strconv.Itoa(port) + "/"
}

func (d *nativeDesktop) hostedEntry(ctx context.Context, work, service string, port int) (desktopServiceEntry, error) {
	fail := func(status int, code string) (desktopServiceEntry, error) {
		return desktopServiceEntry{}, &client.APIError{Status: status, Code: code, Text: code}
	}
	if !desktopIDPattern.MatchString(work) || !desktopIDPattern.MatchString(service) {
		return fail(400, "INVALID_SERVICE_ENTRY")
	}
	d.serviceEntryMu.Lock()
	defer d.serviceEntryMu.Unlock()
	d.mu.Lock()
	if d.identity.credential == nil || !d.identity.checked {
		d.mu.Unlock()
		return fail(401, "AUTH_REQUIRED")
	}
	token, coreURL, generation := d.identity.credential.Token, d.identity.coreURL, d.identity.generation
	d.mu.Unlock()
	api, err := d.client(coreURL, token)
	if err != nil {
		return fail(503, "CORE_UNAVAILABLE")
	}
	var metadata struct {
		Access struct {
			Hostname, DefaultURL, DefaultPortName string
			Ports                                 []struct {
				Port int
				Name string
			}
		}
	}
	if err := api.Request(ctx, "GET", "/api/v1/works/"+work+"/services/"+service, nil, &metadata); err != nil {
		return desktopServiceEntry{}, err
	}
	if port == 0 {
		for _, candidate := range metadata.Access.Ports {
			if candidate.Name != "" && candidate.Name == metadata.Access.DefaultPortName {
				port = candidate.Port
				break
			}
		}
	}
	if port == 0 {
		if u, err := url.Parse(metadata.Access.DefaultURL); err == nil && u.Scheme == "http" {
			port = 80
			if u.Port() != "" {
				port, _ = strconv.Atoi(u.Port())
			}
		}
	}
	declared := false
	for _, p := range metadata.Access.Ports {
		declared = declared || p.Port == port
	}
	if port < 1 || port > 65535 || !declared || !serviceDomainPattern.MatchString(metadata.Access.Hostname) {
		return fail(400, "WEB_PORT_REQUIRED")
	}
	resolved, err := desktopResolveService(ctx, api, metadata.Access.Hostname, port)
	if err != nil {
		return desktopServiceEntry{}, err
	}
	if resolved.WorkID != work || resolved.ServiceID != service {
		return fail(502, "SERVICE_IDENTITY_MISMATCH")
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.identity.credential == nil || d.identity.credential.Token != token || d.identity.generation != generation {
		return fail(409, "CONNECTION_CHANGED")
	}
	for _, entry := range d.serviceEntries {
		if entry.workID == work && entry.serviceID == service && entry.port == port {
			if entry.runtimeGeneration != resolved.Generation {
				jar, err := cookiejar.New(nil)
				if err != nil {
					return fail(503, "SERVICE_ENTRY_UNAVAILABLE")
				}
				// The authenticated path and its UI probe identify the Service,
				// while every forwarded request still pins its current runtime.
				entry.runtimeGeneration, entry.hostname, entry.jar = resolved.Generation, metadata.Access.Hostname, jar
			}
			return *entry, nil
		}
	}
	if len(d.serviceEntries) >= 1024 {
		return fail(429, "SERVICE_ENTRY_LIMIT")
	}
	var random [18]byte
	if _, err := rand.Read(random[:]); err != nil {
		return fail(503, "SERVICE_ENTRY_UNAVAILABLE")
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		return fail(503, "SERVICE_ENTRY_UNAVAILABLE")
	}
	entry := desktopServiceEntry{id: hex.EncodeToString(random[:]), workID: work, serviceID: service,
		hostname: metadata.Access.Hostname, port: port, sessionID: d.hosted.SessionID,
		generation: generation, runtimeGeneration: resolved.Generation, embed: "unknown", jar: jar,
		basePath: servicePath(work, service, port)}
	d.serviceEntries[entry.id] = &entry
	return entry, nil
}

// ServeService uses the ordinary authenticated hosted session. No entry grant,
// separate listener, container address or mutable "last application" is used.
func (h *HostedDesktop) ServeService(w http.ResponseWriter, r *http.Request) {
	work, service, port, _, rest, ok := ParseHostedServicePath(r.URL.EscapedPath())
	if !ok {
		desktopError(w, 400, "INVALID_SERVICE_ENTRY")
		return
	}
	entry, err := h.desktop.hostedEntry(r.Context(), work, service, port)
	if err != nil {
		if r.Method == "GET" && strings.Contains(r.Header.Get("Accept"), "text/html") {
			serviceUnavailablePage(w, r, h.desktop.origin, work, 503, "The Work or Service is unavailable. Check its current state in the workbench.")
		} else {
			desktopControlFailure(w, err)
		}
		return
	}
	copy := r.Clone(r.Context())
	u := *r.URL
	u.Path, _ = url.PathUnescape(rest)
	u.RawPath = rest
	copy.URL = &u
	copy.RequestURI = u.RequestURI()
	h.desktop.forwardServiceHTTP(w, copy, entry)
}

func hostedServiceLocation(location string, request *url.URL, origin, logical, base string) (string, error) {
	u, err := url.Parse(location)
	if err != nil || u.User != nil {
		return "", &client.APIError{Code: "INVALID_SERVICE_REDIRECT", Text: "Invalid application redirect"}
	}
	if (u.Host != "" || u.IsAbs()) && u.Scheme+"://"+u.Host != logical && u.Scheme+"://"+u.Host != origin &&
		!(u.Scheme == "" && ("http://"+u.Host == logical || strings.HasSuffix(origin, "://"+u.Host))) {
		return location, nil
	}
	// Resolve against the application's root, then add its canonical prefix.
	// This preserves ../ navigation within the app without escaping to UI.
	u.Scheme, u.Host = "", ""
	if strings.HasPrefix(u.EscapedPath(), base) {
		u.Path = strings.TrimPrefix(u.Path, strings.TrimSuffix(base, "/"))
		u.RawPath = strings.TrimPrefix(u.EscapedPath(), strings.TrimSuffix(base, "/"))
	}
	resolved := request.ResolveReference(u)
	resolved.Scheme, resolved.Host = "", ""
	resolved.Path = strings.TrimSuffix(base, "/") + resolved.Path
	if resolved.RawPath != "" {
		resolved.RawPath = strings.TrimSuffix(base, "/") + resolved.RawPath
	}
	return resolved.String(), nil
}
