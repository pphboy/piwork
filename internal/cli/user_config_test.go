package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestConfigSelectionExplicitEmptyAndInvalidCombination(t *testing.T) {
	command, err := parseUserConfig([]string{"skills", "set", "work-1", "--no-skills"})
	if err != nil {
		t.Fatal(err)
	}
	input := command.input.(map[string]any)
	if got, ok := input["skills"].([]string); !ok || got == nil || len(got) != 0 {
		t.Fatal("explicit empty skills lost", input)
	}
	for _, args := range [][]string{
		{"skills", "set", "work-1", "--skill", "alpha", "--no-skills"},
		{"packages", "set", "work-1", "--package", "alpha", "--package", "alpha"},
		{"set", "work-1", "--config", "file", "--revision", "1"},
	} {
		if err := validateUserConfig(args); err == nil {
			t.Fatal("invalid config selection accepted", args)
		}
	}
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "client.json"))
	for _, args := range [][]string{
		{"work", "config", "packages", "set", "work-1", "--package", "alpha", "--package", "alpha"},
		{"work", "config", "packages", "set", "work-1", "--package", "alpha", "--no-packages"},
		{"work", "config", "set", "work-1", "--config", "missing.json", "--revision", "1"},
	} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 2 || strings.Contains(diagnostic.String(), "credential") || strings.Contains(diagnostic.String(), "missing.json") {
			t.Fatal("invalid config accessed credentials or files", args, code, diagnostic.String())
		}
	}
}

func TestConfigApplyWaitFailureKeepsOneEnvelopeAndRecoveryID(t *testing.T) {
	for _, mode := range []string{"failed", "superseded", "offline"} {
		t.Run(mode, func(t *testing.T) {
			mutations, polls := 0, 0
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					mutations++
					w.WriteHeader(202)
					io.WriteString(w, `{"workId":"work-1","operationId":"operation-apply"}`)
					return
				}
				polls++
				if mode == "offline" {
					w.WriteHeader(503)
					io.WriteString(w, `{"code":"UNAVAILABLE","message":"offline"}`)
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "operationId": "operation-apply", "state": mode,
					"error":       map[string]any{"stage": "skill-load", "code": "SKILL_LOAD_FAILED", "message": "Skill could not load"},
					"diagnostics": map[string]any{"stage": "skill-load", "code": "SKILL_LOAD_FAILED"}})
			}))
			defer core.Close()
			path := filepath.Join(t.TempDir(), "credentials", "client.json")
			t.Setenv("PIWORK_CONFIG_PATH", path)
			if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
				t.Fatal(err)
			}
			var out, diagnostic bytes.Buffer
			code := runUser([]string{"--json", "work", "config", "apply", "work-1", "--wait"}, &out, &diagnostic)
			want := 6
			if mode == "offline" {
				want = 5
			}
			var result map[string]any
			if code != want || !json.Valid(out.Bytes()) || json.Unmarshal(out.Bytes(), &result) != nil || mutations != 1 || polls != 1 || result["workId"] != "work-1" || result["operationId"] != "operation-apply" || !strings.Contains(diagnostic.String(), "operation") {
				t.Fatal(code, out.String(), diagnostic.String(), mutations, polls)
			}
			if mode == "offline" && result["state"] != "waiting" {
				t.Fatal(result)
			}
			if mode != "offline" && result["diagnostics"] == nil {
				t.Fatal("structured diagnostic lost", result)
			}
		})
	}
}

func TestWorkObservationDeadlineCancelsInflightRequest(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	defer core.Close()
	api, _ := client.New(core.URL, "token")
	start := time.Now()
	value, err := observeUserOperationWithin(context.Background(), api, map[string]any{"workId": "work-1", "operationId": "operation-1"}, io.Discard, 40*time.Millisecond)
	if err == nil || time.Since(start) > time.Second || value.(map[string]any)["state"] != "waiting" || value.(map[string]any)["operationId"] != "operation-1" {
		t.Fatal(value, err)
	}
}

func TestConfigCommandsUseDesiredRoutesAndApplyOnce(t *testing.T) {
	var saves, applies, polls int
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/works/work-1/configuration/skills":
			saves++
			if r.Method != "PUT" {
				t.Error("wrong skills method")
			}
			var input map[string]json.RawMessage
			if json.NewDecoder(r.Body).Decode(&input) != nil || string(input["skills"]) != "[]" {
				t.Error("empty skills not transmitted", input)
			}
			w.Write([]byte(`{"desiredRevision":2,"loadedRevision":1}`))
		case "/api/v1/works/work-1/configuration/apply":
			applies++
			w.WriteHeader(202)
			w.Write([]byte(`{"workId":"work-1","operationId":"operation-1"}`))
		case "/api/v1/operations/operation-1":
			polls++
			w.Write([]byte(`{"operationId":"operation-1","state":"succeeded"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"work", "config", "skills", "set", "work-1", "--no-skills"},
		{"work", "config", "apply", "work-1", "--wait"},
	} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 0 {
			t.Fatal(code, diagnostic.String())
		}
	}
	if saves != 1 || applies != 1 || polls != 1 {
		t.Fatal("config workflow duplicated request", saves, applies, polls)
	}
}

func TestConfigAndAgentCommandsPreservePendingAndLoadedViews(t *testing.T) {
	var desiredRevision, loadedRevision int = 1, 1
	var savedAgents string
	var savedConfig map[string]any
	var calls []string
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		calls = append(calls, r.Method+" "+r.URL.Path)
		switch r.URL.Path {
		case "/api/v1/skills", "/api/v1/packages":
			_, _ = w.Write([]byte(`{"items":[]}`))
		case "/api/v1/works/work-1/configuration":
			if r.Method == http.MethodPut {
				var input map[string]any
				if json.NewDecoder(r.Body).Decode(&input) != nil {
					t.Error("invalid config JSON")
				}
				savedConfig, _ = input["configuration"].(map[string]any)
				desiredRevision++
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "desiredRevision": desiredRevision,
				"loadedRevision": loadedRevision, "pendingApply": desiredRevision != loadedRevision})
		case "/api/v1/works/work-1/configuration/agents":
			if r.Method == http.MethodPut {
				var input map[string]string
				_ = json.NewDecoder(r.Body).Decode(&input)
				savedAgents = input["agentsMd"]
				desiredRevision++
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"agentsMd": savedAgents, "desiredRevision": desiredRevision, "loadedRevision": loadedRevision})
		case "/api/v1/works/work-1/configuration/packages":
			var input map[string]json.RawMessage
			_ = json.NewDecoder(r.Body).Decode(&input)
			if string(input["packages"]) != "[]" {
				t.Error("explicit empty packages changed", input)
			}
			desiredRevision++
			_ = json.NewEncoder(w).Encode(map[string]any{"desiredRevision": desiredRevision, "loadedRevision": loadedRevision})
		case "/api/v1/works/work-1/configuration/apply":
			loadedRevision = desiredRevision
			w.WriteHeader(202)
			_, _ = w.Write([]byte(`{"workId":"work-1","operationId":"operation-apply"}`))
		case "/api/v1/operations/operation-apply":
			_, _ = w.Write([]byte(`{"operationId":"operation-apply","state":"succeeded"}`))
		case "/api/v1/operations/operation-failed":
			_, _ = w.Write([]byte(`{"operationId":"operation-failed","state":"failed","error":{"code":"SAFE_FAILURE"}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	configFile := filepath.Join(t.TempDir(), "config.json")
	agentsFile := filepath.Join(t.TempDir(), "AGENTS.md")
	if err := os.WriteFile(configFile, []byte(`{"mcpServers":[],"packages":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(agentsFile, []byte("# Work guidance\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	call := func(args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		if code := runUser(append([]string{"--json"}, args...), &stdout, &stderr); code != 0 {
			t.Fatal(args, code, stderr.String())
		}
		var result map[string]any
		if json.Unmarshal(stdout.Bytes(), &result) != nil {
			t.Fatal("invalid CLI JSON", stdout.String())
		}
		return result
	}
	call("skills", "list")
	call("packages", "list")
	call("work", "config", "set", "work-1", "--config", configFile)
	call("work", "config", "packages", "set", "work-1", "--no-packages")
	call("work", "config", "agents", "set", "work-1", "--file", agentsFile)
	if got := call("work", "config", "show", "work-1"); got["pendingApply"] != true || got["loadedRevision"] == got["desiredRevision"] {
		t.Fatal("Save silently applied desired configuration", got)
	}
	if got := call("work", "config", "agents", "show", "work-1"); got["agentsMd"] != "# Work guidance\n" {
		t.Fatal("AGENTS.md content changed", got)
	}
	if got := call("work", "config", "apply", "work-1", "--wait"); got["state"] != "succeeded" {
		t.Fatal("Apply did not finish", got)
	}
	if got := call("work", "config", "show", "work-1"); got["pendingApply"] != false || got["loadedRevision"] != got["desiredRevision"] {
		t.Fatal("Apply did not expose loaded state", got)
	}
	if got := call("operation", "show", "operation-failed"); got["state"] != "failed" {
		t.Fatal("failed Operation could not be inspected", got)
	}
	if savedAgents != "# Work guidance\n" || savedConfig == nil || !strings.Contains(strings.Join(calls, "\n"), "POST /api/v1/works/work-1/configuration/apply") {
		t.Fatal("configuration commands missed expected Core routes", savedAgents, savedConfig, calls)
	}
}
