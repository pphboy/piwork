package webapp

import (
	"context"
	"errors"
	"net"
	"net/http"
	"sync/atomic"
	"testing"

	"piwork/internal/identity"
)

func TestConsoleAvailabilityUsesRealCoreBeforeRuntimeConfiguration(t *testing.T) {
	_, core, origin := fixture(t)
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	browser := browser(t)
	signIn(t, browser, origin, "admin")
	code, runtime, _ := call(t, browser, origin, "/console/api/admin/runtime", http.MethodGet, "", nil)
	if code != http.StatusOK || runtime["configured"] != false {
		t.Fatal("fixture must have an unconfigured Runtime", code)
	}
	code, value, response := call(t, browser, origin, "/console/api/availability", http.MethodGet, "", nil)
	if code != http.StatusOK || value["reachable"] != true || len(value) != 1 {
		t.Fatal("real Console availability must report Core health independently of Runtime", code, value)
	}
	if response.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("availability must not be cached")
	}
}

func TestConsoleAvailabilityRequiresCurrentAdministratorSession(t *testing.T) {
	s, core, origin := fixture(t)
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	if _, err := core.Identity.CreateUser(context.Background(), identity.OperatorPrincipal(), "member", "synthetic-password", "user"); err != nil {
		t.Fatal(err)
	}
	anonymous, member, admin := browser(t), browser(t), browser(t)
	signIn(t, member, origin, "member")
	signIn(t, admin, origin, "admin")
	for _, test := range []struct {
		name   string
		client *http.Client
		status int
	}{
		{"anonymous", anonymous, http.StatusUnauthorized},
		{"ordinary-user", member, http.StatusForbidden},
		{"administrator", admin, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			code, value, _ := call(t, test.client, origin, "/console/api/availability", http.MethodGet, "", nil)
			if code != test.status {
				t.Fatal("unexpected availability authorization", code)
			}
			if code != http.StatusOK {
				if _, present := value["reachable"]; present {
					t.Fatal("unauthorized request obtained availability")
				}
			}
		})
	}
	s.mu.Lock()
	var token string
	for _, session := range s.sessions {
		if session.credential.User.Role == "admin" {
			token = session.credential.Token
		}
	}
	s.mu.Unlock()
	if token == "" {
		t.Fatal("administrator fixture session missing")
	}
	if err := core.Identity.Logout(context.Background(), token); err != nil {
		t.Fatal(err)
	}
	code, value, _ := call(t, admin, origin, "/console/api/availability", http.MethodGet, "", nil)
	if code != http.StatusUnauthorized || value["reachable"] != nil {
		t.Fatal("revoked session regained availability access", code)
	}
}

func TestConsoleAvailabilitySessionSurvivesTemporaryCoreConnectionFailure(t *testing.T) {
	s, core, origin := fixture(t)
	var disconnected atomic.Bool
	// Install the failure gate before any session request starts. All clients,
	// including the observer, use this transport and make a fresh connection.
	s.transport.DisableKeepAlives = true
	dialer := &net.Dialer{}
	s.transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if disconnected.Load() {
			return nil, errors.New("private synthetic connection detail")
		}
		return dialer.DialContext(ctx, network, address)
	}
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	browser := browser(t)
	signIn(t, browser, origin, "admin")
	disconnected.Store(true)
	code, value, _ := call(t, browser, origin, "/console/api/availability", http.MethodGet, "", nil)
	if code != http.StatusBadGateway || value["code"] != "CORE_UNAVAILABLE" || len(value) != 2 {
		t.Fatal("session verification must report a safe connection failure", code, value)
	}
	s.mu.Lock()
	count := len(s.sessions)
	s.mu.Unlock()
	if count != 1 {
		t.Fatal("temporary Core failure erased the browser session")
	}
	disconnected.Store(false)
	code, value, _ = call(t, browser, origin, "/console/api/availability", http.MethodGet, "", nil)
	if code != http.StatusOK || value["reachable"] != true {
		t.Fatal("original browser session could not retry after recovery", code, value)
	}
}

func TestConsoleAvailabilityNestedSessionFailurePreservesLogin(t *testing.T) {
	s, core, origin := fixture(t)
	var disconnected, failNested atomic.Bool
	s.transport.DisableKeepAlives = true
	dialer := &net.Dialer{}
	s.transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		if disconnected.Load() {
			return nil, errors.New("private synthetic nested connection detail")
		}
		return dialer.DialContext(ctx, network, address)
	}
	// The real outer authentication succeeds before this handler runs. Only
	// the hosted handler's subsequent validation loses its Core connection.
	hosted := s.console
	s.console = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if failNested.Load() {
			disconnected.Store(true)
			defer disconnected.Store(false)
		}
		hosted.ServeHTTP(w, r)
	})
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	browser := browser(t)
	signIn(t, browser, origin, "admin")
	failNested.Store(true)
	code, value, _ := call(t, browser, origin, "/console/api/availability", http.MethodGet, "", nil)
	if code != http.StatusBadGateway || value["code"] != "CORE_UNAVAILABLE" || len(value) != 2 {
		t.Fatal("nested connection failure was not classified safely", code, value)
	}
	s.mu.Lock()
	count := len(s.sessions)
	s.mu.Unlock()
	if count != 1 {
		t.Fatal("nested connection failure erased the browser login")
	}
	failNested.Store(false)
	code, value, _ = call(t, browser, origin, "/console/api/availability", http.MethodGet, "", nil)
	if code != http.StatusOK || value["reachable"] != true {
		t.Fatal("original login could not recover after nested connection failure", code, value)
	}
}
