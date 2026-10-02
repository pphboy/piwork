package cli

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"piwork/internal/client"
)

func TestPackageWaitInterruptKeepsAcceptedJob(t *testing.T) {
	if os.Getenv("PIWORK_TEST_PACKAGE_WAIT_CHILD") == "1" {
		os.Exit(runUser([]string{"--json", "work", "packages", "install", "work-1", "--from-core", "notes", "--wait", "--verbose"}, os.Stdout, os.Stderr))
	}
	var submissions, observations, cancellations atomic.Int32
	observed := make(chan struct{})
	var once sync.Once
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/works/work-1/packages":
			submissions.Add(1)
			w.WriteHeader(http.StatusAccepted)
			_, _ = io.WriteString(w, `{"workId":"work-1","operationId":"operation-1"}`)
		case "/api/v1/operations/operation-1":
			observations.Add(1)
			once.Do(func() { close(observed) })
			_, _ = io.WriteString(w, `{"operationId":"operation-1","state":"running","packagePhase":"prepare"}`)
		default:
			cancellations.Add(1)
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "package-token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	child := exec.Command(os.Args[0], "-test.run=^TestPackageWaitInterruptKeepsAcceptedJob$")
	child.Env = append(os.Environ(), "PIWORK_TEST_PACKAGE_WAIT_CHILD=1", "PIWORK_CONFIG_PATH="+credential, "PIWORK_CORE_URL="+core.URL)
	var stdout, stderr bytes.Buffer
	child.Stdout, child.Stderr = &stdout, &stderr
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if child.ProcessState == nil {
			_ = child.Process.Kill()
			_, _ = child.Process.Wait()
		}
	})
	select {
	case <-observed:
	case <-time.After(5 * time.Second):
		t.Fatal("package operation was not observed")
	}
	if err := child.Process.Signal(syscall.SIGINT); err != nil {
		t.Fatal(err)
	}
	finished := make(chan error, 1)
	go func() { finished <- child.Wait() }()
	select {
	case err := <-finished:
		if errorCode(err) != 130 {
			t.Fatal("interrupted CLI exit", err, stdout.String(), stderr.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("CLI did not stop waiting after SIGINT")
	}
	var result map[string]any
	if json.Unmarshal(stdout.Bytes(), &result) != nil || result["operationId"] != "operation-1" || result["state"] != "waiting" ||
		result["error"].(map[string]any)["code"] != "OPERATION_WAIT_INTERRUPTED" ||
		!strings.Contains(stderr.String(), "Package Operation operation-1 accepted") ||
		submissions.Load() != 1 || observations.Load() == 0 || cancellations.Load() != 0 {
		t.Fatal("interrupt did not preserve accepted job", result, stdout.String(), stderr.String(), submissions.Load(), observations.Load(), cancellations.Load())
	}
}

func TestPackageWaitFailureAndLostAuthorizationPreserveOperationID(t *testing.T) {
	for _, test := range []struct {
		name, response string
		status         int
		wantExit       int
		wantState      string
	}{
		{"failed", `{"operationId":"operation-1","state":"failed","packagePhase":"failed","error":{"stage":"prepare","code":"PACKAGE_PREPARE_FAILED","message":"secret /private/path"}}`, 200, 6, "failed"},
		{"authorization", `{"code":"AUTH_REQUIRED","message":"denied"}`, 401, 5, "waiting"},
	} {
		t.Run(test.name, func(t *testing.T) {
			core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/api/v1/works/work-1/packages":
					w.WriteHeader(202)
					_, _ = io.WriteString(w, `{"workId":"work-1","operationId":"operation-1"}`)
				case "/api/v1/operations/operation-1":
					w.WriteHeader(test.status)
					_, _ = io.WriteString(w, test.response)
				default:
					http.NotFound(w, r)
				}
			}))
			defer core.Close()
			credential := filepath.Join(t.TempDir(), "credentials", "client.json")
			t.Setenv("PIWORK_CONFIG_PATH", credential)
			if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "package-token",
				ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
				t.Fatal(err)
			}
			var stdout, stderr bytes.Buffer
			code := runUser([]string{"--json", "work", "packages", "install", "work-1", "--from-core", "notes", "--wait", "--verbose"}, &stdout, &stderr)
			var result map[string]any
			if code != test.wantExit || json.Unmarshal(stdout.Bytes(), &result) != nil || result["operationId"] != "operation-1" || result["state"] != test.wantState {
				t.Fatal("package observation result", code, stdout.String(), stderr.String())
			}
			if strings.Contains(stdout.String()+stderr.String(), "secret") || strings.Contains(stdout.String()+stderr.String(), "/private/path") {
				t.Fatal("package diagnostic leaked upstream text", stdout.String(), stderr.String())
			}
			if test.name == "failed" && !strings.Contains(stderr.String(), "stage=prepare code=PACKAGE_PREPARE_FAILED") {
				t.Fatal("safe terminal diagnostic missing", stderr.String())
			}
			if test.name == "authorization" && !strings.Contains(stderr.String(), "piwork-cli operation show operation-1") {
				t.Fatal("observation recovery command missing", stderr.String())
			}
		})
	}
}

func TestPackageWaitRetriesTemporaryObservationFailureWithoutResubmission(t *testing.T) {
	var submissions, observations atomic.Int32
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/works/work-1/packages":
			submissions.Add(1)
			w.WriteHeader(202)
			_, _ = io.WriteString(w, `{"workId":"work-1","operationId":"operation-1"}`)
		case "/api/v1/operations/operation-1":
			if observations.Add(1) == 1 {
				w.WriteHeader(503)
				_, _ = io.WriteString(w, `{"code":"CORE_UNAVAILABLE"}`)
				return
			}
			_, _ = io.WriteString(w, `{"operationId":"operation-1","state":"succeeded","packagePhase":"succeeded"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/", Token: "package-token",
		ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	started := time.Now()
	code := runUser([]string{"--json", "work", "packages", "install", "work-1", "--from-core", "notes", "--wait", "--verbose"}, &stdout, &stderr)
	var result map[string]any
	if code != 0 || json.Unmarshal(stdout.Bytes(), &result) != nil || result["state"] != "succeeded" ||
		submissions.Load() != 1 || observations.Load() != 2 || time.Since(started) < 250*time.Millisecond ||
		!strings.Contains(stderr.String(), "retry in 250ms") {
		t.Fatal("transient observation was not retried on original job", code, stdout.String(), stderr.String(), submissions.Load(), observations.Load())
	}
}

func TestPackageCommandSourceValidationBeforeCredentialIO(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "client.json"))
	for _, args := range [][]string{
		{"work", "packages", "install", "work-1", "--from-core", "name", "--verbose"},
		{"work", "packages", "install", "work-1", "--from-core", "name", "--idempotency-key", "caller-key"},
		{"work", "packages", "update", "work-1", "name", "--source", "npm:bad name"},
		{"work", "packages", "install", "work-1", "--from-core", "name", "--source", "npm:other"},
	} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 2 || strings.Contains(diagnostic.String(), "credential") {
			t.Fatal(code, diagnostic.String())
		}
	}
}

func TestLocalPackageStagesNativeZipAndObservesAcceptedJob(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"name":"example","pi":{"prompts":["review.md"]}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "review.md"), []byte("Review the result."), 0600); err != nil {
		t.Fatal(err)
	}
	uploads, installs, polls := 0, 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/v1/works/work-1/package-uploads":
			uploads++
			body, _ := io.ReadAll(r.Body)
			if r.Header.Get("X-Piwork-Package-Source") != "local" || len(body) < 30 || r.Header.Get("X-Piwork-Sha256") == "" {
				t.Error("package ZIP not staged", r.Header, len(body))
			}
			json.NewEncoder(w).Encode(map[string]string{"uploadId": "upload-1"})
		case "/api/v1/works/work-1/packages":
			installs++
			var input map[string]any
			if json.NewDecoder(r.Body).Decode(&input) != nil {
				t.Error("invalid package request")
			}
			source, _ := input["source"].(map[string]any)
			if source["kind"] != "upload" || source["uploadId"] != "upload-1" {
				t.Error("wrong uploaded source", source)
			}
			w.WriteHeader(202)
			json.NewEncoder(w).Encode(map[string]any{"operationId": "operation-1", "scope": "work"})
		case "/api/v1/operations/operation-1":
			polls++
			json.NewEncoder(w).Encode(map[string]string{"operationId": "operation-1", "state": "succeeded", "packagePhase": "succeeded"})
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
	if code := runUser([]string{"work", "packages", "install", "work-1", directory, "--wait", "--verbose"}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	if uploads != 1 || installs != 1 || polls != 1 || !strings.Contains(diagnostic.String(), "phase=succeeded") || strings.Contains(diagnostic.String(), directory) {
		t.Fatal("package workflow incomplete", uploads, installs, polls, diagnostic.String())
	}
}

func TestPackageCommandsPreserveRemoteAndCoreSourcesWithFreshKeys(t *testing.T) {
	var requests []map[string]any
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer package-token" ||
			r.URL.Path != "/api/v1/works/work-1/packages" && r.URL.Path != "/api/v1/works/work-1/packages/tools/update" {
			t.Error("unexpected package request", r.Method, r.URL.Path)
			w.WriteHeader(404)
			return
		}
		var input map[string]any
		if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
			t.Error(err)
		}
		requests = append(requests, input)
		w.WriteHeader(202)
		_ = json.NewEncoder(w).Encode(map[string]string{"operationId": "operation-package"})
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/",
		Token: "package-token", ExpiresAt: "2099-01-01T00:00:00Z",
		User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{
		{"--json", "work", "packages", "install", "work-1", "npm:tools@latest"},
		{"--json", "work", "packages", "install", "work-1", "git:github.com/example/tools@main"},
		{"--json", "work", "packages", "install", "work-1", "--from-core", "tools"},
		{"--json", "work", "packages", "update", "work-1", "tools", "--from-core"},
	} {
		var output, diagnostic bytes.Buffer
		if code := runUser(args, &output, &diagnostic); code != 0 {
			t.Fatal(args, code, diagnostic.String())
		}
		var accepted map[string]any
		if json.Unmarshal(output.Bytes(), &accepted) != nil || accepted["operationId"] != "operation-package" {
			t.Fatal("package command lost accepted operation", args, output.String())
		}
	}
	if len(requests) != 4 {
		t.Fatal("package requests were not submitted", len(requests))
	}
	keys := map[string]bool{}
	uuidV4 := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	for _, request := range requests {
		key, _ := request["idempotencyKey"].(string)
		if !uuidV4.MatchString(key) || keys[key] {
			t.Fatal("package mutation reused or omitted its idempotency key", key)
		}
		keys[key] = true
	}
	for index, kind := range []string{"npm", "git", "core", "core"} {
		source, _ := requests[index]["source"].(map[string]any)
		if source["kind"] != kind {
			t.Fatal("package source changed", index, source)
		}
	}
}

func TestPackageZipStagesOriginalArchive(t *testing.T) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	file, err := archive.Create("package.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := io.WriteString(file, `{"name":"zip-example","version":"1.0.0"}`); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "source.zip")
	if err := os.WriteFile(path, buffer.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	uploads, installs := 0, 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/works/work-1/package-uploads":
			uploads++
			body, _ := io.ReadAll(r.Body)
			if r.Header.Get("X-Piwork-Package-Source") != "zip" || !bytes.Equal(body, buffer.Bytes()) {
				t.Error("ZIP archive changed during upload")
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"uploadId": "zip-upload"})
		case "/api/v1/works/work-1/packages":
			installs++
			var input map[string]any
			_ = json.NewDecoder(r.Body).Decode(&input)
			source, _ := input["source"].(map[string]any)
			if source["kind"] != "upload" || source["uploadId"] != "zip-upload" {
				t.Error("ZIP upload ID was not used", source)
			}
			w.WriteHeader(202)
			_ = json.NewEncoder(w).Encode(map[string]string{"operationId": "operation-zip"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer core.Close()
	credential := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", credential)
	if err := (client.CredentialStore{Path: credential}).Save(client.Credential{Version: 1, CoreURL: core.URL + "/",
		Token: "package-token", ExpiresAt: "2099-01-01T00:00:00Z",
		User: client.Identity{ID: "user-1", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	var output, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "work", "packages", "install", "work-1", path}, &output, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	if uploads != 1 || installs != 1 {
		t.Fatal("ZIP source was not installed through its uploaded archive", uploads, installs)
	}
}
