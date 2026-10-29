package diagnostics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestPerformanceSafeProjectionAndAcceptedIdentity(t *testing.T) {
	var output bytes.Buffer
	ctx := WithPerformanceWriter(WithPerformance(context.Background(), PerformanceIdentity{CorrelationID: "correlation-safe"}), &output)
	span := BeginPerformance(ctx, "create-request")
	BindPerformance(ctx, "work-safe-fixture", "operation-safe-fixture")
	span.End(errors.New("secret-token /private/file sha256:private"))
	span.End(nil)
	lines := strings.Split(strings.TrimSpace(output.String()), "\n")
	if len(lines) != 2 {
		t.Fatal("span must have one start and one terminal event", output.String())
	}
	var start, end map[string]any
	if json.Unmarshal([]byte(lines[0]), &start) != nil || json.Unmarshal([]byte(lines[1]), &end) != nil {
		t.Fatal(output.String())
	}
	if start["workId"] != nil || start["operationId"] != nil || end["workId"] != "work-safe-fixture" || end["operationId"] != "operation-safe-fixture" || end["outcome"] != "failed" || end["durationMs"].(float64) < 0 {
		t.Fatal(start, end)
	}
	for _, private := range []string{"secret-token", "/private/", "sha256:"} {
		if strings.Contains(output.String(), private) {
			t.Fatal("untrusted error escaped projection")
		}
	}
}

func TestPerformanceRejectsUnknownFieldsAndPreservesPhaseBoundary(t *testing.T) {
	var output bytes.Buffer
	ctx := WithPerformanceWriter(WithPerformance(context.Background(), PerformanceIdentity{CorrelationID: "correlation-safe", WorkID: "/private/work"}), &output)
	BeginPerformance(ctx, "secret /private/phase").End(nil)
	BeginPerformance(ctx, "image-inspection").EndCache(nil, "secret /private/cache", "")
	if strings.Contains(output.String(), "private") || strings.Contains(output.String(), "secret") {
		t.Fatal(output.String())
	}
	output.Reset()
	ready := BeginPerformance(ctx, "readiness-rpc")
	ready.End(nil)
	collect := BeginPerformance(ctx, "diagnostic-collection")
	time.Sleep(20 * time.Millisecond)
	collect.End(nil)
	var terminal []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var value map[string]any
		if json.Unmarshal([]byte(line), &value) == nil && value["outcome"] == "succeeded" {
			terminal = append(terminal, value)
		}
	}
	if len(terminal) != 2 || terminal[0]["phase"] != "readiness-rpc" || terminal[1]["phase"] != "diagnostic-collection" || terminal[1]["durationMs"].(float64) < 20 {
		t.Fatal(terminal)
	}
}

func TestStartupPerformanceRecordsCancellationWithoutPrivateError(t *testing.T) {
	var output bytes.Buffer
	ctx, cancel := context.WithCancel(WithPerformanceWriter(WithPerformance(context.Background(), PerformanceIdentity{CorrelationID: "startup-fixture-123456"}), &output))
	span := BeginPerformance(ctx, "image-export")
	cancel()
	span.End(errors.New("secret /private/path"))
	var events []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var event map[string]any
		if err := json.Unmarshal([]byte(line), &event); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if len(events) != 2 || events[0]["outcome"] != "started" || events[1]["outcome"] != "cancelled" || events[1]["durationMs"].(float64) < 0 || strings.Contains(output.String(), "private") || strings.Contains(output.String(), "secret") {
		t.Fatal("invalid interrupted startup metric", output.String())
	}
}
