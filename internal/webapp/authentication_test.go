package webapp

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestSetupExpirationRotationOriginAndRestrictedScope(t *testing.T) {
	s, _, origin := fixture(t)
	browser := browser(t)
	link, _ := s.SetupLink(context.Background())
	parsed, _ := url.Parse(link)
	proof := strings.TrimPrefix(parsed.Fragment, "setup=")
	request, _ := http.NewRequest("POST", origin+"/_web/api/setup/redeem", strings.NewReader(`{"proof":"`+proof+`"}`))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", "http://127.0.0.1:17891")
	response, err := browser.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("foreign origin redeemed setup proof")
	}
	s.setupMu.Lock()
	s.proofEnd = time.Now().Add(-time.Second)
	s.setupMu.Unlock()
	code, _, _ := call(t, browser, origin, "/_web/api/setup/redeem", "POST", "", map[string]string{"proof": proof})
	if code != 403 {
		t.Fatal("expired setup proof accepted", code)
	}
	link, _ = s.SetupLink(context.Background())
	parsed, _ = url.Parse(link)
	code, redeemed, _ := call(t, browser, origin, "/_web/api/setup/redeem", "POST", "", map[string]string{"proof": strings.TrimPrefix(parsed.Fragment, "setup=")})
	if code != 200 {
		t.Fatal("rotated proof unavailable", code)
	}
	csrf := redeemed["csrfToken"].(string)
	code, _, _ = call(t, browser, origin, "/console/api/admin/users", "GET", "", nil)
	if code != 401 {
		t.Fatal("setup session obtained administrator access", code)
	}
	code, _, _ = call(t, browser, origin, "/_desktop/api/work-packages", "POST", csrf, map[string]string{})
	if code != 401 {
		t.Fatal("setup session obtained Work/Inspect access", code)
	}
	if _, err := s.SetupLink(context.Background()); err != nil {
		t.Fatal(err)
	}
	code, _, _ = call(t, browser, origin, "/_web/api/setup/administrator", "POST", csrf, map[string]string{"account": "admin", "password": "synthetic-password"})
	if code != 403 {
		t.Fatal("proof rotation retained an older setup session", code)
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
