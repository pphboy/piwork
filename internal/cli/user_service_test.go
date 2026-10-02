package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestServiceCommandsValidateBeforeCredentialRead(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "credential"))
	for _, args := range [][]string{
		{"work", "service", "create", "work-1", "service-1"},
		{"work", "service", "update", "work-1", "service-1"},
		{"work", "service", "show", "work-1"},
		{"work", "service", "show", "work-1", ""},
		{"work", "service", "show", "work-1", " "},
		{"work", "service", "show", "work-1", "-service"},
		{"work", "service", "show", "work-1", "service\x00"},
		{"work", "service", "show", "work-1", "service-1", "extra"},
		{"work", "service", "logs", "work-1", "service-1", "--tail", "0"},
		{"work", "service", "logs", "work-1", "service-1", "--tail", "201"},
		{"work", "service", "start", "work-1", "service-1", "--wait", "--wait"},
		{"work", "service", "start", "work-1", "service-1", "--idempotency-key", " "},
		{"work", "service", "start", "work-1", "service-1", "--idempotency-key", "first", "--idempotency-key", "second"},
		{"work", "service", "logs", "work-1", "service-1", "--follow"},
	} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 2 || out.Len() != 0 || strings.Contains(diagnostic.String(), "credential") {
			t.Fatal(code, diagnostic.String())
		}
	}
}

func TestServiceMetadataProjectionDropsDefinitionsAndSorts(t *testing.T) {
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		service := func(name, id string) map[string]any {
			return map[string]any{"name": name, "serviceId": id, "observedState": "failed", "enabled": true,
				"desiredRevision": 2, "definition": map[string]string{"password": "never-output"}, "extra": "never-output",
				"lastError": map[string]any{"code": "SAFE_FAILURE", "message": "Service unavailable password=never-output Bearer never-output /tmp/secrets/never-output", "retryable": true, "private": "never-output"},
				"endpoints": []any{map[string]any{"name": "web", "protocol": "tcp", "host": "svc-app", "port": 8080, "private": "never-output"}},
				"access": map[string]any{"hostname": "app.w-a1b2c3d4.work", "status": "unavailable", "private": "never-output",
					"ports": []any{map[string]any{"name": "web", "port": 8080, "url": "http://app.w-a1b2c3d4.work:8080/", "private": "never-output"}}}}
		}
		if strings.HasSuffix(r.URL.Path, "/services") {
			json.NewEncoder(w).Encode(map[string]any{"services": []any{service("zeta", "service-z"), service("alpha", "service-a")}, "extra": "never-output"})
		} else {
			json.NewEncoder(w).Encode(service("alpha", "service-a"))
		}
	}))
	defer core.Close()
	api, _ := client.New(core.URL, "token")
	for _, args := range [][]string{{"list", "work-1"}, {"show", "work-1", "service-a"}} {
		value, err := runUserService(context.Background(), api, args, io.Discard)
		raw, _ := json.Marshal(value)
		if err != nil || strings.Contains(string(raw), "never-output") || strings.Contains(string(raw), "definition") {
			t.Fatal(value, err)
		}
		if args[0] == "list" {
			services := value.(map[string]any)["services"].([]map[string]any)
			if services[0]["name"] != "alpha" || len(services[0]) != 11 || services[0]["appliedRevision"] != nil {
				t.Fatal(services)
			}
		}
	}
}

func TestServiceObservationRetainsIDsAndBoundsInflightPoll(t *testing.T) {
	for _, mode := range []string{"failed", "superseded", "unauthorized", "malformed", "unrelated", "stalled"} {
		t.Run(mode, func(t *testing.T) {
			polls := 0
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				polls++
				switch mode {
				case "unauthorized":
					w.WriteHeader(401)
					io.WriteString(w, `{"code":"AUTH_REQUIRED","message":"Login required"}`)
				case "malformed":
					io.WriteString(w, "invalid")
				case "unrelated":
					io.WriteString(w, `{"operationId":"other","workId":"work-1","state":"succeeded"}`)
				case "stalled":
					<-r.Context().Done()
				default:
					json.NewEncoder(w).Encode(map[string]any{"operationId": "operation-1", "workId": "work-1", "state": mode,
						"error": map[string]string{"code": "SAFE_FAILURE"}, "additionalPublicField": true})
				}
			}))
			defer core.Close()
			api, _ := client.New(core.URL, "token")
			accepted := map[string]any{"workId": "work-1", "serviceId": "service-1", "operationId": "operation-1", "correlationId": "correlation-1", "reused": true}
			start := time.Now()
			output, err := observeCLIService(context.Background(), api, serviceCommand{workID: "work-1", serviceID: "service-1"}, accepted, 40*time.Millisecond)
			value := output.(map[string]any)
			if err == nil || polls != 1 || time.Since(start) > time.Second || value["correlationId"] != "correlation-1" || value["serviceId"] != "service-1" {
				t.Fatal(output, err, polls)
			}
			for _, field := range []string{"result", "error", "diagnostics"} {
				if _, exists := value[field]; !exists {
					t.Fatal("missing output field", field, output)
				}
			}
			if mode == "failed" || mode == "superseded" {
				if value["state"] != mode || value["additionalPublicField"] != true {
					t.Fatal(output)
				}
			} else if value["state"] != "waiting" || value["result"] != nil || value["diagnostics"] != nil {
				t.Fatal(output)
			}
			if mode == "stalled" && value["error"].(map[string]any)["code"] != "OPERATION_WAIT_TIMEOUT" {
				t.Fatal(output)
			}
		})
	}
}

func TestServiceLogsOutputAndAuthorizationFailures(t *testing.T) {
	mode, status, requests, tail := "available", 200, 0, ""
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		tail = r.URL.Query().Get("tailLines")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		if status != 200 {
			io.WriteString(w, `{"code":"SAFE_REJECTION","message":"Request rejected"}`)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"serviceId": "service-1", "status": mode, "text": "safe logs", "truncated": mode == "truncated", "collectedAt": "2026-10-02T00:00:00Z"})
	}))
	defer core.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: core.URL, Token: "secret-token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		mode string
		json bool
		want int
		tail string
	}{
		{"available", false, 0, "100"}, {"truncated", false, 0, "1"}, {"unavailable", false, 5, "200"}, {"unavailable", true, 5, "100"},
	} {
		mode = item.mode
		var out, diagnostic bytes.Buffer
		args := []string{"work", "service", "logs", "work-1", "service-1", "--tail", item.tail}
		if item.mode == "available" {
			args = args[:5]
		}
		if item.json {
			args = append([]string{"--json"}, args...)
		}
		if code := runUser(args, &out, &diagnostic); code != item.want || tail != item.tail {
			t.Fatal(code, out.String(), diagnostic.String(), tail)
		}
		if !item.json && ((mode == "unavailable" && out.Len() != 0) || (mode != "unavailable" && out.String() != "safe logs\n")) {
			t.Fatal(out.String())
		}
		if mode == "truncated" && !strings.Contains(diagnostic.String(), "truncated") {
			t.Fatal(diagnostic.String())
		}
		if item.json && !json.Valid(out.Bytes()) {
			t.Fatal(out.String())
		}
	}
	for _, failure := range []struct{ status, exit int }{{401, 3}, {403, 3}, {404, 4}, {409, 6}, {503, 5}} {
		status = failure.status
		before := requests
		var out, diagnostic bytes.Buffer
		if code := runUser([]string{"--json", "work", "service", "stop", "work-1", "service-1"}, &out, &diagnostic); code != failure.exit || out.Len() != 0 || requests != before+1 || strings.Contains(diagnostic.String(), "secret-token") {
			t.Fatal(code, out.String(), diagnostic.String(), requests)
		}
	}
}

func TestServiceMutationObservesExactWorkOperationAndNeverResubmits(t *testing.T) {
	mutations, polls := 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/works/work-1/services/service-1/enable":
			mutations++
			var input map[string]string
			if json.NewDecoder(r.Body).Decode(&input) != nil || input["idempotencyKey"] != "same-key" {
				t.Error("wrong idempotency key", input)
			}
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]string{"workId": "work-1", "serviceId": "service-1", "operationId": "operation-1"})
		case "/api/v1/operations/operation-1":
			polls++
			json.NewEncoder(w).Encode(map[string]string{"workId": "work-1", "operationId": "operation-1", "state": "succeeded"})
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
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "work", "service", "start", "work-1", "service-1", "--idempotency-key", "same-key", "--wait"}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	if mutations != 1 || polls != 1 || !strings.Contains(out.String(), `"serviceId":"service-1"`) {
		t.Fatal("service observation mismatch", mutations, polls, out.String())
	}
}
