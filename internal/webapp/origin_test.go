package webapp

import (
	"net"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestLocalAuthoritiesAndSessionOrigins(t *testing.T) {
	s, core, origin := fixture(t)
	if _, err := core.Identity.Bootstrap(t.Context(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(origin)
	second := "http://localhost:" + parsed.Port()
	for _, host := range []string{parsed.Host, "localhost:" + parsed.Port()} {
		r := httptest.NewRequest("GET", "http://"+host+"/_web/api/session", nil)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatal(host, w.Code)
		}
	}
	for _, host := range []string{"evil.invalid:" + parsed.Port(), "localhost:1", "user@" + parsed.Host, parsed.Host + "."} {
		r := httptest.NewRequest("GET", origin+"/_web/api/session", nil)
		r.Host = host
		r.Header.Set("Forwarded", "host="+parsed.Host+";proto=http")
		r.Header.Set("X-Forwarded-Host", parsed.Host)
		w := httptest.NewRecorder()
		s.ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatal("untrusted authority accepted", host, w.Code)
		}
	}
	b := browser(t)
	signIn(t, b, origin, "admin")
	r := httptest.NewRequest("GET", second+"/_desktop/api/works", nil)
	for _, cookie := range b.Jar.Cookies(parsed) {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 401 {
		t.Fatal("session replayed at another authority", w.Code)
	}
	// A separate login on the second valid authority works through hosted Admin.
	b2 := browser(t)
	signIn(t, b2, second, "admin")
	code, _, _ := call(t, b2, second, "/console/api/admin/users", "GET", "", nil)
	if code != 200 {
		t.Fatal("second authority lost hosted admin", code)
	}
	r = httptest.NewRequest("POST", second+"/_web/api/login", strings.NewReader(`{}`))
	r.Header.Set("Origin", origin)
	w = httptest.NewRecorder()
	s.ServeHTTP(w, r)
	if w.Code != 403 {
		t.Fatal("cross origin mutation accepted", w.Code)
	}
	for _, authority := range []string{net.JoinHostPort("127.0.0.1", parsed.Port()), net.JoinHostPort("::1", parsed.Port())} {
		if !s.authorities[authority] {
			t.Fatal("loopback parsing missing", authority)
		}
	}
}
