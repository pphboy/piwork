package consoleapp

import (
	"net/http"
	"strings"
	"time"

	"piwork/internal/client"
)

type HostedSession struct {
	ID, Token, CSRF string
	User            client.Identity
	ExpiresAt       time.Time
}

// HostedOptions supplies the unified application's session rather than a
// second login store, listener, installation lock, or operator identity.
type HostedOptions struct {
	Origin, DataDirectory string
	Transport             http.RoundTripper
	Resolve               func(*http.Request) (HostedSession, error)
}

func NewHostedHandler(options HostedOptions) http.Handler {
	c := &nativeConsole{options: consoleOptions{publicOrigin: options.Origin, coreURL: options.Origin, dataDir: options.DataDirectory}, hosted: &options}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		session, err := options.Resolve(r)
		if err != nil {
			consoleFailure(w, 401, "AUTHENTICATION_REQUIRED")
			return
		}
		if session.User.Role != "admin" {
			consoleFailure(w, 403, "PERMISSION_DENIED")
			return
		}
		copy := r.Clone(r.Context())
		if r.URL.Path == "/admin" || strings.HasPrefix(r.URL.Path, "/admin/") {
			u := *r.URL
			u.Path = strings.TrimPrefix(u.Path, "/admin")
			u.RawPath = ""
			if u.Path == "" {
				u.Path = "/"
			}
			copy.URL = &u
		}
		c.ServeHTTP(w, copy)
	})
}

func (c *nativeConsole) client(base, token string) (*client.Client, error) {
	api, err := client.New(base, token)
	if err == nil && c.hosted != nil && c.hosted.Transport != nil {
		api.HTTP.Transport = c.hosted.Transport
	}
	return api, err
}
