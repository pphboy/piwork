package coreoperator

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"piwork/internal/coreapp"
	"piwork/internal/identity"

	"golang.org/x/sys/unix"
)

const fixturePassword = "operator-fixture-password"

type forbiddenReader struct{}

func (forbiddenReader) Read([]byte) (int, error) { panic("syntax/help read secret input") }
func call(t *testing.T, args []string, input io.Reader, fallback string) (int, string, string) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	code := run(context.Background(), args, input, &stdout, &stderr, nil, fallback)
	return code, stdout.String(), stderr.String()
}
func singleJSON(t *testing.T, output string) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(output))
	var value map[string]any
	if decoder.Decode(&value) != nil {
		t.Fatal("stdout was not one JSON object", output)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		t.Fatal("stdout contained extra output")
	}
	return value
}
func refusedEndpoint(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	endpoint := "http://" + listener.Addr().String()
	address := listener.Addr().String()
	listener.Close()
	// Listener close may briefly reset an arriving connection before the
	// kernel reports refusal. Establish the fixture's precondition first.
	deadline := time.Now().Add(time.Second)
	for {
		connection, err := net.DialTimeout("tcp", address, 100*time.Millisecond)
		if connection != nil {
			connection.Close()
		}
		if errors.Is(err, syscall.ECONNREFUSED) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("could not establish refused loopback fixture")
		}
		time.Sleep(5 * time.Millisecond)
	}
	return endpoint
}
func TestHelpAndInvalidCommandsDoNoFileSecretOrNetworkIO(t *testing.T) {
	directory := t.TempDir()
	badEnv := filepath.Join(directory, "missing.env")
	for _, args := range [][]string{
		{"--env-file", badEnv, "--help"}, {"--operator-credential-file", "/missing", "config", "--help"},
		{"--env-file", badEnv, "--version"},
	} {
		code, stdout, stderr := call(t, args, forbiddenReader{}, "http://invalid")
		if code != 0 || stdout == "" || stderr != "" {
			t.Fatal(args, code, stdout, stderr)
		}
	}
	for _, args := range [][]string{
		{"login"}, {"chat"}, {"--json", "--json", "status"}, {"--core"}, {"status", "extra"},
		{"admin", "bootstrap", "--password-stdin"},
		{"admin", "bootstrap", "--account", "admin", "--account", "other"},
		{"admin", "users", "create", "--account", "admin", "--role", "root"},
		{"admin", "users", "disable", "../other"},
		{"config", "set", "--agent-image", "fixture", "--model-provider", "fixture", "--model", "one", "--api-key-stdin", "--api-key-file", "missing"},
		{"config", "set", "--agent-image", "fixture", "--model-provider", "fixture", "--model", "one", "--model-base-url", "http://remote.example", "--api-key-stdin"},
		{"config", "default-work", "set", "--package", "a", "--no-packages"},
		{"config", "default-work", "set", "--skill", "a", "--skill", "a"},
		{"config", "default-work", "set", "--package", "A"},
		{"--json", "serve"},
	} {
		args = append([]string{"--env-file", badEnv}, args...)
		code, stdout, stderr := call(t, args, forbiddenReader{}, "http://invalid")
		if code != 2 || stdout != "" || stderr == "" {
			t.Fatal(args, code, stdout, stderr)
		}
	}
	if entries, _ := os.ReadDir(directory); len(entries) != 0 {
		t.Fatal("validation created files")
	}
}
func TestOfflineBootstrapConfigurationRepeatAndLockProtection(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "core")
	fallback := refusedEndpoint(t)
	args := []string{"admin", "bootstrap", "--data-dir", directory, "--account", "admin", "--password-stdin", "--json"}
	code, stdout, stderr := call(t, args, strings.NewReader(fixturePassword+"\n"), fallback)
	if code != 0 || stderr != "" || singleJSON(t, stdout)["account"] != "admin" {
		t.Fatal(code, stdout, stderr)
	}
	userID := singleJSON(t, stdout)["userId"]
	code, stdout, stderr = call(t, args, strings.NewReader("other-fixture-password"), fallback)
	if code != 6 || stdout != "" || !strings.Contains(stderr, "CONFLICT") {
		t.Fatal(code, stdout, stderr)
	}
	config := []string{"--data-dir", directory, "--json", "config", "set", "--agent-image", "fixture/native", "--model-provider", "fixture", "--model", "first", "--api-key-stdin"}
	code, stdout, stderr = call(t, config, strings.NewReader("private-model-key\n"), fallback)
	if code != 0 || stderr != "" || singleJSON(t, stdout)["configured"] != true || strings.Contains(stdout, "private-model-key") {
		t.Fatal(code, stdout, stderr)
	}
	a, err := coreapp.New(context.Background(), coreapp.Options{DataDirectory: directory})
	if err != nil {
		t.Fatal(err)
	}
	defer closeApp(t, a)
	users, err := a.Identity.ListUsers(context.Background(), identity.OperatorPrincipal())
	if err != nil || len(users) != 1 || string(users[0].Id) != userID {
		t.Fatal("repeated bootstrap replaced identity", users, err)
	}
	if _, err := a.Identity.Login(context.Background(), "admin", fixturePassword, "fixture"); err != nil {
		t.Fatal("password was overwritten", err)
	}
	first, _, err := a.Settings.LoadRuntime()
	if err != nil || first.Model.ID != "first" {
		t.Fatal(first, err)
	}
	code, stdout, stderr = call(t, config, strings.NewReader("changed-key"), fallback)
	if code != 6 || stdout != "" || !strings.Contains(stderr, "another Core") {
		t.Fatal("offline writer ignored Core lock", code, stdout, stderr)
	}
	second, _, err := a.Settings.LoadRuntime()
	if err != nil || second.Revision != first.Revision || second.Model.CredentialRef != first.Model.CredentialRef {
		t.Fatal("offline writer modified locked defaults", err)
	}
}
func closeApp(t *testing.T, a *coreapp.Application) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
}
func TestOnlineOperatorUsesSeparateCredentialAndPublicOutput(t *testing.T) {
	directory := t.TempDir()
	a, err := coreapp.New(context.Background(), coreapp.Options{DataDirectory: directory, DependencyCheck: func(context.Context, *coreapp.Application, coreapp.RuntimeProfile) error { return nil }})
	if err != nil {
		t.Fatal(err)
	}
	defer closeApp(t, a)
	// This transport unit test models an administrator-maintained empty package default;
	// actual native brain preparation is exercised in Core integration tests.
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES('piwork_brain_seeded','{\"seeded\":true}','fixture')")
		return err
	}); err != nil {
		t.Fatal(err)
	}

	address, err := a.Listen(coreapp.ListenAddress{Host: "127.0.0.1"})
	if err != nil {
		t.Fatal(err)
	}
	globals := []string{"--data-dir", directory, "--core", address.URL(), "--json"}
	invoke := func(args []string, secret string) (int, map[string]any, string) {
		code, out, err := call(t, append(append([]string(nil), globals...), args...), strings.NewReader(secret), "http://invalid")
		if strings.Contains(out+err, fixturePassword) || strings.Contains(out+err, "private-api-key") {
			t.Fatal("secret leaked")
		}
		if out == "" {
			return code, nil, err
		}
		return code, singleJSON(t, out), err
	}
	if code, body, stderr := invoke([]string{"admin", "bootstrap", "--account", "admin", "--password-stdin"}, fixturePassword); code != 0 || body["account"] != "admin" || stderr != "" {
		t.Fatal(code, body, stderr)
	}
	if code, body, stderr := invoke([]string{"config", "set", "--agent-image", "fixture/native", "--model-provider", "fixture", "--model", "first", "--api-key-stdin"}, "private-api-key"); code != 0 || body["configured"] != true || stderr != "" {
		t.Fatal(code, body, stderr)
	}
	if code, body, stderr := invoke([]string{"config", "default-work", "set", "--no-packages"}, ""); code != 0 || stderr != "" {
		t.Fatal(code, body, stderr)
	}

	if code, body, stderr := invoke([]string{"status"}, ""); code != 0 || body["ready"] != true || stderr != "" {
		t.Fatal(code, body, stderr)
	}
	if code, body, stderr := invoke([]string{"config", "show"}, ""); code != 0 || body["model"] == nil || stderr != "" {
		t.Fatal(code, body, stderr)
	}
	if code, body, stderr := invoke([]string{"config", "default-work", "set", "--no-skills"}, ""); code != 0 || len(body["configuration"].(map[string]any)["skills"].([]any)) != 0 || stderr != "" {
		t.Fatal("operator default Work update failed", code, body, stderr)
	}
	if code, body, stderr := invoke([]string{"config", "default-work", "show"}, ""); code != 0 || len(body["configuration"].(map[string]any)["skills"].([]any)) != 0 || stderr != "" {
		t.Fatal("operator default Work read failed", code, body, stderr)
	}
	code, user, stderr := invoke([]string{"admin", "users", "create", "--account", "reader", "--password-stdin"}, fixturePassword)
	if code != 0 || user["role"] != "user" || stderr != "" {
		t.Fatal(code, user, stderr)
	}
	id := user["id"].(string)
	for _, action := range []string{"disable", "enable"} {
		if code, _, stderr := invoke([]string{"admin", "users", action, id}, ""); code != 0 || stderr != "" {
			t.Fatal(code, stderr)
		}
	}
	if code, _, stderr := invoke([]string{"admin", "users", "reset-credential", id, "--password-stdin"}, "replacement-fixture-password"); code != 0 || stderr != "" {
		t.Fatal(code, stderr)
	}
	if code, body, stderr := invoke([]string{"admin", "users", "list"}, ""); code != 0 || len(body["users"].([]any)) != 2 || stderr != "" {
		t.Fatal(code, body, stderr)
	}
	// A user CLI-looking file is never read implicitly, nor treated as operator.
	userCredential := filepath.Join(t.TempDir(), "client.json")
	os.WriteFile(userCredential, []byte(`{"token":"user-token"}`), 0600)
	var out, diagnostic bytes.Buffer
	code = run(context.Background(), []string{"--core", address.URL(), "admin", "users", "list"}, forbiddenReader{}, &out, &diagnostic, []string{"PIWORK_CONFIG_PATH=" + userCredential}, "http://invalid")
	if code != 2 || out.Len() != 0 {
		t.Fatal("borrowed user credential", code, out.String())
	}
}
func TestUnknownMutationOutcomeDoesNotReplayOrWriteOffline(t *testing.T) {
	var mutations atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" {
			mutations.Add(1)
			connection, _, _ := w.(http.Hijacker).Hijack()
			connection.Close()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"state":"READY","ready":true}`)
	}))
	defer server.Close()
	directory := t.TempDir()
	os.Chmod(directory, 0700)
	credential := filepath.Join(directory, "operator.credential")
	os.WriteFile(credential, []byte(strings.Repeat("e", 64)+"\n"), 0600)
	args := []string{"--data-dir", directory, "--json", "config", "set", "--agent-image", "fixture/native", "--model-provider", "fixture", "--model", "first", "--api-key-stdin"}
	code, stdout, stderr := call(t, args, strings.NewReader("private-api-key"), server.URL)
	if code != 5 || stdout != "" || mutations.Load() != 1 || strings.Contains(stderr, "private-api-key") {
		t.Fatal(code, stdout, stderr, mutations.Load())
	}
	if entries, _ := os.ReadDir(directory); len(entries) != 1 {
		t.Fatal("lost mutation response caused local initialization")
	}
}
func TestDefaultWorkPatchPreservesOmittedFieldsWithoutReadMergeWrite(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Method != "PUT" || r.URL.Path != "/control/default-work" {
			t.Error("unexpected read/route")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		patch := body["patch"].(map[string]any)
		if len(patch) != 2 || len(patch["skills"].([]any)) != 0 || len(patch["packages"].([]any)) != 0 {
			t.Error("patch rewrote omitted fields", patch)
		}
		io.WriteString(w, `{"configuration":null}`)
	}))
	defer server.Close()
	parent := t.TempDir()
	os.Chmod(parent, 0700)
	credential := filepath.Join(parent, "operator.key")
	os.WriteFile(credential, []byte(strings.Repeat("f", 64)), 0600)
	code, stdout, stderr := call(t, []string{"--core", server.URL, "--operator-credential-file", credential, "--json", "config", "default-work", "set", "--no-skills", "--no-packages"}, forbiddenReader{}, "http://invalid")
	if code != 0 || stderr != "" || requests.Load() != 1 || singleJSON(t, stdout)["configuration"] != nil {
		t.Fatal(code, stdout, stderr)
	}
}
func TestProtectedFileAndSecretInputLimitsDoNotLeakValues(t *testing.T) {
	parent := t.TempDir()
	os.Chmod(parent, 0700)
	file := filepath.Join(parent, "key")
	os.WriteFile(file, []byte("private-value"), 0600)
	if data, err := protectedFile(file, 100); err != nil || string(data) != "private-value" {
		t.Fatal(err)
	}
	for _, kind := range []string{"link", "fifo", "public"} {
		path := filepath.Join(parent, kind)
		switch kind {
		case "link":
			os.Symlink(file, path)
		case "fifo":
			unix.Mkfifo(path, 0600)
		case "public":
			os.WriteFile(path, []byte("private-value"), 0644)
		}
		if _, err := protectedFile(path, 100); err == nil {
			t.Fatal("accepted unsafe input", kind)
		}
	}
	if _, err := readSecret(context.Background(), strings.NewReader(strings.Repeat("s", secretBytes+1)), io.Discard, true, ""); err == nil || strings.Contains(err.Error(), "ssss") {
		t.Fatal("unbounded secret or error leaked value")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	var out, diagnostic bytes.Buffer
	if code := run(ctx, []string{"status"}, forbiddenReader{}, &out, &diagnostic, nil, "http://invalid"); code != 130 || out.Len() != 0 {
		t.Fatal(code)
	}
}
func TestHTTPFailuresUseStatusExitCodeAndNeverEchoUntrustedDiagnostics(t *testing.T) {
	for _, fixture := range []struct{ status, exit int }{{401, 3}, {403, 3}, {409, 6}, {502, 7}, {503, 7}, {504, 7}, {500, 1}} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(fixture.status)
			io.WriteString(w, "private-secret-and-host-path")
		}))
		code, stdout, stderr := call(t, []string{"--core", server.URL, "--json", "status"}, forbiddenReader{}, "http://invalid")
		server.Close()
		if code != fixture.exit || stdout != "" || stderr == "" || strings.Contains(stderr, "private-secret-and-host-path") {
			t.Fatal(fixture, code, stdout, stderr)
		}
	}
}
