// Package webapp composes the hosted workbench, console and first-user setup.
package webapp

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"piwork/internal/cli"
	"piwork/internal/client"
	"piwork/internal/clientfs"
	"piwork/internal/consoleapp"
	"piwork/internal/consoleassets"
	"piwork/internal/contracts"
	"piwork/internal/coreapp"
	"piwork/internal/localweb"
)

type Options struct {
	Origin, DataDirectory             string
	Core                              *coreapp.Application
	Handler                           http.Handler
	ServiceListenHost                 string
	ServiceFirstPort, ServiceLastPort int
	TLS                               *tls.Config
}

type Server struct {
	ctx                                  context.Context
	options                              Options
	origin                               *url.URL
	transport                            *client.HandlerTransport
	console                              http.Handler
	services                             *cli.HostedServicePool
	mu                                   sync.Mutex
	sessions                             map[string]*session
	challenges                           map[string]challenge
	failures                             map[string]failureBucket
	closed                               bool
	cookie, challengeCookie, setupCookie string
	setupMu                              sync.Mutex
	proofHash                            [32]byte
	proofEnd                             time.Time
	proofUsed                            bool
	setupSessions                        map[string]challenge
}

type session struct {
	cancel         context.CancelFunc
	id, csrf       string
	credential     client.Credential
	expires        time.Time
	desktop        *cli.HostedDesktop
	stateDirectory string
}
type challenge struct {
	csrf    string
	expires time.Time
}
type failureBucket struct {
	started time.Time
	count   int
}

func New(ctx context.Context, options Options) (*Server, error) {
	origin, err := client.ParseCoreURL(options.Origin)
	if err != nil || options.Core == nil || options.Handler == nil || !filepath.IsAbs(options.DataDirectory) {
		return nil, errors.New("invalid unified web application configuration")
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
	prefix := "piwork-web-"
	if origin.Scheme == "https" {
		prefix = "__Host-piwork-web-"
	}
	cookie := prefix + hex.EncodeToString(key[:6])
	s := &Server{ctx: ctx, options: options, origin: origin, cookie: cookie, challengeCookie: cookie + "-login", setupCookie: cookie + "-setup",
		sessions: map[string]*session{}, challenges: map[string]challenge{}, failures: map[string]failureBucket{}, setupSessions: map[string]challenge{}}
	s.transport = client.NewHandlerTransport(ctx, options.Handler)
	first, last := options.ServiceFirstPort, options.ServiceLastPort
	if first == 0 && last == 0 {
		first, last = 17891, 17954
	}
	listenHost := options.ServiceListenHost
	if listenHost == "" {
		listenHost = origin.Hostname()
	}
	s.services, err = cli.NewHostedServicePool(ctx, cli.HostedServiceOptions{Origin: options.Origin, ListenHost: listenHost, StateDirectory: filepath.Join(options.DataDirectory, "runtime", "service-origins"), FirstPort: first, LastPort: last, TLS: options.TLS})
	if err != nil {
		s.transport.Close()
		return nil, err
	}
	s.console = consoleapp.NewHostedHandler(consoleapp.HostedOptions{Origin: options.Origin,
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
	s.setupMu.Lock()
	s.invalidateSetupLocked()
	s.setupMu.Unlock()
	s.services.Close()
	s.transport.Close()
}

func (s *Server) api(token string) *client.Client {
	api, _ := client.New(s.options.Origin, token)
	api.HTTP.Transport = s.transport
	return api
}

func (s *Server) authenticate(r *http.Request) (*session, error) {
	id := requestCookie(r, s.cookie)
	s.mu.Lock()
	ss := s.sessions[id]
	s.mu.Unlock()
	if ss == nil {
		return nil, contracts.NewError("AUTHENTICATION_REQUIRED", "")
	}
	principal, err := s.options.Core.Identity.Authenticate(r.Context(), ss.credential.Token)
	if err != nil {
		status, _ := contracts.ProjectError(err)
		if status >= 500 {
			return nil, err
		}
	}
	if err != nil || !time.Now().Before(ss.expires) || principal.User.ID != ss.credential.User.ID {
		s.removeSession(ss)
		if err != nil {
			return nil, err
		}
		return nil, contracts.NewError("AUTHENTICATION_REQUIRED", "")
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
	if r.Host != s.origin.Host {
		return false
	}
	if origin := r.Header.Get("Origin"); origin != "" && origin != s.options.Origin || mutation && origin == "" {
		return false
	}
	site := r.Header.Get("Sec-Fetch-Site")
	return site == "" || site == "same-origin" || site == "none"
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if path == "/control/setup-link" {
		s.operatorSetupLink(w, r)
		return
	}
	if path == "/healthz" || path == "/readyz" || strings.HasPrefix(path, "/api/v1/") || strings.HasPrefix(path, "/control/") {
		s.options.Handler.ServeHTTP(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Host != s.origin.Host {
		webError(w, 400, "INVALID_HOST")
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
	if path == "/setup" || path == "/login" || path == "/setup/browser/onboarding.js" || path == "/setup/style.css" {
		s.serveSetupAsset(w, r)
		return
	}
	ss, err := s.authenticate(r)
	if err != nil {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			sendError(w, err)
			return
		}
		hasUsers, readErr := s.options.Core.Identity.HasUsers(r.Context())
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
	if r.URL.Path == "/setup/browser/onboarding.js" {
		path, contentType = "static/browser/onboarding.js", "text/javascript; charset=utf-8"
	}
	if r.URL.Path == "/setup/style.css" {
		path, contentType = "static/public/style.css", "text/css; charset=utf-8"
	}
	data, err := consoleassets.FS.ReadFile(path)
	if err != nil {
		webError(w, 503, "WEB_ASSET_UNAVAILABLE")
		return
	}
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
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
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", MaxAge: seconds, HttpOnly: true, Secure: s.origin.Scheme == "https", SameSite: http.SameSiteStrictMode})
}
func readObject(r *http.Request, limit int64) (map[string]json.RawMessage, error) {
	return localweb.ReadObject(r, limit)
}
