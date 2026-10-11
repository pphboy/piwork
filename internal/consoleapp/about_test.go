package consoleapp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"piwork/internal/client"
	"strings"
	"testing"
	"time"
)

func TestConsoleAboutUsesRemoteCoreAndKeepsAdminSession(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/me":
			json.NewEncoder(w).Encode(map[string]string{"id": "owner", "account": "admin", "role": "admin"})
		case "/api/v1/admin/status":
			json.NewEncoder(w).Encode(map[string]any{"adminApiVersion": 1})
		case "/api/v1/about":
			json.NewEncoder(w).Encode(map[string]any{"build": map[string]string{"program": "piwork-serve", "version": "remote-fixture"}})
		default:
			w.WriteHeader(404)
		}
	}))
	defer core.Close()
	c := &nativeConsole{options: consoleOptions{coreURL: core.URL, publicOrigin: "https://console.example:7173"}, sessions: map[string]consoleSession{"admin": {token: "fixture", csrf: "csrf", user: client.Identity{ID: "owner", Role: "admin"}, expiresAt: time.Now().Add(time.Hour)}}}
	for _, cookie := range []string{"", consoleSessionCookie + "=admin"} {
		r := httptest.NewRequest("GET", c.options.publicOrigin+"/console/api/about", nil)
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
