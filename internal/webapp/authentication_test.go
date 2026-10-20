package webapp

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestFirstUserCSRFExpiresAndCannotGrantAccountAccess(t *testing.T) {
	s, _, origin := fixture(t)
	browser := browser(t)
	code, session, _ := call(t, browser, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || session["authenticated"] != false {
		t.Fatal("ordinary anonymous session unavailable", code)
	}
	csrf := session["csrfToken"].(string)
	request, _ := http.NewRequest("POST", origin+"/_web/api/setup/administrator", strings.NewReader(`{"account":"admin","password":"synthetic-password"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://127.0.0.1:17891")
	request.Header.Set("X-Piwork-Csrf", csrf)
	response, err := browser.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("foreign origin created administrator")
	}
	request, _ = http.NewRequest("GET", origin+"/_web/api/session", nil)
	request.Host = "invalid.localhost"
	response, err = browser.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatal("foreign Host obtained a session")
	}
	code, _, _ = call(t, browser, origin, "/console/api/admin/users", "GET", "", nil)
	if code != 401 {
		t.Fatal("ordinary anonymous session obtained administrator access", code)
	}
	code, _, _ = call(t, browser, origin, "/_desktop/api/work-packages", "POST", csrf, map[string]string{})
	if code != 401 {
		t.Fatal("ordinary anonymous session obtained Work access", code)
	}
	s.mu.Lock()
	for id, ch := range s.challenges {
		ch.expires = time.Now().Add(-time.Second)
		s.challenges[id] = ch
	}
	s.mu.Unlock()
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", csrf, map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 403 {
		t.Fatal("expired CSRF accepted", code)
	}
	code, renewed, _ := call(t, browser, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || renewed["csrfToken"] == csrf {
		t.Fatal("ordinary session did not recover automatically", code)
	}
	for _, path := range []string{"/_web/api/setup/session", "/_web/api/setup/redeem"} {
		method := "GET"
		if strings.HasSuffix(path, "redeem") {
			method = "POST"
		}
		code, _, _ = call(t, browser, origin, path, method, "", map[string]string{"proof": "obsolete"})
		if code != 404 {
			t.Fatal("removed setup gate route still active", path, code)
		}
	}
	code, result, _ := call(t, browser, origin, "/_web/api/setup/administrator", "POST", renewed["csrfToken"].(string), map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 201 || result["next"] != "/login" {
		t.Fatal("plain session could not create administrator", code, result)
	}
}

func TestLoginCapacityPreservesExistingSessionsAndSourceLimitIgnoresClientPort(t *testing.T) {
	s, core, origin := fixture(t)
	if _, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password"); err != nil {
		t.Fatal(err)
	}
	first, second := browser(t), browser(t)
	signIn(t, first, origin, "admin")
	s.mu.Lock()
	var existing *session
	for _, ss := range s.sessions {
		existing = ss
		break
	}
	for i := 0; i < 1023; i++ {
		s.sessions[fmt.Sprint("synthetic-session-", i)] = existing
	}
	s.mu.Unlock()
	_, challenge, _ := call(t, second, origin, "/_web/api/session", "GET", "", nil)
	code, _, _ := call(t, second, origin, "/_web/api/login", "POST", challenge["csrfToken"].(string), map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 503 {
		t.Fatal("session capacity did not reject a new login", code)
	}
	code, state, _ := call(t, first, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || state["authenticated"] != true {
		t.Fatal("capacity evicted a valid session")
	}
	s.mu.Lock()
	for id := range s.sessions {
		if strings.HasPrefix(id, "synthetic-session-") {
			delete(s.sessions, id)
		}
	}
	s.failures["source:127.0.0.1"] = failureBucket{started: time.Now(), count: 5}
	s.mu.Unlock()
	code, result, _ := call(t, second, origin, "/_web/api/login", "POST", challenge["csrfToken"].(string), map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 429 || result["retryAfterMs"].(float64) <= 0 {
		t.Fatal("source limit or retry guidance missing", code)
	}
}

func TestChallengeCapacityDoesNotEvictValidBrowserLogin(t *testing.T) {
	s, core, origin := fixture(t)
	_, err := core.Identity.Bootstrap(context.Background(), "admin", "synthetic-password")
	if err != nil {
		t.Fatal(err)
	}
	first := browser(t)
	signIn(t, first, origin, "admin")
	s.mu.Lock()
	for i := 0; i < 2048; i++ {
		s.challenges[fmt.Sprint(i)] = challenge{csrf: "synthetic-csrf", expires: time.Now().Add(time.Minute)}
	}
	s.mu.Unlock()
	code, _, _ := call(t, browser(t), origin, "/_web/api/session", "GET", "", nil)
	if code != 429 {
		t.Fatal("challenge capacity not enforced", code)
	}
	code, state, _ := call(t, first, origin, "/_web/api/session", "GET", "", nil)
	if code != 200 || state["authenticated"] != true {
		t.Fatal("challenge exhaustion evicted browser identity")
	}
}
