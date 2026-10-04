//go:build integration

package coreapp

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	userclient "piwork/internal/client"
)

func TestNativeUserCLIWorkAndConversationThroughGoCore(t *testing.T) {
	a, base, authorization, workID, _ := nativeApplyFixture(t)
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (userclient.CredentialStore{Path: credential}).Save(userclient.Credential{Version: 1, CoreURL: base,
		Token: strings.TrimPrefix(authorization, "Bearer "), ExpiresAt: "2099-01-01T00:00:00Z",
		User: userclient.Identity{ID: "cli-test-user", Account: "admin", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
	_, source, _, _ := runtime.Caller(0)
	binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-cli")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("make build-go is required for the native CLI process gate", err)
	}
	call := func(args ...string) string {
		t.Helper()
		var stdout, stderr bytes.Buffer
		process := exec.Command(binary, append([]string{"--core", base, "--json"}, args...)...)
		process.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credential, "PATH=/nonexistent")
		process.Stdout, process.Stderr = &stdout, &stderr
		if err := process.Run(); err != nil {
			t.Fatalf("native CLI %v failed: %v: %s %s", args, err, stdout.String(), stderr.String())
		}
		return stdout.String()
	}
	decode := func(raw string) map[string]any {
		t.Helper()
		var value map[string]any
		if json.Unmarshal([]byte(raw), &value) != nil {
			t.Fatal("invalid CLI JSON", raw)
		}
		return value
	}
	if raw := call("work", "list"); !strings.Contains(raw, workID) {
		t.Fatal("CLI list omitted current Work", raw)
	}
	if raw := call("work", "show", workID); !strings.Contains(raw, workID) {
		t.Fatal("CLI show omitted current Work", raw)
	}
	loginCredential := filepath.Join(t.TempDir(), "credentials", "login-client.json")
	loginProcess := exec.Command(binary, "--core", base, "--json", "login", "--account", "admin", "--password-stdin")
	loginProcess.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+loginCredential, "PATH=/nonexistent")
	loginProcess.Stdin = strings.NewReader("development-fixture-pass\n")
	loginOutput, err := loginProcess.CombinedOutput()
	if err != nil || !strings.Contains(string(loginOutput), `"account":"admin"`) || strings.Contains(string(loginOutput), "development-fixture-pass") {
		t.Fatal("native CLI login failed or exposed its password", err, string(loginOutput))
	}
	if info, err := os.Stat(loginCredential); err != nil || info.Mode().Perm() != 0o600 {
		t.Fatal("native CLI did not save a private credential", err)
	}
	loggedInWhoami := exec.Command(binary, "--core", base, "--json", "whoami")
	loggedInWhoami.Env = loginProcess.Env
	if output, err := loggedInWhoami.CombinedOutput(); err != nil || !strings.Contains(string(output), `"account":"admin"`) {
		t.Fatal("native CLI process did not reuse login", err, string(output))
	}
	processCall := func(args ...string) map[string]any {
		t.Helper()
		process := exec.Command(binary, append([]string{"--core", base, "--json"}, args...)...)
		process.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credential, "PATH=/nonexistent")
		var output, diagnostic bytes.Buffer
		process.Stdout, process.Stderr = &output, &diagnostic
		if err := process.Run(); err != nil {
			t.Fatalf("native CLI process %v: %v: %s %s", args, err, output.String(), diagnostic.String())
		}
		var result map[string]any
		if json.Unmarshal(output.Bytes(), &result) != nil {
			t.Fatal("native CLI process did not return one JSON object", args, output.String())
		}
		return result
	}
	if got := processCall("whoami"); got["account"] != "admin" {
		t.Fatal("native subprocess lost identity", got)
	}
	if got := processCall("work", "list"); got["works"] == nil {
		t.Fatal("native subprocess did not list Work", got)
	}
	defaultCore := exec.Command(binary, "--json", "work", "list")
	defaultCore.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credential, "PIWORK_CORE_URL="+base, "PATH=/nonexistent")
	if output, err := defaultCore.CombinedOutput(); err != nil || !strings.Contains(string(output), workID) {
		t.Fatal("native CLI did not honor default Core selection", err, string(output))
	}
	if got := processCall("work", "show", workID); got["id"] != workID {
		t.Fatal("native subprocess did not show Work", got)
	}
	if got := processCall("work", "config", "show", workID); got["workId"] != workID {
		t.Fatal("native subprocess did not show Work configuration", got)
	}
	for _, args := range [][]string{{"skills", "list"}, {"packages", "list"}} {
		if got := processCall(args...); len(got) == 0 {
			t.Fatal("native subprocess did not read catalog", args)
		}
	}
	if raw := call("work", "service", "list", workID); !strings.Contains(raw, "services") {
		t.Fatal("CLI service list did not use Go Core", raw)
	}
	if raw := call("work", "config", "show", workID); !strings.Contains(raw, workID) {
		t.Fatal("CLI config show omitted Work", raw)
	}
	if raw := call("status"); !strings.Contains(raw, `"status":"ready"`) && !strings.Contains(raw, `"ready":`) {
		t.Fatal("CLI status did not report the real Core", raw)
	}
	importCatalogSkillFixture(t, a)
	if raw := call("skills", "show", "catalog-skill"); !strings.Contains(raw, "catalog-skill") {
		t.Fatal("CLI did not show the imported independent Skill", raw)
	}
	agentsFile := filepath.Join(t.TempDir(), "AGENTS.md")
	if err := os.WriteFile(agentsFile, []byte("# Native CLI guidance\n"), 0600); err != nil {
		t.Fatal(err)
	}
	call("work", "config", "agents", "set", workID, "--file", agentsFile)
	call("work", "config", "skills", "set", workID, "--no-skills")
	call("work", "config", "packages", "set", workID, "--no-packages")
	if applied := decode(call("work", "config", "apply", workID, "--wait")); applied["state"] != "succeeded" {
		t.Fatal("CLI did not apply explicit empty selections", applied)
	}
	configuration := decode(call("work", "config", "show", workID))
	active, _ := configuration["active"].(map[string]any)
	if skills, ok := active["skills"].([]any); !ok || len(skills) != 0 || active["agentsMd"] != "# Native CLI guidance\n" {
		t.Fatal("native CLI Save/Apply did not load the intended configuration", configuration)
	}
	packageSource := t.TempDir()
	if err := os.WriteFile(filepath.Join(packageSource, "package.json"), []byte(`{"name":"native-cli-package","pi":{"prompts":["review.md"]}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(packageSource, "review.md"), []byte("Review the Work data."), 0600); err != nil {
		t.Fatal(err)
	}
	installed := call("work", "packages", "install", workID, packageSource, "--wait", "--verbose")
	if result := decode(installed); result["state"] != "succeeded" || strings.Contains(installed, packageSource) {
		t.Fatal("native CLI package install failed or exposed its source path", installed)
	}
	for _, args := range [][]string{
		{"work", "packages", "list", workID},
		{"work", "packages", "show", workID, "native-cli-package"},
		{"work", "packages", "disable", workID, "native-cli-package"},
		{"work", "packages", "enable", workID, "native-cli-package"},
		{"work", "packages", "remove", workID, "native-cli-package"},
	} {
		call(args...)
	}
	session := decode(call("session", "create", workID))
	sessionID, _ := session["sessionId"].(string)
	if sessionID == "" {
		t.Fatal("CLI session create omitted accepted ID", session)
	}
	if raw := call("session", "show", workID, sessionID); !strings.Contains(raw, sessionID) {
		t.Fatal("CLI could not read saved Session", raw)
	}
	if raw := call("session", "list", workID); !strings.Contains(raw, sessionID) {
		t.Fatal("CLI did not list its saved Session", raw)
	}
	conversation := call("chat", workID, "--session", sessionID, "--message", "Say hello")
	if !strings.Contains(conversation, `"type":"run"`) || !strings.Contains(conversation, `"sequence"`) {
		t.Fatal("CLI did not stream real SDK Run", conversation)
	}
	run := decode(strings.SplitN(conversation, "\n", 2)[0])
	runID, _ := run["runId"].(string)
	if runID == "" || !strings.Contains(call("run", "show", workID, runID), runID) ||
		!strings.Contains(call("run", "watch", workID, runID, "--after", "0"), `"sequence"`) {
		t.Fatal("native CLI could not revisit its completed Run", run)
	}
	created := processCall("work", "create", "--name", "CLI migration Work", "--idempotency-key", "cli-create-repeat", "--wait")
	newID, _ := created["workId"].(string)
	if newID == "" || created["state"] != "succeeded" {
		t.Fatal("CLI did not observe new Work", created)
	}
	if operationID, _ := created["operationId"].(string); operationID == "" ||
		processCall("operation", "show", operationID)["state"] != "succeeded" {
		t.Fatal("native CLI could not revisit accepted Work operation", created)
	}
	if replay := processCall("work", "create", "--name", "CLI migration Work", "--idempotency-key", "cli-create-repeat", "--wait"); replay["workId"] != newID || replay["operationId"] != created["operationId"] {
		t.Fatal("native CLI changed a repeated Work mutation", replay, created)
	}
	conflict := exec.Command(binary, "--core", base, "--json", "work", "create", "--name", "A different Work", "--idempotency-key", "cli-create-repeat")
	conflict.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+credential, "PATH=/nonexistent")
	output, err := conflict.CombinedOutput()
	var failed *exec.ExitError
	if !errors.As(err, &failed) || failed.ExitCode() != 6 {
		t.Fatal("native CLI did not report idempotency conflict", err, string(output))
	}
	stopped := processCall("work", "stop", newID, "--wait")
	if stopped["state"] != "succeeded" {
		t.Fatal("CLI did not observe stopped Work", stopped)
	}
	started := processCall("work", "start", newID, "--wait")
	if started["state"] != "succeeded" {
		t.Fatal("CLI did not observe restarted Work", started)
	}
	stopped = processCall("work", "stop", newID, "--wait")
	if stopped["state"] != "succeeded" {
		t.Fatal("CLI did not stop restarted Work", stopped)
	}
	if retried := processCall("work", "retry", newID, "--wait"); retried["state"] != "succeeded" {
		t.Fatal("CLI did not retry Work", retried)
	}
	if stopped := processCall("work", "stop", newID, "--wait"); stopped["state"] != "succeeded" {
		t.Fatal("CLI did not stop retried Work", stopped)
	}
	deleted := processCall("work", "delete", newID, "--wait")
	if deleted["state"] != "succeeded" {
		t.Fatal("CLI did not observe deleted Work", deleted)
	}
	logout := exec.Command(binary, "--core", base, "--json", "logout")
	logout.Env = loginProcess.Env
	if output, err := logout.CombinedOutput(); err != nil || !strings.Contains(string(output), `"loggedOut":true`) {
		t.Fatal("native CLI process logout failed", err, string(output))
	}
	if _, err := os.Stat(loginCredential); !os.IsNotExist(err) {
		t.Fatal("native CLI logout retained credential", err)
	}
}

func TestNativeUserCLIExportsInspectsAndImportsWorkThroughGoCore(t *testing.T) {
	_, base, authorization, workID, _ := nativeApplyFixture(t)
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (userclient.CredentialStore{Path: credential}).Save(userclient.Credential{Version: 1, CoreURL: base,
		Token: strings.TrimPrefix(authorization, "Bearer "), ExpiresAt: "2099-01-01T00:00:00Z",
		User: userclient.Identity{ID: "cli-test-user", Account: "admin", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
	_, source, _, _ := runtime.Caller(0)
	binary := filepath.Join(filepath.Dir(source), "..", "..", "dist", "go", "piwork-cli")
	if _, err := os.Stat(binary); err != nil {
		t.Fatal("make build-go is required for CLI package acceptance", err)
	}
	call := func(config string, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		process := exec.Command(binary, append([]string{"--core", base, "--json"}, args...)...)
		process.Env = append(os.Environ(), "PIWORK_CONFIG_PATH="+config, "PATH=/nonexistent")
		process.Stdout, process.Stderr = &stdout, &stderr
		if err := process.Run(); err != nil {
			t.Fatalf("CLI %v failed: %v: stdout=%s stderr=%s", args, err, stdout.String(), stderr.String())
		}
		var result map[string]any
		if json.Unmarshal(stdout.Bytes(), &result) != nil {
			t.Fatal("CLI did not return one JSON result", args, stdout.String())
		}
		return result
	}
	if stopped := call(credential, "work", "stop", workID, "--wait"); stopped["state"] != "succeeded" {
		t.Fatal("source Work did not stop", stopped)
	}
	output := filepath.Join(t.TempDir(), "portable.work")
	exported := call(credential, "work", "export", workID, "--output", output)
	if exported["snapshotId"] == "" || exported["digest"] == "" {
		t.Fatal("CLI export omitted snapshot identity", exported)
	}
	inspect := call(filepath.Join(t.TempDir(), "missing.json"), "work", "package", "inspect", output)
	if inspect["integrityVerified"] != true || inspect["installationValidated"] != false {
		t.Fatal("CLI offline inspect claimed target validation", inspect)
	}
	imported := call(credential, "work", "import", output, "--name", "CLI Imported Work", "--wait")
	importID, _ := imported["workId"].(string)
	if importID == "" || importID == workID || imported["state"] != "succeeded" {
		t.Fatal("CLI import did not create independent Work", imported)
	}
	if started := call(credential, "work", "start", importID, "--wait"); started["state"] != "succeeded" {
		t.Fatal("CLI did not start imported Work", started)
	}
	if show := call(credential, "work", "show", importID); show["id"] != importID {
		t.Fatal("imported Work cannot be read through CLI", show)
	}
}
