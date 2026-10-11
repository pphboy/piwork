package cli

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDesktopAboutIsLocalAuthorizedAndAvailableWithoutCoreLogin(t *testing.T) {
	d := &nativeDesktop{port: 17891, origin: "http://desktop.localhost:17891", sessions: map[string]desktopSession{"local": {end: time.Now().Add(time.Hour), csrf: "csrf"}}}
	for _, tc := range []struct {
		cookie, origin string
		status         int
	}{{"", "", 401}, {d.cookieName() + "=local", "", 200}, {d.cookieName() + "=local", "https://evil.example", 403}} {
		r := httptest.NewRequest("GET", d.origin+"/_desktop/api/about", nil)
		if tc.cookie != "" {
			r.Header.Set("Cookie", tc.cookie)
		}
		if tc.origin != "" {
			r.Header.Set("Origin", tc.origin)
		}
		w := httptest.NewRecorder()
		d.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		if tc.status == 200 && (!strings.Contains(w.Body.String(), `"program":"piwork-cli"`) || strings.Contains(w.Body.String(), `"token"`)) {
			t.Fatal(w.Body.String())
		}
	}
}
