package webapp

import (
	"context"
	"net/http"
	"piwork/internal/identity"
	"testing"
	"time"
)

func TestBrowserHasNoGenericCoreProxyAndCoreHasNoBrowserIdentity(t *testing.T) {
	s, core, origin := fixture(t)
	b := browser(t)
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	csrf := signIn(t, b, origin, "admin")
	for _, path := range []string{"/api/v1/me", "/api/v1/works", "/control/status", "/control/runtime", "/control/admin/bootstrap"} {
		code, _, _ := call(t, b, origin, path, "GET", "", nil)
		if code != 404 {
			t.Fatal("UI exposed raw Core route", path, code)
		}
	}
	code, _, _ := call(t, b, s.options.CoreURL, "/api/v1/me", "GET", "", nil)
	if code != 401 {
		t.Fatal("Core accepted browser Cookie", code)
	}
	code, _, response := call(t, b, s.options.CoreURL, "/", "GET", "", nil)
	if code != 404 || response.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("Core serves browser UI or CORS", code)
	}
	// Closing the TCP Core proves the browser cannot fall back to a shared
	// object. Readiness fails but the web page and unexpired session survive.
	if err := core.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, b, origin, "/_web/api/onboarding", "GET", "", nil)
	if code != 502 {
		t.Fatal("business bypassed closed Core TCP", code)
	}
	code, _, _ = call(t, b, origin, "/_web/api/logout", "POST", csrf, nil)
	if code != 502 {
		t.Fatal("network failure acknowledged logout", code)
	}
	time.Sleep(600 * time.Millisecond)
	s.mu.Lock()
	count := len(s.sessions)
	s.mu.Unlock()
	if count != 1 {
		t.Fatal("network failure erased ordinary browser login")
	}
	for path, expected := range map[string]int{"/healthz": 200, "/readyz": 503, "/login": 200} {
		code, _, _ := call(t, b, origin, path, http.MethodGet, "", nil)
		if code != expected {
			t.Fatal(path, code)
		}
	}
}

func TestAnonymousServiceDeepLinkUsesNormalLogin(t *testing.T) {
	_, _, origin := fixture(t)
	b := browser(t)
	request, _ := http.NewRequest("GET", origin+"/services/work-1/notes/80/deep?q=1", nil)
	request.Header.Set("Accept", "text/html")
	response, err := b.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 303 || response.Header.Get("Location") != "/login?returnTo=%2Fservices%2Fwork-1%2Fnotes%2F80%2Fdeep%3Fq%3D1" {
		t.Fatal("target lost during ordinary login", response.StatusCode, response.Header.Get("Location"))
	}
}

func TestHTTPObserverRevokesDisabledResetAndLoggedOutSessions(t *testing.T) {
	for _, action := range []string{"disable", "password", "logout"} {
		t.Run(action, func(t *testing.T) {
			s, core, origin := fixture(t)
			if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
				t.Fatal(err)
			}
			user, err := core.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "member", "synthetic-password", "user")
			if err != nil {
				t.Fatal(err)
			}
			b := browser(t)
			signIn(t, b, origin, "member")
			s.mu.Lock()
			var ss *session
			for _, item := range s.sessions {
				ss = item
			}
			s.mu.Unlock()
			if ss == nil {
				t.Fatal("session missing")
			}
			start := time.Now()
			switch action {
			case "disable":
				err = core.Identity.SetEnabled(context.Background(), identity.OperatorPrincipal(), string(user.Id), false)
			case "password":
				err = core.Identity.ResetPassword(context.Background(), identity.OperatorPrincipal(), string(user.Id), "changed-synthetic-password")
			case "logout":
				err = core.Identity.Logout(context.Background(), ss.credential.Token)
			}
			if err != nil {
				t.Fatal(err)
			}
			for time.Since(start) < 2*time.Second {
				s.mu.Lock()
				count := len(s.sessions)
				s.mu.Unlock()
				if count == 0 {
					return
				}
				time.Sleep(10 * time.Millisecond)
			}
			t.Fatal("HTTP session observer did not revoke within two seconds")
		})
	}
}
