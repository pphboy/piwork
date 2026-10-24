package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"piwork/internal/client"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func historyTestServer(t *testing.T, body string, runs int, failAt int) (*client.Client, *int) {
	t.Helper()
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != "GET" {
			t.Error("history performed mutation", r.Method)
		}
		if r.URL.Path != "/api/v1/works/work-1/sessions/session-1/history" {
			t.Error("whole-session request", r.URL)
			http.NotFound(w, r)
			return
		}
		q := r.URL.Query()
		if value := q.Get("snapshot"); value != "" && value != "snapshot" {
			t.Error("changed snapshot", value)
		}
		if calls == failAt {
			w.WriteHeader(410)
			io.WriteString(w, `{"code":"HISTORY_CURSOR_EXPIRED","message":"fixture expired"}`)
			return
		}
		offset, _ := strconv.Atoi(q.Get("cursor"))
		var next any
		segments := []any{}
		summaries := []any{}
		if q.Get("content") == "runs" {
			end := min(runs, offset+50)
			for i := offset; i < end; i++ {
				summaries = append(summaries, map[string]any{"runId": fmt.Sprintf("run-%d", i), "workId": "work-1", "sessionId": "session-1", "submissionKey": fmt.Sprint(i), "promptDigest": "digest", "state": 4, "acceptedAt": "2026-10-23T00:00:00Z", "startedAt": "", "finishedAt": "", "earliestAvailableSequence": "1", "latestSequence": "1", "actualModel": nil, "thinkingLevel": "off", "source": map[string]string{"kind": "chat"}, "adoptedExperienceVersion": 0, "resultRef": nil})
			}
			if end < runs {
				next = strconv.Itoa(end)
			}
		} else if body != "" {
			end := min(len(body), offset+32*1024)
			segments = append(segments, map[string]any{"entryId": "entry-1", "entryOrder": 0, "role": "assistant", "runId": "", "blockId": "block-1", "blockIndex": 0, "blockCount": 1, "type": "text", "byteOffset": offset, "totalBytes": len(body), "text": body[offset:end], "complete": end == len(body)})
			if end < len(body) {
				next = strconv.Itoa(end)
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"contractVersion": 1, "session": map[string]any{"workId": "work-1", "sessionId": "session-1", "createdAt": "2026-10-23T00:00:00Z", "updatedAt": "2026-10-23T00:00:00Z", "modelPreference": nil, "thinkingLevel": "off", "source": map[string]string{"kind": "chat"}}, "snapshotId": "snapshot", "segments": segments, "runs": summaries, "nextCursor": next, "hasMore": next != nil})
	}))
	t.Cleanup(server.Close)
	api, _ := client.New(server.URL, "")
	return api, &calls
}

func TestSessionHistorySpoolsCompleteLargeValueAndAllRuns(t *testing.T) {
	temp := t.TempDir()
	t.Setenv("TMPDIR", temp)
	body := strings.Repeat("x", 7*1024*1024)
	api, calls := historyTestServer(t, body, 1005, 0)
	value, err := buildSessionHistory(context.Background(), api, "work-1", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	output := value.(*historyOutput)
	info, err := output.file.Stat()
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("spool permissions", info, err)
	}
	var out bytes.Buffer
	if _, err = output.WriteTo(&out); err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		Messages []struct{ Text string }
		Runs     []json.RawMessage
	}
	decoder := json.NewDecoder(&out)
	if decoder.Decode(&decoded) != nil || decoded.Messages[0].Text != body || len(decoded.Runs) != 1005 {
		t.Fatal("incomplete complete JSON", len(decoded.Messages), len(decoded.Runs))
	}
	if err = decoder.Decode(&value); err != io.EOF {
		t.Fatal("more than one JSON value", err)
	}
	entries, _ := os.ReadDir(temp)
	if len(entries) != 0 || *calls < 200 {
		t.Fatal("spool cleanup/pages", len(entries), *calls)
	}
}

func TestSessionHistoryPreservesImageDescriptorsAcrossPages(t *testing.T) {
	requests := 0
	summary := map[string]any{"runId": "run-1", "workId": "work-1", "sessionId": "session-1", "submissionKey": "image", "promptDigest": "digest", "state": 1, "acceptedAt": "2026-10-24T00:00:00Z", "startedAt": "", "finishedAt": "", "earliestAvailableSequence": "1", "latestSequence": "1", "actualModel": nil, "thinkingLevel": "off", "source": map[string]string{"kind": "chat"}, "adoptedExperienceVersion": 0, "resultRef": nil}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		q := r.URL.Query()
		if r.Method != "GET" || !strings.HasSuffix(r.URL.Path, "/history") || q.Get("imageProfile") != "chat-images-v1" {
			t.Error("missing read-only image profile", r.Method, r.URL)
		}
		if requests > 1 && q.Get("snapshot") != "snapshot" {
			t.Error("image pages changed snapshot")
		}
		segments := []any{}
		var next any
		if q.Get("content") != "runs" {
			part := func(block, kind, value string, index int) map[string]any {
				return map[string]any{"entryId": "run-1-user", "entryOrder": 0, "role": "user", "runId": "run-1", "blockId": block, "blockIndex": index, "blockCount": 3, "type": kind, "byteOffset": 0, "totalBytes": len(value), "text": value, "complete": true}
			}
			image := func(index int) map[string]any {
				p := part(fmt.Sprintf("run-1-image-%d", index), "image", "", index+1)
				p["image"] = map[string]any{"imageIndex": index, "mimeType": "image/png", "byteSize": 68, "sha256": strings.Repeat(strconv.Itoa(index+1), 64)}
				return p
			}
			if q.Get("cursor") == "" {
				segments = append(segments, part("run-1-user-0", "text", "look", 0), image(0))
				next = "second"
			} else {
				segments = append(segments, image(1))
			}
		}
		json.NewEncoder(w).Encode(map[string]any{"contractVersion": 1, "session": map[string]any{"workId": "work-1", "sessionId": "session-1", "createdAt": "2026-10-24T00:00:00Z", "updatedAt": "2026-10-24T00:00:00Z", "modelPreference": nil, "thinkingLevel": "off", "source": map[string]string{"kind": "chat"}}, "snapshotId": "snapshot", "segments": segments, "runs": []any{summary}, "nextCursor": next, "hasMore": next != nil})
	}))
	defer server.Close()
	api, _ := client.New(server.URL, "")
	output, err := buildSessionHistory(context.Background(), api, "work-1", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	var raw bytes.Buffer
	if _, err = output.(*historyOutput).WriteTo(&raw); err != nil {
		t.Fatal(err)
	}
	var value struct {
		Messages []struct {
			Text   string
			Blocks []struct {
				Type  string
				Image struct {
					ImageIndex       int
					MimeType, SHA256 string
					ByteSize         int
				}
			}
		}
	}
	if err = json.Unmarshal(raw.Bytes(), &value); err != nil || len(value.Messages) != 1 || len(value.Messages[0].Blocks) != 3 || requests != 3 {
		t.Fatal("incomplete image history", err, requests, raw.String())
	}
	message := value.Messages[0]
	if message.Text != "look" {
		t.Fatal("lost image prompt")
	}
	for i, block := range message.Blocks[1:] {
		if block.Type != "image" || block.Image.ImageIndex != i || block.Image.ByteSize != 68 || block.Image.MimeType != "image/png" || block.Image.SHA256 != strings.Repeat(strconv.Itoa(i+1), 64) {
			t.Fatal("changed image descriptor", block)
		}
	}
	if strings.Contains(raw.String(), `"data"`) {
		t.Fatal("image bytes entered public history")
	}
}

func TestLegacySessionHistoryExplainsCapabilityWithoutChangingStdout(t *testing.T) {
	for _, large := range []bool{false, true} {
		t.Run(fmt.Sprint(large), func(t *testing.T) {
			reads := 0
			body := `{"session":{"sessionId":"session-1"},"messages":[],"runs":[]}`
			if large {
				body = `{"messages":[{"text":"` + strings.Repeat("x", 2<<20) + `"}]}`
			}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error("legacy read mutated", r.Method)
				}
				if strings.HasSuffix(r.URL.Path, "/history-capabilities") {
					w.WriteHeader(501)
					io.WriteString(w, `{"code":"HISTORY_UNSUPPORTED","message":"Old Agent"}`)
					return
				}
				if r.URL.Path != "/api/v1/works/work-1/sessions/session-1" {
					t.Error("wrong read scope", r.URL)
				}
				reads++
				io.WriteString(w, body)
			}))
			defer server.Close()
			credentialPath := filepath.Join(t.TempDir(), "credentials", "client.json")
			t.Setenv("PIWORK_CONFIG_PATH", credentialPath)
			t.Setenv("PIWORK_CORE_URL", server.URL)
			if err := (client.CredentialStore{Path: credentialPath}).Save(client.Credential{Version: 1, CoreURL: server.URL, Token: "synthetic-history", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
				t.Fatal(err)
			}
			var stdout, stderr bytes.Buffer
			code := runUser([]string{"--json", "session", "show", "work-1", "session-1"}, &stdout, &stderr)
			if !strings.Contains(stderr.String(), "size limits") || !strings.Contains(stderr.String(), "Core and CLI") || !strings.Contains(stderr.String(), "Apply") || reads != 1 {
				t.Fatal("missing capability direction or repeated legacy reads", code, stderr.String(), reads)
			}
			if large {
				if code == 0 || stdout.Len() != 0 || !strings.Contains(stderr.String(), "RESPONSE_TOO_LARGE") || !strings.Contains(stderr.String(), "work-1/session-1") {
					t.Fatal("false complete legacy history", code, stdout.Len(), stderr.String())
				}
			} else if code != 0 || strings.TrimSpace(stdout.String()) != body {
				t.Fatal("legacy stdout changed", code, stdout.String(), stderr.String())
			}
		})
	}
}

func TestSessionHistoryFailuresCleanPrivateSpool(t *testing.T) {
	for _, mode := range []string{"page", "cancel", "stdout"} {
		t.Run(mode, func(t *testing.T) {
			temp := t.TempDir()
			t.Setenv("TMPDIR", temp)
			failAt := 0
			if mode == "page" {
				failAt = 2
			}
			api, _ := historyTestServer(t, strings.Repeat("x", 70000), 1, failAt)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if mode == "cancel" {
				cancel()
			}
			value, err := buildSessionHistory(ctx, api, "work-1", "session-1")
			if mode == "stdout" {
				if err != nil {
					t.Fatal(err)
				}
				_, err = value.(*historyOutput).WriteTo(failedHistoryWriter{})
				if !errors.Is(err, io.ErrClosedPipe) {
					t.Fatal(err)
				}
			} else {
				if err == nil || !strings.Contains(err.Error(), "work-1/session-1") {
					t.Fatal("missing original identity", err)
				}
				if mode == "cancel" && !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
			}
			entries, _ := filepath.Glob(filepath.Join(temp, "piwork-history-*"))
			if len(entries) != 0 {
				t.Fatal("leaked private spool", entries)
			}
		})
	}
}

type failedHistoryWriter struct{}

func (failedHistoryWriter) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }

func TestDesktopHistoryPlannerOnlyAllowsContractParameters(t *testing.T) {
	for _, query := range []string{"direction=older&limit=50", "snapshot=known&content=result&runId=run-1", "cursor=known&imageProfile=chat-images-v1"} {
		plan, handled, err := planDesktopControl(httptest.NewRequest("GET", "http://localhost/_desktop/api/works/work-1/sessions/session-1/history?"+query, nil))
		if err != nil || !handled || !strings.HasPrefix(plan.path, "/api/v1/works/work-1/") {
			t.Fatal(plan, handled, err)
		}
	}
	for _, query := range []string{"limit=101", "limit=1&limit=2", "snapshot=a&snapshot=b", "path=/var/private", "content=result", "responseProfile=unknown"} {
		_, _, err := planDesktopControl(httptest.NewRequest("GET", "http://localhost/_desktop/api/works/work-1/sessions/session-1/history?"+query, nil))
		if err == nil {
			t.Fatal("invalid allowed", query)
		}
	}
}

func TestSessionHistoryEmptyValue(t *testing.T) {
	api, _ := historyTestServer(t, "", 0, 0)
	value, err := buildSessionHistory(context.Background(), api, "work-1", "session-1")
	if err != nil {
		t.Fatal(err)
	}
	var out bytes.Buffer
	value.(*historyOutput).WriteTo(&out)
	var decoded struct{ Messages, Runs []json.RawMessage }
	if json.Unmarshal(out.Bytes(), &decoded) != nil || len(decoded.Messages) != 0 || len(decoded.Runs) != 0 {
		t.Fatal("empty history changed", out.String())
	}
}
func TestSessionHistoryInterruptDoesNotCancelRun(t *testing.T) {
	if os.Getenv("PIWORK_TEST_HISTORY_INTERRUPT_CHILD") == "1" {
		os.Exit(runUser([]string{"--json", "session", "show", "work-1", "session-1"}, os.Stdout, os.Stderr))
	}
	reading := make(chan struct{})
	var writes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			writes.Add(1)
			w.WriteHeader(405)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/history-capabilities") {
			io.WriteString(w, `{"contractVersion":1,"profile":"session-history-v1","responseProfile":"history-v1","defaultEntries":50,"maxEntries":100,"pageBytes":524288,"rpcBytes":1048576,"fragmentBytes":32768}`)
			return
		}
		close(reading)
		<-r.Context().Done()
	}))
	defer server.Close()
	path := filepath.Join(t.TempDir(), "credentials", "client.json")
	if err := (client.CredentialStore{Path: path}).Save(client.Credential{Version: 1, CoreURL: server.URL, Token: "fixture", ExpiresAt: "2099-01-01T00:00:00Z", User: client.Identity{ID: "owner", Account: "owner", Role: "user"}}); err != nil {
		t.Fatal(err)
	}
	temp := t.TempDir()
	child := nativeTestCommand(t, "-test.run=^TestSessionHistoryInterruptDoesNotCancelRun$")
	child.Env = append(os.Environ(), "PIWORK_TEST_HISTORY_INTERRUPT_CHILD=1", "PIWORK_CORE_URL="+server.URL, "PIWORK_CONFIG_PATH="+path, "TMPDIR="+temp)
	var output, diagnostic bytes.Buffer
	child.Stdout = &output
	child.Stderr = &diagnostic
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() { child.Process.Kill(); child.Wait() }()
	select {
	case <-reading:
	case <-time.After(5 * time.Second):
		t.Fatal("history read did not start")
	}
	if err := interruptTestProcess(child); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- child.Wait() }()
	select {
	case err := <-done:
		if errorCode(err) != 130 {
			t.Fatal("interrupt exit", err, diagnostic.String())
		}
	case <-time.After(5 * time.Second):
		t.Fatal("history read did not stop")
	}
	if output.Len() != 0 || writes.Load() != 0 {
		t.Fatal("read published partial JSON or cancelled a Run", output.Len(), writes.Load())
	}
	files, _ := filepath.Glob(filepath.Join(temp, "piwork-history-*"))
	if len(files) > 0 {
		t.Fatal("private spool leaked", files)
	}
}

func TestSessionHistoryBrokenStdoutPipeCleansSpool(t *testing.T) {
	if os.Getenv("PIWORK_TEST_HISTORY_PIPE_CHILD") == "1" {
		api, _ := client.New(os.Getenv("PIWORK_TEST_HISTORY_PIPE_CORE"), "")
		value, err := buildSessionHistory(context.Background(), api, "work-1", "session-1")
		if err != nil {
			os.Exit(2)
		}
		if _, err = value.(*historyOutput).WriteTo(os.Stdout); err != nil {
			os.Exit(1)
		}
		os.Exit(0)
	}
	api, _ := historyTestServer(t, strings.Repeat("x", 70000), 1, 0)
	temp := t.TempDir()
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	reader.Close()
	defer writer.Close()
	child := nativeTestCommand(t, "-test.run=^TestSessionHistoryBrokenStdoutPipeCleansSpool$")
	child.Env = append(os.Environ(), "PIWORK_TEST_HISTORY_PIPE_CHILD=1", "PIWORK_TEST_HISTORY_PIPE_CORE="+api.Base.String(), "TMPDIR="+temp)
	child.Stdout = writer
	var diagnostic bytes.Buffer
	child.Stderr = &diagnostic
	if err = child.Run(); errorCode(err) != 1 {
		t.Fatal("stdout pipe did not return an I/O error", err, diagnostic.String())
	}
	files, _ := filepath.Glob(filepath.Join(temp, "piwork-history-*"))
	if len(files) > 0 {
		t.Fatal("SIGPIPE leaked private spool", files)
	}
}
