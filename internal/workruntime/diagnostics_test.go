package workruntime

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"piwork/internal/agentclient"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
)

func TestInitializationCollectionRetainsCauseAndBoundsSlowUntrustedLogs(t *testing.T) {
	for _, kind := range []string{"recognized", "unknown", "unavailable", "slow", "incompatible", "legacy"} {
		t.Run(kind, func(t *testing.T) {
			spec := fixtureContext(t)
			spec.CorrelationID = "operation-diagnostic-fixture"
			var events []diagnostics.Event
			spec.Observe = func(e diagnostics.Event) error { events = append(events, e); return nil }
			directory, err := os.MkdirTemp("/tmp", "piwork-diag-")
			if err != nil {
				t.Fatal(err)
			}
			defer os.RemoveAll(directory)
			socket := filepath.Join(directory, "engine.sock")
			listener, err := net.Listen("unix", socket)
			if err != nil {
				t.Fatal(err)
			}
			labels := map[string]string{dockerengine.InstallationLabel: spec.Scope.InstallationID, dockerengine.ManagedLabel: "true", dockerengine.WorkLabel: spec.Scope.WorkID, dockerengine.KindLabel: "agent", dockerengine.LogicalLabel: "agentd", "piwork.generation": "1", "piwork.instance_id": spec.Scope.InstanceID, "piwork.protocol_version": "v2", "piwork.context_identity": spec.ContextID}
			server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch {
				case strings.HasSuffix(r.URL.Path, "/_ping"):
					w.Header().Set("API-Version", "1.45")
					w.WriteHeader(200)
				case strings.HasSuffix(r.URL.Path, "/version"):
					_ = json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.45", "MinAPIVersion": "1.44", "Os": "linux", "Arch": "amd64"})
				case strings.HasSuffix(r.URL.Path, "/containers/json"):
					_ = json.NewEncoder(w).Encode([]map[string]string{{"Id": "fixture-container"}})
				case strings.HasSuffix(r.URL.Path, "/containers/fixture-container/json"):
					_ = json.NewEncoder(w).Encode(map[string]any{"Id": "fixture-container", "Config": map[string]any{"Labels": labels, "Tty": false}, "State": map[string]any{"Running": false, "ExitCode": 17}})
				case strings.HasSuffix(r.URL.Path, "/logs"):
					if r.URL.Query().Get("tail") != "200" || r.URL.Query().Get("follow") == "1" {
						t.Error("unbounded log request", r.URL.RawQuery)
					}
					if kind == "slow" {
						<-r.Context().Done()
						return
					}
					if kind == "unavailable" || kind == "incompatible" {
						w.WriteHeader(500)
						_, _ = w.Write([]byte(`{"message":"password-secret /private/file"}`))
						return
					}
					text := "unknown password-secret /private/file\n"
					if kind == "legacy" {
						text = "invalid Work Skill descriptor password-secret /private/file\n"
					}
					if kind == "recognized" {
						text = `{"component":"agentd","stage":"mcp-initialize","outcome":"failed","code":"MCP_INITIALIZATION_FAILED","workId":"work-1","correlationId":"operation-diagnostic-fixture","message":"password-secret /private/file"}` + "\n"
					}
					w.Header().Set("Content-Type", "application/vnd.docker.raw-stream")
					header := make([]byte, 8)
					header[0] = 2
					binary.BigEndian.PutUint32(header[4:], uint32(len(text)))
					_, _ = w.Write(header)
					_, _ = w.Write([]byte(text))
				default:
					http.NotFound(w, r)
				}
			})}
			go server.Serve(listener)
			defer server.Close()
			engine, err := dockerengine.Connect(context.Background(), dockerengine.Endpoint{Host: "unix://" + socket})
			if err != nil {
				t.Fatal(err)
			}
			defer engine.Close()
			docker, err := dockerengine.NewRuntime(engine, spec.Scope.InstallationID, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			r := Runtime{Docker: docker}
			cause := ErrAgentExited
			if kind == "unavailable" || kind == "slow" {
				cause = agentclient.ErrReadiness
			}
			if kind == "incompatible" {
				cause = agentclient.ErrContextIncompatible
			}
			start := time.Now()
			failure := r.initializationFailure(context.Background(), spec, "fixture-container", cause, "readiness", "AGENT_READINESS_TIMEOUT")
			if time.Since(start) > 2500*time.Millisecond {
				t.Fatal("collection exceeded bound", time.Since(start))
			}
			wantCode, wantState := "AGENT_EXITED", "unrecognized"
			if kind == "recognized" {
				wantCode, wantState = "MCP_INITIALIZATION_FAILED", "available"
			}
			if kind == "unavailable" || kind == "slow" {
				wantCode, wantState = "AGENT_CONTEXT_MISMATCH", "unavailable"
			}
			if kind == "incompatible" {
				wantCode, wantState = "AGENT_CONTEXT_INCOMPATIBLE", "unavailable"
			}
			if kind == "legacy" {
				wantCode, wantState = "AGENT_CONTEXT_INCOMPATIBLE", "available"
			}
			if failure.Code != wantCode || failure.Collection.State != wantState || failure.ExitCode == nil || *failure.ExitCode != 17 || !errors.Is(failure, cause) {
				t.Fatal("primary or collection replaced", failure)
			}
			if kind == "recognized" && (len(events) != 1 || events[0].Code != wantCode) {
				t.Fatal(events)
			}
			if strings.Contains(failure.Error(), "password-secret") || strings.Contains(failure.Error(), "/private") {
				t.Fatal("untrusted output escaped")
			}
		})
	}
}
