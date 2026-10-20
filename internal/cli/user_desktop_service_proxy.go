package cli

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	"piwork/internal/client"
)

func (d *nativeDesktop) reserveService(entry desktopServiceEntry) bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	key := entry.sessionID + ":" + strconv.Itoa(entry.generation)
	if d.serviceConns == nil {
		d.serviceConns = map[string]int{}
	}
	if d.serviceConns[key] >= 64 {
		return false
	}
	d.serviceConns[key]++
	return true
}

func (d *nativeDesktop) releaseService(entry desktopServiceEntry) {
	d.mu.Lock()
	defer d.mu.Unlock()
	key := entry.sessionID + ":" + strconv.Itoa(entry.generation)
	if d.serviceConns[key] <= 1 {
		delete(d.serviceConns, key)
	} else {
		d.serviceConns[key]--
	}
}

func serviceAllowedPath(r *http.Request) bool {
	path := r.URL.RequestURI()
	return strings.HasPrefix(path, "/") && !strings.HasPrefix(path, "//") && !strings.ContainsAny(path, "\r\n\x00")
}

func cleanServiceRequestHeaders(r *http.Request, origin string, entry desktopServiceEntry) (http.Header, bool) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions && r.Header.Get("Origin") != origin {
		return nil, false
	}
	logical := "http://" + entry.hostname
	if entry.port != 80 {
		logical += ":" + strconv.Itoa(entry.port)
	}
	headers := make(http.Header)
	connected := map[string]bool{}
	for _, name := range strings.Split(r.Header.Get("Connection"), ",") {
		connected[strings.ToLower(strings.TrimSpace(name))] = true
	}
	for name, values := range r.Header {
		lower := strings.ToLower(name)
		if lower == "host" || lower == "x-piwork-app-session" || lower == "forwarded" || strings.HasPrefix(lower, "x-forwarded-") || lower == "x-csrf-token" || lower == "x-piwork-csrf" || strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-gateway-") ||
			connected[lower] || lower == "connection" || lower == "keep-alive" || lower == "transfer-encoding" || lower == "te" || lower == "trailer" {
			continue
		}
		if lower == "cookie" {
			cookies := []string{}
			for _, value := range values {
				for _, part := range strings.Split(value, ";") {
					part = strings.TrimSpace(part)
					if part == "" || reservedServiceCookie(strings.SplitN(part, "=", 2)[0]) {
						continue
					}
					cookies = append(cookies, part)
				}
			}
			if len(cookies) > 0 {
				headers.Set("Cookie", strings.Join(cookies, "; "))
			}
			continue
		}
		if lower == "origin" || lower == "referer" {
			if len(values) != 1 {
				return nil, false
			}
			parsed, err := url.Parse(values[0])
			if err != nil || parsed.Scheme+"://"+parsed.Host != origin || parsed.User != nil {
				return nil, false
			}
			value := logical
			if lower == "referer" {
				if entry.basePath != "" && strings.HasPrefix(parsed.Path, entry.basePath) {
					parsed.Path = "/" + strings.TrimPrefix(parsed.Path, entry.basePath)
					parsed.RawPath = ""
				}
				value += parsed.RequestURI()
			}
			headers.Set(name, value)
			continue
		}
		headers[name] = append([]string(nil), values...)
	}
	return headers, true
}

func reservedServiceCookie(name string) bool {
	name = strings.ToLower(strings.TrimSpace(name))
	return strings.HasPrefix(name, "__host-piwork-") || strings.HasPrefix(name, "__secure-piwork-") ||
		strings.HasPrefix(name, "piwork-web-") || strings.HasPrefix(name, "piwork-desktop") || strings.HasPrefix(name, "piwork-route")
}

func cleanServiceSetCookie(value string) (string, bool) {
	parts := strings.Split(value, ";")
	name := strings.SplitN(parts[0], "=", 2)[0]
	if name == "" || reservedServiceCookie(name) {
		return "", false
	}
	cleaned := []string{parts[0]}
	for _, part := range parts[1:] {
		if strings.HasPrefix(strings.ToLower(strings.TrimSpace(part)), "domain=") {
			continue
		}
		cleaned = append(cleaned, part)
	}
	return strings.Join(cleaned, ";"), true
}

func serviceEmbedPolicy(headers http.Header, shellOrigin string, sameOrigin bool) string {
	xfo := strings.ToLower(headers.Get("X-Frame-Options"))
	if strings.Contains(xfo, "deny") || strings.Contains(xfo, "sameorigin") && !sameOrigin {
		return "blocked"
	}
	for _, policy := range headers.Values("Content-Security-Policy") {
		for _, directive := range strings.Split(policy, ";") {
			parts := strings.Fields(directive)
			if len(parts) == 0 || !strings.EqualFold(parts[0], "frame-ancestors") {
				continue
			}
			allowed := false
			for _, source := range parts[1:] {
				if source == "*" || source == shellOrigin || sameOrigin && source == "'self'" {
					allowed = true
				}
			}
			if !allowed {
				return "blocked"
			}
		}
	}
	return "allowed"
}

func (d *nativeDesktop) forwardServiceHTTP(w http.ResponseWriter, r *http.Request, entry desktopServiceEntry) {
	if !serviceAllowedPath(r) || r.Method == http.MethodConnect || r.Header.Get("Upgrade") != "" && !strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		desktopError(w, 403, "SERVICE_REQUEST_DENIED")
		return
	}
	if r.Header.Get("Upgrade") != "" && (r.Method != http.MethodGet || r.Header.Get("Origin") != d.serviceOrigin(entry)) {
		desktopError(w, 403, "SERVICE_UPGRADE_DENIED")
		return
	}
	d.mu.Lock()
	session, exists := d.sessions[entry.sessionID]
	session.id = entry.sessionID
	d.mu.Unlock()
	if !exists {
		desktopError(w, 401, "LOCAL_SERVICE_AUTH_REQUIRED")
		return
	}
	guarded, request, finish, allowed := d.guardContent(w, r, session)
	if !allowed {
		return
	}
	defer finish()
	w, r = guarded, request
	if d.view(r.Context(), "")["state"] != "authenticated" || !d.serviceLive(entry) {
		desktopError(w, 401, "AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	if d.identity.credential == nil || !d.identity.checked {
		d.mu.Unlock()
		desktopError(w, 401, "AUTH_REQUIRED")
		return
	}
	coreURL, token, generation := d.identity.coreURL, d.identity.credential.Token, d.identity.generation
	d.mu.Unlock()
	api, err := d.client(coreURL, token)
	if err != nil {
		desktopError(w, 503, "CORE_UNAVAILABLE")
		return
	}
	checkCtx, checkCancel := context.WithTimeout(r.Context(), 5*time.Second)
	resolved, err := desktopResolveService(checkCtx, api, entry.hostname, entry.port)
	checkCancel()
	if err != nil {
		var apiErr *client.APIError
		if errors.As(err, &apiErr) && apiErr.Status == 401 {
			d.revokeToken(coreURL, token)
		}
		if d.hosted != nil && r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/html") {
			serviceUnavailablePage(w, r, d.origin, entry.workID, 503, "The Work or Service is unavailable. Check its current state in the workbench.")
		} else {
			desktopControlFailure(w, err)
		}
		return
	}
	if resolved.WorkID != entry.workID || resolved.ServiceID != entry.serviceID {
		desktopError(w, 403, "SERVICE_IDENTITY_CHANGED")
		return
	}
	if entry.runtimeGeneration != "" && entry.runtimeGeneration != resolved.Generation {
		d.invalidateServiceEntry(entry)
		desktopError(w, 409, "SERVICE_GENERATION_CHANGED")
		return
	}
	headers, allowed := cleanServiceRequestHeaders(r, d.serviceOrigin(entry), entry)
	if !allowed {
		desktopError(w, 403, "SERVICE_ORIGIN_DENIED")
		return
	}
	if d.hosted != nil && entry.jar != nil {
		headers.Del("Cookie")
		request := &http.Request{Header: headers}
		for _, cookie := range entry.jar.Cookies(d.logicalServiceURL(entry, r.URL.Path)) {
			if !reservedServiceCookie(cookie.Name) {
				request.AddCookie(cookie)
			}
		}
	}
	if !d.reserveService(entry) {
		desktopError(w, 429, "SERVICE_CONNECTION_LIMIT")
		return
	}
	defer d.releaseService(entry)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !d.serviceLive(entry) {
					cancel()
					return
				}
				check, end := context.WithTimeout(ctx, 750*time.Millisecond)
				view, err := desktopResolveService(check, api, entry.hostname, entry.port)
				end()
				if err != nil || view.WorkID != entry.workID || view.ServiceID != entry.serviceID || entry.runtimeGeneration != "" && view.Generation != entry.runtimeGeneration {
					cancel()
					return
				}
			}
		}
	}()
	forward := r.Clone(ctx)
	forward.Header = headers
	if strings.EqualFold(r.Header.Get("Upgrade"), "websocket") {
		forward.Header.Set("Connection", "Upgrade")
		forward.Header.Set("Upgrade", "websocket")
	}
	gatewayPath := "/api/v1/service-gateway/" + entry.hostname + "/" + strconv.Itoa(entry.port) + r.URL.RequestURI()
	target, err := url.ParseRequestURI(gatewayPath)
	if err != nil {
		desktopError(w, 403, "SERVICE_REQUEST_DENIED")
		return
	}
	upstream := &httputil.ReverseProxy{
		Transport: &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 10 * time.Second}).DialContext,
			DisableCompression: true, DisableKeepAlives: true, MaxResponseHeaderBytes: 32 << 10},
		FlushInterval: -1, ErrorLog: log.New(io.Discard, "", 0),
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.Out.URL = &url.URL{Scheme: api.Base.Scheme, Host: api.Base.Host, Path: target.Path, RawPath: target.RawPath, RawQuery: target.RawQuery, ForceQuery: target.ForceQuery}
			pr.Out.Host = api.Base.Host
			pr.Out.Header.Set("X-Piwork-Gateway-Token", token)
			if entry.basePath != "" {
				pr.Out.Header.Set("X-Forwarded-Prefix", strings.TrimSuffix(entry.basePath, "/"))
				scope := sha256.Sum256([]byte("application-storage:" + entry.sessionID))
				pr.Out.Header.Set("X-Piwork-App-Session", hex.EncodeToString(scope[:]))
			}
			if entry.runtimeGeneration != "" {
				pr.Out.Header.Set("X-Piwork-Gateway-Generation", entry.runtimeGeneration)
			}
		},
		ModifyResponse: func(response *http.Response) error {
			if response.StatusCode == 401 && response.Header.Get("X-Piwork-Gateway-Error") == "1" {
				d.revokeToken(coreURL, token)
				response.Body.Close()
				response.Body = io.NopCloser(strings.NewReader(`{"code":"AUTH_REQUIRED","message":"AUTH_REQUIRED"}`))
				response.Header = make(http.Header)
				response.Header.Set("Content-Type", "application/json; charset=utf-8")
				response.ContentLength = -1
				return nil
			}
			if generation != entry.generation || !d.serviceLive(entry) {
				return errors.New("Desktop connection changed")
			}
			if r.URL.Path == "/" && strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
				d.mu.Lock()
				if current := d.serviceEntries[entry.id]; current != nil {
					current.embed = serviceEmbedPolicy(response.Header, d.origin, d.hosted != nil)
				}
				d.mu.Unlock()
			}
			if d.hosted != nil && entry.jar != nil {
				cookies := response.Cookies()
				allowed := cookies[:0]
				for _, cookie := range cookies {
					if !reservedServiceCookie(cookie.Name) {
						allowed = append(allowed, cookie)
					}
				}
				entry.jar.SetCookies(d.logicalServiceURL(entry, r.URL.Path), allowed)
			}
			cookies := []string{}
			for _, value := range response.Header.Values("Set-Cookie") {
				if clean, ok := cleanServiceSetCookie(value); ok && d.hosted == nil {
					cookies = append(cookies, clean)
				}
			}
			response.Header.Del("Set-Cookie")
			for _, value := range cookies {
				response.Header.Add("Set-Cookie", value)
			}
			if location := response.Header.Get("Location"); location != "" {
				if entry.basePath != "" {
					logical := "http://" + entry.hostname
					if entry.port != 80 {
						logical += ":" + strconv.Itoa(entry.port)
					}
					next, err := hostedServiceLocation(location, r.URL, d.origin, logical, entry.basePath)
					if err != nil {
						return err
					}
					response.Header.Set("Location", next)
				} else {
					if parsed, err := url.Parse(location); err == nil && parsed.IsAbs() {
						logical := "http://" + entry.hostname
						if entry.port != 80 {
							logical += ":" + strconv.Itoa(entry.port)
						}
						if parsed.Scheme+"://"+parsed.Host == logical {
							browserOrigin, _ := url.Parse(d.serviceOrigin(entry))
							parsed.Scheme, parsed.Host = browserOrigin.Scheme, browserOrigin.Host
							response.Header.Set("Location", parsed.String())
						}
					}
				}
			}
			for name := range response.Header {
				if strings.HasPrefix(strings.ToLower(name), "x-piwork-gateway-") || strings.HasPrefix(strings.ToLower(name), "proxy-") {
					response.Header.Del(name)
				}
			}
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, _ *http.Request, _ error) { desktopError(w, 502, "CORE_UNAVAILABLE") },
	}
	if d.hosted != nil && d.hosted.Transport != nil {
		upstream.Transport = d.hosted.Transport
	}
	upstream.ServeHTTP(w, forward)
}
