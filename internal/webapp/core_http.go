package webapp

import (
	"context"
	"errors"
	"io"
	"net/http"
	"time"

	"piwork/internal/client"
	"piwork/internal/contracts"
)

func (s *Server) hasUsers(ctx context.Context) (bool, error) {
	status, err := s.api("").ControlStatus(ctx)
	return status.HasUsers, err
}

type sessionCheck struct {
	done chan struct{}
	err  error
}

// Concurrent requests and the observer share one bounded identity read. There
// is no successful-identity cache that could authorize later requests offline.
func (s *Server) checkSession(ctx context.Context, ss *session) error {
	ss.checkMu.Lock()
	check := ss.checking
	if check == nil {
		check = &sessionCheck{done: make(chan struct{})}
		ss.checking = check
		go func() {
			read, cancel := context.WithTimeout(s.ctx, 750*time.Millisecond)
			defer cancel()
			identity, err := s.api(ss.credential.Token).Me(read)
			if err == nil && (identity.ID != ss.credential.User.ID || identity.Role != ss.credential.User.Role) {
				err = contracts.NewError("AUTHENTICATION_REQUIRED", "")
			}
			if err != nil {
				var apiErr *client.APIError
				status, _ := contracts.ProjectError(err)
				if status == 401 || errors.As(err, &apiErr) && apiErr.Status == 401 {
					s.removeSession(ss)
				} else {
					ss.desktop.SuspendContent()
				}
			}
			ss.checkMu.Lock()
			check.err = err
			ss.checking = nil
			close(check.done)
			ss.checkMu.Unlock()
		}()
	}
	ss.checkMu.Unlock()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-check.done:
		return check.err
	}
}

func (s *Server) observeSession(ctx context.Context, ss *session) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_ = s.checkSession(ctx, ss)
		}
	}
}

// Probes are explicit adapters. They do not expose the Core router or forward
// any browser header. Readiness retains Core's base/docker-delivery semantics.
func (s *Server) probe(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodGet {
		webError(w, 405, "METHOD_NOT_ALLOWED")
		return
	}
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		webError(w, 503, "SHUTTING_DOWN")
		return
	}
	if r.URL.Path == "/healthz" {
		webJSON(w, 200, map[string]string{"status": "healthy"})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	api := s.api("")
	response, err := api.Binary(ctx, http.MethodGet, "/readyz?"+r.URL.RawQuery, nil, nil, 0)
	if err != nil {
		webError(w, 503, "CORE_UNAVAILABLE")
		return
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(body) > 65536 {
		webError(w, 503, "CORE_UNAVAILABLE")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(response.StatusCode)
	_, _ = w.Write(body)
}
