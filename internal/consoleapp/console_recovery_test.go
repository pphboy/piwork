package consoleapp

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"piwork/internal/client"
)

func TestForwardedWriteCanCommitBeforeCoreResponseIsLost(t *testing.T) {
	var committed atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/v1/admin/users" {
			t.Error("unexpected Core request", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
			return
		}
		committed.Add(1)
		connection, _, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		connection.Close()
	}))
	defer core.Close()
	origin := "http://localhost:17891"
	handler := NewHostedHandler(HostedOptions{CoreURL: core.URL, Origin: func(*http.Request) string { return origin }, Resolve: func(*http.Request) (HostedSession, error) {
		return HostedSession{ID: "admin", Token: "synthetic-token", CSRF: "synthetic-csrf", User: client.Identity{ID: "admin", Role: "admin"}}, nil
	}})
	r := httptest.NewRequest(http.MethodPost, origin+"/console/api/admin/users", strings.NewReader(`{"account":"new-user","password":"synthetic-password","role":"user"}`))
	r.Header.Set("Origin", origin)
	r.Header.Set("X-Csrf-Token", "synthetic-csrf")
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	if committed.Load() != 1 || w.Code != http.StatusBadGateway || !strings.Contains(w.Body.String(), "CORE_UNAVAILABLE") {
		t.Fatal("lost Core response must not imply the write was rejected or replay it", committed.Load(), w.Code, w.Body.String())
	}
}
