package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"piwork/internal/client"
)

func logCredential(t *testing.T, coreURL string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	t.Setenv("PIWORK_CONFIG_PATH", path)
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: coreURL, Token: "token", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "user-1", Account: "admin", Role: "admin"}}); err != nil {
		t.Fatal(err)
	}
}

func TestLogsHelpAndSyntaxFailBeforeCredentialIO(t *testing.T) {
	t.Setenv("PIWORK_CONFIG_PATH", filepath.Join(t.TempDir(), "missing", "credential"))
	for _, args := range [][]string{
		{"logs"},
		{"logs", "export", "--output", "-"},
		{"logs", "export", "extra"},
		{"logs", "export", "--output"},
		{"logs", "show"},
		{"logs", "show", "short"},
		{"logs", "download", "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},
		{"logs", "download", "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "--output", "x.zip", "extra"},
		{"logs", "show", "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "--output", "x.zip"},
		{"logs", "export", "--idempotency-key", "x", "--idempotency-key", "y"},
		{"logs", "export", "--follow"},
	} {
		var out, diagnostic bytes.Buffer
		if code := runUser(args, &out, &diagnostic); code != 2 || out.Len() != 0 || strings.Contains(diagnostic.String(), "credential") {
			t.Fatalf("%v: %d %q", args, code, diagnostic.String())
		}
	}
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"logs", "export", "--help"}, &out, &diagnostic); code != 0 || !strings.Contains(out.String(), "logs export") {
		t.Fatalf("logs help: %d", code)
	}
}

func TestLogsExportDownloadsVerifiedArchiveOnce(t *testing.T) {
	archive := []byte("PK\x03\x04 verified export bytes")
	sum := sha256.Sum256(archive)
	digest := hex.EncodeToString(sum[:])
	var posts, polls, downloads atomic.Int64
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/v1/log-exports":
			posts.Add(1)
			w.WriteHeader(202)
			io.WriteString(w, `{"exportId":"log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","correlationId":"c","cutoffTime":"2026-10-21T00:00:00Z","state":"collecting","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"reused":false}`)
		case r.Method == http.MethodGet && r.URL.Path == "/api/v1/log-exports/log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":
			polls.Add(1)
			state := "collecting"
			complete := "null"
			result := "null"
			if polls.Load() >= 2 {
				state = "ready"
				complete = "true"
				result = `{"filename":"piwork-logs.zip","size":` + strconv.Itoa(len(archive)) + `,"digest":"` + digest + `","readyAt":"2026-10-21T00:00:01Z","expiresAt":"2026-10-22T00:00:01Z"}`
			}
			io.WriteString(w, `{"exportId":"log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","correlationId":"c","cutoffTime":"2026-10-21T00:00:00Z","state":"`+state+`","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"createdAt":"2026-10-21T00:00:00Z","updatedAt":"2026-10-21T00:00:00Z","progress":{"processedSources":0,"totalSources":0,"collectedBytes":0},"complete":`+complete+`,"warningCount":0,"warnings":[],"warningsTruncated":false,"result":`+result+`,"error":null,"cleanupPending":false}`)
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/content"):
			downloads.Add(1)
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", strconv.Itoa(len(archive)))
			w.Header().Set("X-Piwork-SHA256", digest)
			w.Write(archive)
		default:
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer core.Close()
	logCredential(t, core.URL)
	output := filepath.Join(t.TempDir(), "export.zip")
	var stdout, stderr bytes.Buffer
	code := runUser([]string{"--json", "logs", "export", "--output", output}, &stdout, &stderr)
	if code != 0 || posts.Load() != 1 || downloads.Load() != 1 {
		t.Fatalf("export failed: %d posts=%d downloads=%d stderr=%s", code, posts.Load(), downloads.Load(), stderr.String())
	}
	var result map[string]any
	decoder := json.NewDecoder(bytes.NewReader(stdout.Bytes()))
	if err := decoder.Decode(&result); err != nil {
		t.Fatal(err)
	}
	if decoder.More() {
		t.Fatal("stdout contained more than one JSON value")
	}
	if result["exportId"] != "log-export-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" || result["digest"] != digest || result["complete"] != true || result["path"] != output {
		t.Fatalf("unexpected JSON result: %v", result)
	}
	raw, err := os.ReadFile(output)
	if err != nil || !bytes.Equal(raw, archive) {
		t.Fatalf("archive not published: %v", err)
	}
	info, err := os.Stat(output)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("archive permissions: %v", info)
	}

	// An existing target must be rejected before any mutation.
	before := posts.Load()
	if code := runUser([]string{"logs", "export", "--output", output}, io.Discard, io.Discard); code != 2 || posts.Load() != before {
		t.Fatalf("existing output accepted: %d", code)
	}
}

func TestLogsObservationRetriesAndFailedTasksExposeIDs(t *testing.T) {
	failures := 0
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(202)
			io.WriteString(w, `{"exportId":"log-export-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","correlationId":"c","cutoffTime":"2026-10-21T00:00:00Z","state":"collecting","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"reused":false}`)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/content") {
			t.Fatal("failed task downloaded content")
		}
		failures++
		if failures == 1 {
			w.WriteHeader(503)
			io.WriteString(w, `{"code":"LOG_EXPORT_STORAGE_UNAVAILABLE","message":"busy","retryable":true}`)
			return
		}
		io.WriteString(w, `{"exportId":"log-export-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","state":"failed","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"cutoffTime":"2026-10-21T00:00:00Z","createdAt":"2026-10-21T00:00:00Z","updatedAt":"2026-10-21T00:00:01Z","progress":{"processedSources":0,"totalSources":0,"collectedBytes":0},"complete":null,"warningCount":0,"warnings":[],"warningsTruncated":false,"result":null,"error":{"code":"LOG_EXPORT_TIMEOUT","message":"timed out","correlationId":"c"},"cleanupPending":false}`)
	}))
	defer core.Close()
	logCredential(t, core.URL)
	var stdout, stderr bytes.Buffer
	code := runUser([]string{"--json", "logs", "export", "--output", filepath.Join(t.TempDir(), "x.zip")}, &stdout, &stderr)
	if code != 6 {
		t.Fatalf("failed task exit: %d %s", code, stderr.String())
	}
	if failures < 2 || !strings.Contains(stderr.String(), "retrying") {
		t.Fatal("transient observation was not retried")
	}
	var envelope map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &envelope); err != nil || envelope["exportId"] == "" {
		t.Fatalf("failed JSON envelope missing ID: %s", stdout.String())
	}

	failures = 1
	stdout.Reset()
	stderr.Reset()
	if code := runUser([]string{"logs", "show", "log-export-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}, &stdout, &stderr); code != 0 || !strings.Contains(stdout.String(), "State: failed") {
		t.Fatalf("show failed task: %d %s", code, stderr.String())
	}
}

func TestLogsDownloadRejectsCorruptContentAndPreservesTarget(t *testing.T) {
	archive := []byte("archive-bytes")
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/content") {
			w.Header().Set("Content-Type", "application/zip")
			w.Header().Set("Content-Length", strconv.Itoa(len(archive)))
			w.Header().Set("X-Piwork-SHA256", strings.Repeat("0", 64))
			w.Write(archive)
			return
		}
		io.WriteString(w, `{"exportId":"log-export-cccccccccccccccccccccccccccccccc","state":"ready","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"cutoffTime":"2026-10-21T00:00:00Z","createdAt":"2026-10-21T00:00:00Z","updatedAt":"2026-10-21T00:00:01Z","progress":{"processedSources":0,"totalSources":0,"collectedBytes":0},"complete":true,"warningCount":0,"warnings":[],"warningsTruncated":false,"result":{"filename":"piwork-logs.zip","size":`+strconv.Itoa(len(archive))+`,"digest":"`+strings.Repeat("1", 64)+`","readyAt":"2026-10-21T00:00:01Z","expiresAt":"2026-10-22T00:00:01Z"},"error":null,"cleanupPending":false}`)
	}))
	defer core.Close()
	logCredential(t, core.URL)
	output := filepath.Join(t.TempDir(), "corrupt.zip")
	var stdout, stderr bytes.Buffer
	if code := runUser([]string{"logs", "download", "log-export-cccccccccccccccccccccccccccccccc", "--output", output}, &stdout, &stderr); code == 0 {
		t.Fatal("corrupt download succeeded")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatal("corrupt download left a final file")
	}
}

func TestLogsCorruptContent503ThenShowOriginalFailure(t *testing.T) {
	const id = "log-export-94949494949494949494949494949494"
	failed := false
	core := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			t.Error("recovery submitted a new task")
			w.WriteHeader(400)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/content") {
			failed = true
			w.WriteHeader(503)
			io.WriteString(w, `{"code":"LOG_EXPORT_CONTENT_UNAVAILABLE","message":"content unavailable","retryable":true}`)
			return
		}
		state, result, taskError := "ready", `{"filename":"logs.zip","size":12,"digest":"`+strings.Repeat("a", 64)+`","readyAt":"2026-10-21T00:00:01Z","expiresAt":"2099-10-21T00:00:01Z"}`, `null`
		if failed {
			state, result, taskError = "failed", "null", `{"code":"LOG_EXPORT_CONTENT_UNAVAILABLE","message":"content unavailable","correlationId":"c"}`
		}
		io.WriteString(w, `{"exportId":"`+id+`","cutoffTime":"2026-10-21T00:00:00Z","state":"`+state+`","scope":{"includeCoreLogs":true,"ownedWorkCount":0,"sourceCount":0},"createdAt":"2026-10-21T00:00:00Z","updatedAt":"2026-10-21T00:00:01Z","progress":{"processedSources":0,"totalSources":0,"collectedBytes":0},"complete":true,"warningCount":0,"warnings":[],"warningsTruncated":false,"result":`+result+`,"error":`+taskError+`,"cleanupPending":false}`)
	}))
	defer core.Close()
	logCredential(t, core.URL)
	target := filepath.Join(t.TempDir(), "logs.zip")
	var out, diagnostic bytes.Buffer
	if code := runUser([]string{"--json", "logs", "download", id, "--output", target}, &out, &diagnostic); code != 5 {
		t.Fatal(code, diagnostic.String())
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("503 published a final file")
	}
	out.Reset()
	diagnostic.Reset()
	if code := runUser([]string{"--json", "logs", "show", id}, &out, &diagnostic); code != 0 {
		t.Fatal(code, diagnostic.String())
	}
	var view map[string]any
	if err := json.Unmarshal(out.Bytes(), &view); err != nil || view["state"] != "failed" || view["result"] != nil || view["exportId"] != id {
		t.Fatal(out.String(), err)
	}
}
