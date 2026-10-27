// Package consoleapp implements the Core's hosted administration UI.
package consoleapp

import (
	"encoding/json"
	"net/http"
	"piwork/internal/bootcsp"
	"piwork/internal/bootrecovery"
	"piwork/internal/consoleassets"
	"piwork/internal/localweb"
	"strconv"
	"strings"
	"sync"
)

type consoleOptions struct{ coreURL, dataDir string }

type nativeConsole struct {
	hosted  *HostedOptions
	options consoleOptions
	mu      sync.Mutex
	uploads int
}

func consoleShellRoute(escapedPath string) bool {
	parts := strings.Split(escapedPath, "/")
	if len(parts) == 4 && parts[0] == "" && parts[1] == "models" && parts[2] == "providers" {
		_, valid := localweb.ResourcePart(parts[3], localweb.IDPattern)
		return valid
	}
	if len(parts) != 3 || parts[0] != "" {
		return false
	}
	pattern := localweb.IDPattern
	switch parts[1] {
	case "skills", "packages":
		pattern = localweb.NamePattern
	case "operations", "models":
	default:
		return false
	}
	_, valid := localweb.ResourcePart(parts[2], pattern)
	return valid
}

func consoleHTMLRoute(path string) bool {
	return path == "/setup" || strings.Contains("|/|/login|/users|/runtime|/default-work|/skills|/packages|/operations|/models|/about|", "|"+path+"|") || consoleShellRoute(path)
}

func (c *nativeConsole) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
	if c.hosted == nil || c.hosted.Origin(r) == "" {
		consoleFailure(w, 400, "INVALID_HOST")
		return
	}
	if consoleHTMLRoute(r.URL.EscapedPath()) && bootrecovery.Redirect(w, r) {
		return
	}
	quickPreparation := r.URL.Path == "/setup" && r.URL.RawQuery == "step=prepare"
	if (r.URL.RawQuery != "" && !quickPreparation) || r.URL.Fragment != "" {
		consoleFailure(w, 404, "NOT_FOUND")
		return
	}
	if strings.HasPrefix(r.URL.Path, "/console/api/") {
		c.serveAPI(w, r)
		return
	}
	if r.Method != http.MethodGet {
		consoleFailure(w, 501, "CONSOLE_ROUTE_UNAVAILABLE")
		return
	}
	var path, contentType string
	switch {
	case r.URL.Path == "/healthz":
		consoleJSON(w, 200, map[string]string{"status": "healthy"})
		return
	case r.URL.Path == "/style.css":
		path, contentType = "static/public/style.css", "text/css; charset=utf-8"
	case r.URL.Path == "/piwork-logo.png":
		path, contentType = "static/public/piwork-logo.png", "image/png"
	case strings.HasPrefix(r.URL.Path, "/browser/") && localweb.BrowserAsset.MatchString(strings.TrimPrefix(r.URL.Path, "/browser/")):
		path, contentType = "static/browser/"+strings.TrimPrefix(r.URL.Path, "/browser/"), "text/javascript; charset=utf-8"
	default:
		if consoleHTMLRoute(r.URL.EscapedPath()) {
			path, contentType = "static/public/index.html", "text/html; charset=utf-8"
		} else {
			consoleFailure(w, 404, "NOT_FOUND")
			return
		}
	}
	content, err := consoleassets.FS.ReadFile(path)
	if err != nil {
		consoleFailure(w, 404, "CONSOLE_ASSET_UNAVAILABLE")
		return
	}
	if contentType == "text/html; charset=utf-8" {
		html := strings.Replace(string(content), "<head>", `<head><meta name="piwork-mode" content="hosted">`, 1)
		html = strings.ReplaceAll(html, `href="/style.css"`, `href="/admin/style.css"`)
		html = strings.ReplaceAll(html, `src="/browser/`, `src="/admin/browser/`)
		content = bootrecovery.HTML([]byte(html), r)
		w.Header().Set("Content-Security-Policy", bootcsp.Policy(w.Header().Get("Content-Security-Policy"), consoleassets.FS))
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(content)))
	w.WriteHeader(200)
	_, _ = w.Write(content)
}

func consoleJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func consoleFailure(w http.ResponseWriter, status int, code string) {
	consoleJSON(w, status, map[string]string{"code": code, "message": code})
}
