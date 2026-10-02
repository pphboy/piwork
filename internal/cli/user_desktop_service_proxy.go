package cli

import (
	"context"
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
		if lower == "host" || lower == "x-piwork-csrf" || strings.HasPrefix(lower, "proxy-") || strings.HasPrefix(lower, "x-piwork-gateway-") ||
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
		strings.HasPrefix(name, "piwork-desktop") || strings.HasPrefix(name, "piwork-route")
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

func serviceEmbedPolicy(headers http.Header, shellOrigin string) string {
	xfo := strings.ToLower(headers.Get("X-Frame-Options"))
	if strings.Contains(xfo, "deny") || strings.Contains(xfo, "sameorigin") {
		return "blocked"
	}
	for _, policy := range headers.Values("Content-Security-Policy") {
		for _, directive := range strings.Split(policy, ";") {
			directive = strings.TrimSpace(directive)
			if strings.HasPrefix(strings.ToLower(directive), "frame-ancestors") && (strings.Contains(strings.ToLower(directive), "'none'") || !strings.Contains(directive, shellOrigin)) {
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
	if d.view(r.Context(), "")["state"] != "authenticated" || !d.serviceLive(entry) {
		desktopError(w, 401, "AUTH_REQUIRED")
		return
	}
	d.mu.Lock()
	coreURL, token, generation := d.identity.coreURL, d.identity.credential.Token, d.identity.generation
	d.mu.Unlock()
	api, err := client.New(coreURL, token)
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
		desktopControlFailure(w, err)
		return
	}
	if resolved.WorkID != entry.workID || resolved.ServiceID != entry.serviceID {
		desktopError(w, 403, "SERVICE_IDENTITY_CHANGED")
		return
	}
	headers, allowed := cleanServiceRequestHeaders(r, d.serviceOrigin(entry), entry)
	if !allowed {
		desktopError(w, 403, "SERVICE_ORIGIN_DENIED")
		return
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
				check, end := context.WithTimeout(ctx, 3*time.Second)
				view, err := desktopResolveService(check, api, entry.hostname, entry.port)
				end()
				if err != nil || view.WorkID != entry.workID || view.ServiceID != entry.serviceID {
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
			if generation != entry.generation {
				return errors.New("Desktop connection changed")
			}
			if r.URL.Path == "/" && strings.HasPrefix(strings.ToLower(response.Header.Get("Content-Type")), "text/html") {
				d.mu.Lock()
				if current := d.serviceEntries[entry.id]; current != nil {
					current.embed = serviceEmbedPolicy(response.Header, d.origin)
				}
				d.mu.Unlock()
			}
			cookies := []string{}
			for _, value := range response.Header.Values("Set-Cookie") {
				if clean, ok := cleanServiceSetCookie(value); ok {
					cookies = append(cookies, clean)
				}
			}
			response.Header.Del("Set-Cookie")
			for _, value := range cookies {
				response.Header.Add("Set-Cookie", value)
			}
			if location := response.Header.Get("Location"); location != "" {
				if parsed, err := url.Parse(location); err == nil && parsed.IsAbs() {
					logical := "http://" + entry.hostname
					if entry.port != 80 {
						logical += ":" + strconv.Itoa(entry.port)
					}
					if parsed.Scheme+"://"+parsed.Host == logical {
						parsed.Scheme, parsed.Host = "http", strings.TrimPrefix(d.serviceOrigin(entry), "http://")
						response.Header.Set("Location", parsed.String())
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
	upstream.ServeHTTP(w, forward)
}
