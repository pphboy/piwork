package cli

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"piwork/internal/client"
	"reflect"
	"strings"
	"testing"
)

func TestWorkCreateTransmitsContextOverridesAndRetainsPreparationFailures(t *testing.T) {
	var captured map[string]any
	failure := ""
	mutations := 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "POST" && r.URL.Path == "/api/v1/works" {
			mutations++
			captured = nil
			if json.NewDecoder(r.Body).Decode(&captured) != nil {
				t.Error("bad request")
			}
			w.WriteHeader(202)
			io.WriteString(w, `{"workId":"work-1","operationId":"operation-1","reused":false}`)
			return
		}
		if r.Method == "GET" && r.URL.Path == "/api/v1/operations/operation-1" {
			json.NewEncoder(w).Encode(map[string]any{"workId": "work-1", "operationId": "operation-1", "state": "failed", "correlationId": "correlation-1", "result": nil, "error": map[string]any{"stage": "skill-load", "code": failure, "message": "Required context failed"}, "diagnostics": map[string]any{"stages": []any{map[string]any{"code": failure}}}})
			return
		}
		t.Error("unexpected request", r.Method, r.URL)
		w.WriteHeader(404)
	}))
	defer core.Close()
	directory := t.TempDir()
	credential := filepath.Join(directory, "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "private", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	agents := filepath.Join(directory, "AGENTS.md")
	config := filepath.Join(directory, "configuration.json")
	if err := os.WriteFile(agents, []byte("# 中文说明\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, []byte(`{"skills":["alpha"],"packages":[],"agentsMd":"from JSON"}`), 0600); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		name string
		args []string
		want map[string]any
	}{
		{"inherit", nil, map[string]any{}},
		{"skills", []string{"--skill", "alpha"}, map[string]any{"skills": []any{"alpha"}}},
		{"overrides", []string{"--agents-md-file", agents, "--base-image", "fixture/image"}, map[string]any{"agentsMd": "# 中文说明\n", "baseImage": "fixture/image"}},
		{"configuration", []string{"--config", config}, map[string]any{"configuration": map[string]any{"skills": []any{"alpha"}, "packages": []any{}, "agentsMd": "from JSON"}}},
		{"empty", []string{"--no-skills", "--no-packages"}, map[string]any{"skills": []any{}, "packages": []any{}}},
		{"package", []string{"--package", "tools"}, map[string]any{"packages": []any{map[string]any{"name": "tools", "enabled": true}}}},
	} {
		t.Run(item.name, func(t *testing.T) {
			before := mutations
			var out, diagnostic bytes.Buffer
			args := append([]string{"--json", "work", "create", "--name", "Demo", "--idempotency-key", "create-once"}, item.args...)
			if code := runUser(args, &out, &diagnostic); code != 0 || mutations != before+1 || !json.Valid(out.Bytes()) {
				t.Fatal(code, out.String(), diagnostic.String(), mutations)
			}
			if captured["name"] != "Demo" || captured["idempotencyKey"] != "create-once" {
				t.Fatal(captured)
			}
			delete(captured, "name")
			delete(captured, "idempotencyKey")
			if !reflect.DeepEqual(captured, item.want) {
				t.Fatal("override or omitted defaults changed", captured, item.want)
			}
		})
	}
	for _, code := range []string{"IMAGE_PULL_FAILED", "SKILL_LOAD_FAILED"} {
		failure = code
		before := mutations
		var out, diagnostic bytes.Buffer
		if exit := runUser([]string{"--json", "work", "create", "--name", "Bad context", "--wait"}, &out, &diagnostic); exit != 6 || mutations != before+1 || !json.Valid(out.Bytes()) || !strings.Contains(out.String(), code) || !strings.Contains(out.String(), "operation-1") {
			t.Fatal(exit, out.String(), diagnostic.String(), mutations)
		}
	}
}

func TestWorkCreateOptionsPreserveExplicitEmptyAndRejectConflicts(t *testing.T) {
	options, err := parseWorkCreateOptions([]string{"--name", "Demo", "--no-skills", "--no-packages", "--base-image", "sha256:fixture"})
	if err != nil || !options.skillsPresent || !options.packagesPresent || options.skills == nil || options.packages == nil || len(options.skills) != 0 || len(options.packages) != 0 {
		t.Fatal(options, err)
	}
	for _, args := range [][]string{
		{"--name", "Demo", "--skill", "alpha", "--no-skills"},
		{"--name", "Demo", "--package", "alpha", "--package", "alpha"},
		{"--name", "Demo", "--revision", "2"},
		{"--name", "Demo", "--config"},
	} {
		if _, err := parseWorkCreateOptions(args); err == nil {
			t.Fatal("invalid Work options accepted", args)
		}
	}
}
