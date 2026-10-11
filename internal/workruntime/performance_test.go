package workruntime

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
)

func TestReadinessTimingExcludesDelayedDiagnosticTransportAndPersistence(t *testing.T) {
	spec := fixtureContext(t)
	spec.CorrelationID = "correlation-performance-fixture"
	agent := agentIdentity(spec.Scope, spec.ContextID)
	labels := map[string]string{dockerengine.InstallationLabel: spec.Scope.InstallationID, dockerengine.ManagedLabel: "true", dockerengine.WorkLabel: spec.Scope.WorkID, dockerengine.KindLabel: "agent", dockerengine.LogicalLabel: "agentd"}
	for key, value := range agent.Labels {
		labels[key] = value
	}
	directory, err := os.MkdirTemp("", "piwork-performance-")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(directory)
	socket := filepath.Join(directory, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/_ping"):
			w.Header().Set("API-Version", "1.45")
			w.WriteHeader(200)
		case strings.HasSuffix(r.URL.Path, "/version"):
			json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.45", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"})
		case strings.HasSuffix(r.URL.Path, "/containers/json"):
			json.NewEncoder(w).Encode([]map[string]string{{"Id": "fixture-container"}})
		case strings.HasSuffix(r.URL.Path, "/containers/fixture-container/json"):
			json.NewEncoder(w).Encode(map[string]any{"Id": "fixture-container", "Config": map[string]any{"Labels": labels, "Tty": false}, "State": map[string]any{"Running": true}})
		case strings.HasSuffix(r.URL.Path, "/logs"):
			time.Sleep(80 * time.Millisecond)
			line, _ := json.Marshal(map[string]any{"timestamp": "1970-01-01T00:00:00Z", "component": "agentd", "stage": "package-load", "outcome": "succeeded", "code": "PACKAGE_LOAD_FAILED", "workId": spec.Scope.WorkID, "correlationId": spec.CorrelationID})
			line = append(line, '\n')
			header := make([]byte, 8)
			header[0] = 2
			binary.BigEndian.PutUint32(header[4:], uint32(len(line)))
			w.Write(header)
			w.Write(line)
		default:
			http.NotFound(w, r)
		}
	})}
	go server.Serve(listener)
	defer server.Close()
	endpoint, err := dockerengine.SelectEndpoint(dockerengine.SelectionOptions{DockerHost: "unix://" + socket, DockerConfig: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	engine, err := dockerengine.Connect(context.Background(), endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer engine.Close()
	docker, err := dockerengine.NewRuntime(engine, spec.Scope.InstallationID, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	var output bytes.Buffer
	ctx := diagnostics.WithPerformanceWriter(diagnostics.WithPerformance(context.Background(), diagnostics.PerformanceIdentity{CorrelationID: spec.CorrelationID}), &output)
	diagnostics.BeginPerformance(ctx, "readiness-rpc").End(nil)
	observed := 0
	spec.Observe = func(diagnostics.Event) error { observed++; time.Sleep(10 * time.Millisecond); return nil }
	if err := (&Runtime{Docker: docker}).collectInitializationDiagnostics(ctx, spec, agent, "fixture-container"); err != nil {
		t.Fatal(err)
	}
	diagnostics.BeginPerformance(ctx, "activation").End(nil)
	var ends []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(output.String()), "\n") {
		var event map[string]any
		if json.Unmarshal([]byte(line), &event) == nil && event["outcome"] == "succeeded" {
			ends = append(ends, event)
		}
	}
	if observed != 1 || len(ends) != 3 || ends[0]["phase"] != "readiness-rpc" || ends[1]["phase"] != "diagnostic-collection" || ends[2]["phase"] != "activation" || ends[1]["durationMs"].(float64) < 90 {
		t.Fatal(observed, ends)
	}
	if strings.Contains(output.String(), "1970-") {
		t.Fatal("relay time confused with original Agent event")
	}
}
