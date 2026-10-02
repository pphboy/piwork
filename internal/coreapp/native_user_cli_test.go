package coreapp

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/cli"
)

func TestNativeUserCLIIdentityAgainstRealCore(t *testing.T) {
	_, base, _ := appFixture(t, Options{Initialization: Initialization{Administrator: &struct{ Account, Password string }{"admin", "development-fixture-pass"}}})
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	call := func(args ...string) (int, string, string) {
		t.Helper()
		var stdout, stderr bytes.Buffer
		code := cli.Entry("piwork-cli", append([]string{"--core", base, "--json"}, args...), &stdout, &stderr)
		return code, stdout.String(), stderr.String()
	}
	if code, output, _ := call("status"); code != 5 || !strings.Contains(output, "RUNTIME_NOT_CONFIGURED") {
		t.Fatal("status did not project Core readiness", code, output)
	}
	if code, _, _ := call("whoami"); code != 3 {
		t.Fatal("unauthenticated whoami did not require login", code)
	}
	passwordInput, err := os.CreateTemp(t.TempDir(), "password-")
	if err != nil {
		t.Fatal(err)
	}
	defer passwordInput.Close()
	if _, err := passwordInput.WriteString("development-fixture-pass\n"); err != nil {
		t.Fatal(err)
	}
	if _, err := passwordInput.Seek(0, 0); err != nil {
		t.Fatal(err)
	}
	previousStdin := os.Stdin
	os.Stdin = passwordInput
	defer func() { os.Stdin = previousStdin }()
	code, output, diagnostic := call("login", "--account", "admin", "--password-stdin")
	if code != 0 || diagnostic != "" {
		t.Fatal("real Core login failed", code, diagnostic)
	}
	var login map[string]any
	if json.Unmarshal([]byte(output), &login) != nil || login["user"] == nil {
		t.Fatal("login was not one JSON value", output)
	}
	info, err := os.Stat(credential)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("credential permission", info, err)
	}
	if code, output, diagnostic := call("whoami"); code != 0 || diagnostic != "" || !strings.Contains(output, `"account":"admin"`) {
		t.Fatal("whoami did not use saved Core session", code, output, diagnostic)
	}
	if code, output, diagnostic := call("work", "list"); code != 0 || diagnostic != "" || !strings.Contains(output, `"works"`) {
		t.Fatal("real Core Work list failed", code, output, diagnostic)
	}
	if code, _, _ := call("admin", "status"); code != 2 {
		t.Fatal("operator command entered user CLI", code)
	}
	if code, output, diagnostic := call("logout"); code != 0 || diagnostic != "" || !strings.Contains(output, `"loggedOut":true`) {
		t.Fatal("real Core logout failed", code, output, diagnostic)
	}
	if _, err := os.Stat(credential); !os.IsNotExist(err) {
		t.Fatal("logout retained local credential", err)
	}
}
