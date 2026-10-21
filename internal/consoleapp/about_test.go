package consoleapp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"piwork/internal/client"
	"strings"
	"testing"
)

func TestConsoleAboutUsesRemoteCoreAndKeepsAdminSession(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/me":
			json.NewEncoder(w).Encode(map[string]string{"id": "owner", "account": "admin", "role": "admin"})
		case "/api/v1/admin/status":
			json.NewEncoder(w).Encode(map[string]any{"adminApiVersion": 1})
		case "/api/v1/about":
			json.NewEncoder(w).Encode(map[string]any{"build": map[string]string{"program": "piwork-core", "version": "remote-fixture"}})
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	origin := "http://localhost:17891"
	c := NewHostedHandler(HostedOptions{CoreURL: core.URL, Origin: func(r *http.Request) string { return origin }, Resolve: func(r *http.Request) (HostedSession, error) {
		if r.Header.Get("Cookie") == "" {
			return HostedSession{}, fmt.Errorf("no session")
		}
		return HostedSession{ID: "admin", Token: "fixture", CSRF: "csrf", User: client.Identity{ID: "owner", Role: "admin"}}, nil
	}})
	for _, cookie := range []string{"", "session=admin"} {
		r := httptest.NewRequest("GET", origin+"/console/api/about", nil)
		r.Header.Set("Cookie", cookie)
		w := httptest.NewRecorder()
		c.ServeHTTP(w, r)
		if cookie == "" && w.Code != 401 {
			t.Fatal(w.Code)
		}
		if cookie != "" && (w.Code != 200 || !strings.Contains(w.Body.String(), "remote-fixture")) {
			t.Fatal(w.Code, w.Body.String())
		}
	}
}
