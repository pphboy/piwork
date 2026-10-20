package cli

import (
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func serviceUnavailablePage(w http.ResponseWriter, r *http.Request, origin, workID string, status int, reason string) {
	if r.Method != http.MethodGet || !strings.Contains(r.Header.Get("Accept"), "text/html") {
		desktopError(w, status, "LOCAL_SERVICE_AUTH_REQUIRED")
		return
	}
	back := origin + "/"
	if workID != "" {
		back = origin + "/#/work/" + url.PathEscape(workID)
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Service unavailable</title><h1>Service unavailable</h1><p>`+html.EscapeString(reason)+`</p><p>`+html.EscapeString(workID)+`</p><a href="`+html.EscapeString(back)+`" rel="noopener">Back to Work</a></html>`)
}

func (d *nativeDesktop) routeCookieName(entry desktopServiceEntry) string {
	return "__Host-piwork-route"
}
func (d *nativeDesktop) logicalServiceURL(entry desktopServiceEntry, path string) *url.URL {
	host := entry.hostname
	if entry.port != 80 {
		host = net.JoinHostPort(host, strconv.Itoa(entry.port))
	}
	scheme := "http"
	if d.hosted != nil {
		origin, _ := url.Parse(d.origin)
		scheme = origin.Scheme
	}
	return &url.URL{Scheme: scheme, Host: host, Path: path}
}
func (d *nativeDesktop) invalidateServiceEntry(entry desktopServiceEntry) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if current := d.serviceEntries[entry.id]; current != nil && current.generation == entry.generation {
		delete(d.serviceEntries, entry.id)
		delete(d.serviceGrants, entry.grant)
	}
}
