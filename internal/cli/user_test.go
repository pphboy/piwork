package cli

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/client"
)

func TestHelpAndUsageDoNotReadCredentials(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "credential"))
	for _, args := range [][]string{{"--help"}, {"work", "--help"}, {"work", "packages", "--help"}, {"--json", "work", "create", "--name"}} {
		var out, err bytes.Buffer
		code := runUser(args, &out, &err)
		if len(args) == 4 {
			if code != 2 || strings.Contains(err.String(), "credential") {
				t.Fatal("usage touched credentials", code, err.String())
			}
		} else if code != 0 || !strings.Contains(out.String(), "usage:") {
			t.Fatal("help failed", code, out.String(), err.String())
		}
	}
	for _, args := range [][]string{{"admin", "bootstrap"}, {"config", "set"}, {"users", "list"}} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 2 || strings.Contains(diagnostic.String(), "credential") {
			t.Fatal("operator command crossed into the user CLI", args, code, diagnostic.String())
		}
	}
}

func TestUserCLIStatusIdentityAndOfflineLogout(t *testing.T) {
	var logoutAllowed bool
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/healthz":
			if r.Header.Get("Authorization") != "" {
				t.Error("status sent bearer token")
			}
			json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
		case "/readyz":
			w.WriteHeader(503)
			json.NewEncoder(w).Encode(map[string]string{"code": "NOT_READY", "status": "unavailable"})
		case "/api/v1/me":
			if r.Header.Get("Authorization") != "Bearer secret-token" {
				t.Error("missing selected Core token")
			}
			json.NewEncoder(w).Encode(map[string]string{"id": "user-1", "account": "owner"})
		case "/api/v1/logout":
			if !logoutAllowed {
				w.WriteHeader(503)
				json.NewEncoder(w).Encode(map[string]string{"code": "UNAVAILABLE", "message": "offline"})
				return
			}
			w.WriteHeader(204)
		}
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	store := client.CredentialStore{Path: path}
	if err := store.Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "secret-token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	call := func(args ...string) (int, string) {
		t.Helper()
		var out, err bytes.Buffer
		code := runUser(args, &out, &err)
		return code, out.String() + err.String()
	}
	if code, output := call("status"); code != 5 || !strings.Contains(output, "unavailable") {
		t.Fatal("readiness contract", code, output)
	}
	if code, output := call("whoami"); code != 0 || !strings.Contains(output, "user-1") {
		t.Fatal("whoami contract", code, output)
	}
	if code, _ := call("logout"); code == 0 {
		t.Fatal("offline logout succeeded")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatal("offline logout removed credential", err)
	}
	logoutAllowed = true
	if code, output := call("logout"); code != 0 || !strings.Contains(output, "loggedOut") {
		t.Fatal("logout contract", code, output)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("logout retained credential", err)
	}
}

func TestSelectedCoreNeverReceivesAnotherCoresCredential(t *testing.T) {
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1,
		CoreURL: "http://127.0.0.1:7171/", Token: "private-token", ExpiresAt: "2099-01-01T00:00:00Z",
		User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	foreign := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("foreign Core received an authenticated request", r.Header.Get("Authorization"))
	}))
	defer foreign.Close()
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--core", foreign.URL, "whoami"}, &out, &diagnostic); code != 3 || !strings.Contains(diagnostic.String(), "log in") {
		t.Fatal(code, diagnostic.String())
	}
}

func TestFailedLoginPreservesSavedCredentialAndSendsNoOldBearer(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("login sent old bearer token")
		}
		w.WriteHeader(401)
		json.NewEncoder(w).Encode(map[string]string{"code": "INVALID_LOGIN", "message": "invalid login"})
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	store := client.CredentialStore{Path: path}
	old := client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "old-token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}
	if err := store.Save(old); err != nil {
		t.Fatal(err)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if _, err := writer.WriteString("wrong-password\n"); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	prior := os.Stdin
	os.Stdin = reader
	defer func() { os.Stdin = prior }()
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"login", "--account", "owner", "--password-stdin"}, &out, &diagnostic); code != 3 {
		t.Fatal("failed login exit", code, diagnostic.String())
	}
	got, err := store.Load()
	if err != nil || *got != old {
		t.Fatal("failed login changed credential", err)
	}
}

func TestWorkWaitObservesAcceptedOperationWithoutResubmitting(t *testing.T) {
	creates, polls := 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Authorization") != "Bearer work-token" {
			t.Error("Work request lost bearer")
		}
		switch r.URL.Path {
		case "/api/v1/works":
			creates++
			if r.Method != "POST" {
				t.Error("wrong Work method")
			}
			var body map[string]any
			if json.NewDecoder(r.Body).Decode(&body) != nil || body["name"] != "Demo" || body["idempotencyKey"] != "stable-key" {
				t.Error("invalid Work create request", body)
			}
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]string{"workId": "work-1", "operationId": "operation-1"})
		case "/api/v1/operations/operation-1":
			polls++
			state := "running"
			if polls > 1 {
				state = "succeeded"
			}
			json.NewEncoder(w).Encode(map[string]string{"operationId": "operation-1", "state": state})
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1,
		CoreURL: core.URL + "/", Token: "work-token", ExpiresAt: "2099-01-01T00:00:00Z",
		User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "work", "create", "--name", "Demo", "--idempotency-key", "stable-key", "--wait"}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	if creates != 1 || polls != 2 {
		t.Fatal("Work was resubmitted or not observed", creates, polls)
	}
	var observed map[string]any
	decoder := json.NewDecoder(&out)
	if err := decoder.Decode(&observed); err != nil || observed["state"] != "succeeded" {
		t.Fatal(out.String(), err)
	}
	if err := decoder.Decode(&observed); err == nil {
		t.Fatal("JSON output contains multiple values")
	}
}
