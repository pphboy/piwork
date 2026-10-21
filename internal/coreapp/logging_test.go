package coreapp

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/diagnostics"
)

func readCoreLogRecords(t *testing.T, directory string) []map[string]any {
	t.Helper()
	names, err := filepath.Glob(filepath.Join(directory, "logs", "core", "core-*.jsonl"))
	if err != nil || len(names) == 0 {
		t.Fatalf("core log shards missing: %v %v", names, err)
	}
	var records []map[string]any
	for _, name := range names {
		file, err := os.Open(name)
		if err != nil {
			t.Fatal(err)
		}
		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64<<10), 128<<10)
		for scanner.Scan() {
			var record map[string]any
			if err := json.Unmarshal(scanner.Bytes(), &record); err != nil {
				file.Close()
				t.Fatalf("invalid log record: %v", err)
			}
			records = append(records, record)
		}
		if err := scanner.Err(); err != nil {
			file.Close()
			t.Fatal(err)
		}
		file.Close()
	}
	return records
}

func TestCoreLogFilesCaptureDiagnosticsAndLifecycleOnly(t *testing.T) {
	directory := t.TempDir()
	var stderr bytes.Buffer
	a, err := New(context.Background(), Options{DataDirectory: directory, Stdout: io.Discard, Stderr: &stderr})
	if err != nil {
		t.Fatal(err)
	}
	diagnostics.WriteSink(a.consoleStderr(), a.diagnosticSink(), diagnostics.Event{
		Component: "core", Stage: "readiness", Outcome: "failed", Code: "AGENT_EXITED",
	}, "work-000000000000001", "operation-000000000000001", "correlation-1")
	log.Print("piwork: synthetic standard log")
	a.RecordAppEvent("app.listening", "info", map[string]string{"url": "http://127.0.0.1:17891"})
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	started := time.Now()
	if err := a.Close(ctx); err != nil {
		t.Fatal(err)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("log finalization exceeded the shutdown budget: %v", elapsed)
	}
	if !strings.Contains(stderr.String(), `"stage":"readiness"`) {
		t.Fatalf("console diagnostic format changed: %s", stderr.String())
	}
	records := readCoreLogRecords(t, directory)
	var diagnostic, standard, listening, shutdown map[string]any
	for _, record := range records {
		switch record["event"] {
		case "diagnostic.readiness":
			diagnostic = record
		case "app.log":
			if strings.Contains(record["message"].(string), "synthetic standard log") {
				standard = record
			}
		case "app.listening":
			listening = record
		case "app.shutdown":
			shutdown = record
		}
	}
	if diagnostic == nil || diagnostic["workId"] != "work-000000000000001" || diagnostic["operationId"] != "operation-000000000000001" {
		t.Fatalf("diagnostic identity missing: %#v", diagnostic)
	}
	fields, _ := diagnostic["fields"].(map[string]any)
	if fields["stage"] != "readiness" || fields["outcome"] != "failed" || fields["code"] != "AGENT_EXITED" {
		t.Fatalf("diagnostic fields missing: %#v", diagnostic)
	}
	if standard == nil || standard["component"] != "app" || standard["level"] != "info" {
		t.Fatalf("standard log not wrapped: %#v", standard)
	}
	if listening == nil || listening["message"] == "" {
		t.Fatalf("listening event missing: %#v", listening)
	}
	if strings.Contains(mustJSON(t, listening), "dataDirectory") || strings.Contains(mustJSON(t, listening), directory) {
		t.Fatal("listening file projection leaked the data directory")
	}
	if shutdown == nil || records[len(records)-1]["event"] != "app.shutdown" {
		t.Fatalf("final shutdown diagnostics were not persisted last: %#v", records)
	}
	if strings.Contains(mustJSON(t, records), "agent-secret-output") {
		t.Fatal("unmanaged agent text entered the global log")
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}
