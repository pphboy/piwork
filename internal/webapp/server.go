// Package webapp composes the hosted workbench, console and first-user setup.
package webapp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"piwork/internal/bootcsp"
	"piwork/internal/bootrecovery"
	"piwork/internal/cli"
	"piwork/internal/client"
	"piwork/internal/clientfs"
	"piwork/internal/consoleapp"
	"piwork/internal/consoleassets"
	"piwork/internal/contracts"
	"piwork/internal/localweb"
)

type Options struct {
	Origin, DataDirectory string
	CoreURL               string
	SetupSecret           string `json:"-"`
}

type Server struct {
	ctx                     context.Context
	options                 Options
	origin                  *url.URL
	authorities             map[string]bool
	transport               *http.Transport
	setup                   *client.SetupClient
	console                 http.Handler
	mu                      sync.Mutex
	sessions                map[string]*session
	challenges              map[string]challenge
	failures                map[string]failureBucket
	closed                  bool
	cookie, challengeCookie string
}

type session struct {
	cancel         context.CancelFunc
	checkMu        sync.Mutex
	checking       *sessionCheck
	id, csrf       string
	origin         string
	credential     client.Credential
	expires        time.Time
	desktop        *cli.HostedDesktop
	stateDirectory string
}
type challenge struct {
	origin  string
	csrf    string
	expires time.Time
}
type failureBucket struct {
	started time.Time
	count   int
}

func New(ctx context.Context, options Options) (*Server, error) {
	origin, err := client.ParseCoreURL(options.Origin)
	if err != nil || origin.Scheme != "http" || !filepath.IsAbs(options.DataDirectory) {
		return nil, errors.New("invalid unified web application configuration")
	}
	if _, err := client.ParseCoreURL(options.CoreURL); err != nil {
		return nil, err
	}
	root := filepath.Join(options.DataDirectory, "runtime", "browser-sessions")
	private, err := clientfs.OpenPrivateDirectory(root, true)
	if err != nil {
		return nil, err
	}
	items, err := private.Entries()
	if err == nil {
		for _, entry := range items {
			if err = private.RemoveTree(entry.Name()); err != nil {
				break
			}
		}
	}
	_ = private.Close()
	if err != nil {
		return nil, err
	}
	key := sha256.Sum256([]byte(options.Origin))
	cookie := "piwork-web-" + hex.EncodeToString(key[:6])
	s := &Server{ctx: ctx, options: options, origin: origin, cookie: cookie, authorities: localAuthorities(origin), challengeCookie: cookie + "-login",
		sessions: map[string]*session{}, challenges: map[string]challenge{}, failures: map[string]failureBucket{}}
	s.transport = &http.Transport{Proxy: nil, MaxResponseHeaderBytes: 32 << 10, MaxIdleConns: 128, MaxIdleConnsPerHost: 64, IdleConnTimeout: 90 * time.Second}
	s.setup, err = client.NewSetupClient(options.CoreURL, options.SetupSecret)
	if err != nil {
		return nil, err
	}
	s.console = consoleapp.NewHostedHandler(consoleapp.HostedOptions{Origin: s.requestOrigin, CoreURL: options.CoreURL,
		DataDirectory: filepath.Join(options.DataDirectory, "runtime", "browser-console"), Transport: s.transport,
		Resolve: func(r *http.Request) (consoleapp.HostedSession, error) {
			ss, err := s.authenticate(r)
			if err != nil {
				return consoleapp.HostedSession{}, err
			}
			return consoleapp.HostedSession{ID: ss.id, Token: ss.credential.Token, CSRF: ss.csrf, User: ss.credential.User, ExpiresAt: ss.expires}, nil
		}})
	go s.collect(ctx)
	return s, nil
}

func (s *Server) Close() {
	s.mu.Lock()
	s.closed = true
	items := make([]*session, 0, len(s.sessions))
	for _, ss := range s.sessions {
		items = append(items, ss)
	}
	s.sessions = map[string]*session{}
	s.challenges = map[string]challenge{}
	s.mu.Unlock()
	for _, ss := range items {
		if ss.cancel != nil {
			ss.cancel()
		}
		ss.desktop.Close()
		_ = os.RemoveAll(ss.stateDirectory)
	}
	s.transport.CloseIdleConnections()
}

func (s *Server) api(token string) *client.Client {
	api, _ := client.New(s.options.CoreURL, token)
	api.HTTP.Transport = s.transport
	return api
}

func (s *Server) authenticate(r *http.Request) (*session, error) {
	id := requestCookie(r, s.cookie)
	s.mu.Lock()
	ss := s.sessions[id]
	s.mu.Unlock()
	if ss == nil || ss.origin != s.requestOrigin(r) {
		return nil, contracts.NewError("AUTHENTICATION_REQUIRED", "")
	}
	if !time.Now().Before(ss.expires) {
		s.removeSession(ss)
		return nil, contracts.NewError("AUTHENTICATION_REQUIRED", "")
	}
	if err := s.checkSession(r.Context(), ss); err != nil {
		return nil, err
	}
	return ss, nil
}

func (s *Server) removeSession(ss *session) {
	s.mu.Lock()
	if s.sessions[ss.id] != ss {
		s.mu.Unlock()
		return
	}
	delete(s.sessions, ss.id)
	s.mu.Unlock()
	if ss.cancel != nil {
		ss.cancel()
	}
	ss.desktop.Close()
	_ = os.RemoveAll(ss.stateDirectory)
}

func (s *Server) collect(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.Close()
			return
		case <-ticker.C:
			s.mu.Lock()
			if s.closed {
				s.mu.Unlock()
				return
			}
			items := make([]*session, 0, len(s.sessions))
			for _, ss := range s.sessions {
				items = append(items, ss)
			}
			s.pruneLocked()
			s.mu.Unlock()
			for _, ss := range items {
				if !time.Now().Before(ss.expires) {
					s.removeSession(ss)
				}
			}
		}
	}
}

func (s *Server) sameOrigin(r *http.Request, mutation bool) bool {
	if s.requestOrigin(r) == "" {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != s.requestOrigin(r) || mutation && origin == "" {
		return false
	}
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin" || site == "none"
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/healthz" || path == "/readyz" {
		s.probe(w, r)
		return
	}
	if strings.HasPrefix(path, "/api/v1/") || strings.HasPrefix(path, "/control/") {
		webError(w, 404, "NOT_FOUND")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if s.requestOrigin(r) == "" {
		webError(w, 400, "INVALID_HOST")
		return
	}
	if strings.HasPrefix(path, "/services/") {
		if _, _, _, _, _, ok := cli.ParseHostedServicePath(r.URL.EscapedPath()); !ok {
			webError(w, 400, "INVALID_SERVICE_ENTRY")
			return
		}
		if !s.sameOrigin(r, r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions) {
			webError(w, 403, "ORIGIN_INVALID")
			return
		}
		ss, err := s.authenticate(r)
		if err != nil {
			var apiErr *client.APIError
			status, _ := contracts.ProjectError(err)
			if (status == 401 || errors.As(err, &apiErr) && apiErr.Status == 401) && r.Method == http.MethodGet && strings.Contains(r.Header.Get("Accept"), "text/html") {
				http.Redirect(w, r, "/login?returnTo="+url.QueryEscape(r.URL.RequestURI()), http.StatusSeeOther)
			} else {
				sendError(w, err)
			}
			return
		}
		ss.desktop.ServeService(w, r)
		return
	}
	if strings.HasPrefix(path, "/_web/api/") || strings.HasPrefix(path, "/_desktop/") || strings.HasPrefix(path, "/console/api/") {
		if !s.sameOrigin(r, r.Method != http.MethodGet && r.Method != http.MethodHead) {
			webError(w, 403, "ORIGIN_INVALID")
			return
		}
		if s.serveAuthentication(w, r) {
			return
		}
		if strings.HasPrefix(path, "/_web/api/setup/") {
			s.serveSetup(w, r)
			return
		}
		ss, err := s.authenticate(r)
		if err != nil {
			sendError(w, err)
			return
		}
		if strings.HasPrefix(path, "/console/api/") {
			s.console.ServeHTTP(w, r)
			return
		}
		if path == "/_web/api/onboarding" && r.Method == http.MethodGet {
			s.onboarding(w, r, ss)
			return
		}
		ss.desktop.ServeHTTP(w, r)
		return
	}
	if path == "/setup" || path == "/login" || strings.HasPrefix(path, "/setup/") {
		if path == "/setup" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			if ss, err := s.authenticate(r); err == nil && ss.credential.User.Role == "admin" {
				http.Redirect(w, r, "/admin/setup", http.StatusSeeOther)
				return
			}
		}
		s.serveSetupAsset(w, r)
		return
	}
	ss, err := s.authenticate(r)
	if err != nil {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			sendError(w, err)
			return
		}
		hasUsers, readErr := s.hasUsers(r.Context())
		if readErr != nil {
			sendError(w, readErr)
			return
		}
		target := "/login"
		if !hasUsers {
			target = "/setup"
		}
		http.Redirect(w, r, target, http.StatusSeeOther)
		return
	}
	if path == "/admin" || strings.HasPrefix(path, "/admin/") {
		s.console.ServeHTTP(w, r)
		return
	}
	// Preserve previous console deep links at their new management prefix.
	for _, prefix := range []string{"/users", "/runtime", "/default-work", "/skills", "/packages", "/operations", "/models", "/about"} {
		if path == prefix || strings.HasPrefix(path, prefix+"/") {
			http.Redirect(w, r, "/admin"+r.URL.RequestURI(), http.StatusSeeOther)
			return
		}
	}
	ss.desktop.ServeHTTP(w, r)
}

func (s *Server) serveSetupAsset(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		webError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	path, contentType := "static/public/setup.html", "text/html; charset=utf-8"
	switch r.URL.Path {
	case "/setup", "/login":
	case "/setup/browser/onboarding.js", "/setup/browser/components.js", "/setup/browser/model-form.js", "/setup/browser/pending.js",
		// Language runtime and catalogs loaded by the setup entry, boot script and
		// onboarding modules. Each path is listed exactly; there is no directory prefix.
		"/setup/browser/i18n.js", "/setup/browser/boot.js", "/setup/browser/locale.js", "/setup/browser/read-deadline.js",
		"/setup/browser/i18n/catalog.js", "/setup/browser/i18n/shared.js", "/setup/browser/i18n/setup.js", "/setup/browser/i18n/app.js":
		path, contentType = "static/browser/"+strings.TrimPrefix(r.URL.Path, "/setup/browser/"), "text/javascript; charset=utf-8"
	case "/setup/style.css":
		path, contentType = "static/public/style.css", "text/css; charset=utf-8"
	case "/setup/piwork-logo.png":
		path, contentType = "static/public/piwork-logo.png", "image/png"
	default:
		webError(w, 404, "NOT_FOUND")
		return
	}
	if strings.HasPrefix(contentType, "text/html") && bootrecovery.Redirect(w, r) {
		return
	}
	data, err := consoleassets.FS.ReadFile(path)
	if err != nil {
		webError(w, 503, "WEB_ASSET_UNAVAILABLE")
		return
	}
	policy := "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
	if strings.HasPrefix(contentType, "text/html") {
		data = bootrecovery.HTML(data, r)
		policy = bootcsp.Policy(policy, consoleassets.FS)
	}
	w.Header().Set("Content-Security-Policy", policy)
	w.Header().Set("Content-Type", contentType)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

func webJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func webError(w http.ResponseWriter, status int, code string) {
	webJSON(w, status, map[string]any{"code": code, "message": code})
}
func sendError(w http.ResponseWriter, err error) {
	var apiErr *client.APIError
	if errors.As(err, &apiErr) {
		if apiErr.Status == 401 {
			webError(w, 401, "AUTHENTICATION_REQUIRED")
		} else if apiErr.Status >= 400 && apiErr.Status < 500 {
			webError(w, apiErr.Status, apiErr.Code)
		} else {
			webError(w, 502, "CORE_UNAVAILABLE")
		}
		return
	}
	status, value := contracts.ProjectError(err)
	webJSON(w, status, value)
}
func requestCookie(r *http.Request, name string) string {
	value, count := "", 0
	for _, cookie := range r.Cookies() {
		if cookie.Name == name {
			value = cookie.Value
			count++
		}
	}
	if count != 1 {
		return ""
	}
	return value
}
func (s *Server) setCookie(w http.ResponseWriter, name, value string, seconds int) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: seconds, HttpOnly: true, Secure: false, SameSite: http.SameSiteStrictMode})
}
func readObject(r *http.Request, limit int64) (map[string]json.RawMessage, error) {
	return localweb.ReadObject(r, limit)
}

// Authorities come only from this machine, never request DNS or proxy headers.
func localAuthorities(origin *url.URL) map[string]bool {
	hosts := []string{"localhost", "127.0.0.1", "::1"}
	if name, err := os.Hostname(); err == nil {
		hosts = append(hosts, name)
	}
	if addresses, err := net.InterfaceAddrs(); err == nil {
		for _, address := range addresses {
			if network, ok := address.(*net.IPNet); ok && network.IP.To4() != nil {
				hosts = append(hosts, network.IP.String())
			}
		}
	}
	allowed := map[string]bool{}
	for _, host := range hosts {
		authority := net.JoinHostPort(host, origin.Port())
		if origin.Port() == "" {
			authority = host
		}
		allowed[strings.ToLower(authority)] = true
	}
	return allowed
}

func (s *Server) requestOrigin(r *http.Request) string {
	if !s.authorities[strings.ToLower(r.Host)] {
		return ""
	}
	return "http://" + r.Host
}
