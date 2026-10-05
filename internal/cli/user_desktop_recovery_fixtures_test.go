package cli

import (
	"fmt"
	"net"
	"net/http/httptest"
	"path/filepath"
	"piwork/internal/client"
	"strings"
	"testing"
)

func recoveryDesktop(t *testing.T) *nativeDesktop {
	t.Helper()
	var port int
	for attempt := 0; attempt < 100; attempt++ {
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		candidate := listener.Addr().(*net.TCPAddr).Port
		available := desktopControlFixturePortAvailable(candidate)
		_ = listener.Close()
		if available {
			port = candidate
			break
		}
	}
	if port == 0 {
		t.Fatal("no unused fixture control name")
	}
	api, _ := client.New("http://127.0.0.1:1", "")
	return &nativeDesktop{api: api, store: client.CredentialStore{Path: filepath.Join(t.TempDir(), "credential", "client.json")}, port: port, origin: fmt.Sprintf("http://desktop.localhost:%d", port), sessions: map[string]desktopSession{}, identity: desktopIdentity{coreURL: "http://127.0.0.1:1"}}
}
func recoveryHTTP(d *nativeDesktop, method, path, body, cookie, csrf string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, d.origin+path, strings.NewReader(body))
	req.Header.Set("Origin", d.origin)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cookie", cookie)
	req.Header.Set("X-Piwork-Csrf", csrf)
	response := httptest.NewRecorder()
	d.ServeHTTP(response, req)
	return response
}
func recoveryBootstrap(d *nativeDesktop, ticket string) *httptest.ResponseRecorder {
	return recoveryHTTP(d, "POST", "/_desktop/api/bootstrap", `{"ticket":"`+ticket+`"}`, "", "")
}
func recoveryTicket(address string) string { return strings.Split(address, "#ticket=")[1] }
