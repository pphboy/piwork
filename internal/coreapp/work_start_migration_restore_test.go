package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
	"piwork/internal/workruntime"
)

func TestStartRestoredActiveContextDoesNotReuseUnpublishedMigrationBinding(t *testing.T) {
	for _, mode := range []string{"confirmed-absent", "running-on-removal", "late-control"} {
		t.Run(mode, func(t *testing.T) { checkRestoredStartWithEngine(t, mode) })
	}
}
func checkRestoredStartWithEngine(t *testing.T, mode string) {
	a, _, id, _ := runModelFixture(t)
	ctx := context.Background()
	work, err := a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	active := *work.ActiveContextID
	var configuration string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT configuration_json FROM work_context_snapshots WHERE snapshot_id=?`, active).Scan(&configuration)
	}); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(a.options.DataDirectory, "works", id, "contexts", active)
	if err := os.MkdirAll(root, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte(configuration), 0600); err != nil {
		t.Fatal(err)
	}
	spec, record, err := a.capturedContextSpec(ctx, id, 1, "agent-first", active, false)
	if err != nil {
		t.Fatal(err)
	}
	candidate := launchBinding(spec, record)
	candidate.Generation = 2
	candidate.InstanceID = "agent-migration-candidate"
	candidate.ContextID = "context-unpublished-migration"
	candidate.ImageID = "sha256:" + strings.Repeat("b", 64)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.PutRuntimeLaunchTx(tx, candidate); err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,2,?,'stopped',0,?,?)`, id, candidate.InstanceID, packageNow(), packageNow()); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='stopped',control_version=control_version+2 WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	socketRoot, err := os.MkdirTemp("", "pw-restored-engine-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(socketRoot) })
	socket := filepath.Join(socketRoot, "engine.sock")
	listener, err := net.Listen("unix", socket)
	if err != nil {
		t.Fatal(err)
	}
	var writes, lists atomic.Int64
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.URL.Path == "/_ping":
			w.Header().Set("API-Version", "1.45")
			_, _ = w.Write([]byte("OK"))
		case strings.HasSuffix(r.URL.Path, "/version"):
			_ = json.NewEncoder(w).Encode(map[string]string{"ApiVersion": "1.45", "MinAPIVersion": "1.24", "Os": "linux"})
		case strings.HasSuffix(r.URL.Path, "/containers/json") && r.Method == "GET":
			count := lists.Add(1)
			if mode == "late-control" && count == 1 {
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec(`UPDATE works SET control_version=control_version+1 WHERE id=?`, id)
					return err
				}); err != nil {
					t.Error(err)
				}
			}
			if mode == "running-on-removal" && count == 2 {
				_, _ = w.Write([]byte(`[{"Id":"candidate-container"}]`))
				return
			}
			_, _ = w.Write([]byte("[]"))
		case strings.HasSuffix(r.URL.Path, "/containers/candidate-container/json") && r.Method == "GET":
			_ = json.NewEncoder(w).Encode(map[string]any{"Id": "candidate-container", "Config": map[string]any{"Labels": map[string]string{
				dockerengine.InstallationLabel: a.Store.InstallationID(), dockerengine.ManagedLabel: "true", dockerengine.WorkLabel: id, dockerengine.KindLabel: "agent", dockerengine.LogicalLabel: "agentd",
				"piwork.generation": "2", "piwork.instance_id": candidate.InstanceID, "piwork.context_identity": candidate.ContextID, "piwork.protocol_version": "v2",
			}}, "State": map[string]any{"Running": true}})
		default:
			writes.Add(1)
			http.Error(w, "unexpected Engine request", 500)
		}
	})}
	go func() { _ = server.Serve(listener) }()
	t.Cleanup(func() { _ = server.Close() })
	engine, err := dockerengine.Connect(ctx, dockerengine.Endpoint{Host: "unix://" + socket})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = engine.Close() })
	runtime, err := dockerengine.NewRuntime(engine, a.Store.InstallationID(), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Match real Application initialization: selection resolves the captured
	// credential against durable TLS material even before any runtime launch.
	manager, err := internaltls.Open(filepath.Join(a.options.DataDirectory, "runtime", "agent-tls"), a.Store)
	if err != nil {
		t.Fatal(err)
	}
	a.mu.Lock()
	a.dockerRuntime, a.agentTLS = runtime, manager
	a.mu.Unlock()
	work, err = a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	generation, instance, err := a.selectCapturedAgentGenerationLocked(ctx, work, active)
	var restored workruntime.StartSpec
	if err == nil {
		restored, _, err = a.resolveWorkStartLocked(ctx, id, generation, instance, active)
	}
	if mode != "confirmed-absent" {
		if mode == "running-on-removal" && !errors.Is(err, dockerengine.ErrStateUnknown) {
			t.Fatal("running second inspection admitted", err)
		}
		if mode == "late-control" && !errors.Is(err, errWorkSuperseded) {
			t.Fatal("new control admitted old selection", err)
		}
		if writes.Load() != 0 {
			t.Fatal("rejected selection mutated Engine")
		}
		retained, found, readErr := a.runtimeLaunch(ctx, id, candidate.Generation)
		if readErr != nil || !found || retained != candidate {
			t.Fatal("rejected selection changed binding")
		}
		return
	}
	if err != nil {
		t.Fatalf("restored Start rejected before runtime effects: selectedGeneration=%d materialMismatch=%t error=%v", generation, errors.Is(err, internaltls.ErrMaterial), err)
	}
	if restored.ContextID != active || restored.ImageID != spec.ImageID || restored.Scope.Generation != candidate.Generation+1 {
		t.Fatal("restored Start reused unpublished identity")
	}
	retained, found, err := a.runtimeLaunch(ctx, id, candidate.Generation)
	if err != nil || !found || retained != candidate {
		t.Fatal("original migration binding changed")
	}
	if writes.Load() != 0 {
		t.Fatal("selection performed an Engine mutation")
	}
}

func restoredActiveSelectionFixture(t *testing.T, sameContext bool) (*Application, corestore.WorkRecord, corestore.RuntimeLaunchBinding) {
	t.Helper()
	a, _, id, _ := runModelFixture(t)
	ctx := context.Background()
	work, err := a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	candidate := corestore.RuntimeLaunchBinding{Version: 1, WorkID: id, Generation: 2, InstanceID: "agent-migration-candidate", ControlVersion: work.ControlVersion, ContextID: "context-unpublished-migration", ImageID: "sha256:" + strings.Repeat("b", 64), ModelRef: "model-fixture", CredentialRef: "model-11111111-1111-4111-8111-111111111111.secret"}
	if sameContext {
		candidate.ContextID = *work.ActiveContextID
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.PutRuntimeLaunchTx(tx, candidate); err != nil {
			return err
		}
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,2,?,'stopped',0,?,?)`, id, candidate.InstanceID, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_state='running',observed_state='stopped',control_version=control_version+2 WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	work, err = a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	a.dockerRuntime = nil
	return a, work, candidate
}

func TestRestoredActiveSelectionDoesNotSilentlyReuseCandidateWithoutEngineProof(t *testing.T) {
	a, work, candidate := restoredActiveSelectionFixture(t, false)
	ctx, id := context.Background(), work.ID
	generation, _, err := a.selectCapturedAgentGenerationLocked(ctx, work, *work.ActiveContextID)
	if err == nil {
		t.Fatalf("selection silently reused candidate binding: generation=%d restoredContextMatches=%t", generation, candidate.ContextID == *work.ActiveContextID)
	}
	if !errors.Is(err, dockerengine.ErrUnavailable) {
		t.Fatal("missing Engine was not reported unavailable", err)
	}
	retained, found, readErr := a.runtimeLaunch(ctx, id, 2)
	if readErr != nil || !found || retained != candidate {
		t.Fatal("unconfirmed selection rewrote candidate binding")
	}
}

func TestRestoredActiveSelectionPreservesOriginalAdmission(t *testing.T) {
	for _, mode := range []string{"same-context-ready", "candidate-running", "late-control", "changed-active", "desired-stopped", "newer-generation"} {
		t.Run(mode, func(t *testing.T) {
			a, work, candidate := restoredActiveSelectionFixture(t, mode == "same-context-ready")
			ctx := context.Background()
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				var err error
				switch mode {
				case "same-context-ready", "candidate-running":
					_, err = tx.Exec(`UPDATE runtime_generations SET state='ready' WHERE work_id=? AND generation=2`, work.ID)
				case "late-control":
					_, err = tx.Exec(`UPDATE works SET control_version=control_version+1 WHERE id=?`, work.ID)
				case "changed-active":
					_, err = tx.Exec(`UPDATE works SET active_context_id=NULL WHERE id=?`, work.ID)
				case "newer-generation":
					_, err = tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,3,'agent-newer-original','stopped',0,?,?)`, work.ID, packageNow(), packageNow())
				case "desired-stopped":
					_, err = tx.Exec(`UPDATE works SET desired_state='stopped' WHERE id=?`, work.ID)
				}
				return err
			}); err != nil {
				t.Fatal(err)
			}
			generation, instance, err := a.selectCapturedAgentGenerationLocked(ctx, work, *work.ActiveContextID)
			if mode == "newer-generation" {
				generation, instance, err = a.selectRestoredActiveGenerationLocked(ctx, work, *work.ActiveContextID, 2, candidate.InstanceID)
			}
			if mode == "same-context-ready" {
				if err != nil || generation != 2 || instance != candidate.InstanceID {
					t.Fatal("same-context ready identity was replaced")
				}
			} else if mode == "candidate-running" {
				if !errors.Is(err, dockerengine.ErrStateUnknown) {
					t.Fatal("running candidate admitted", err)
				}
			} else if !errors.Is(err, errWorkSuperseded) {
				t.Fatal("newer Work admitted old selection", err)
			}
			retained, found, err := a.runtimeLaunch(ctx, work.ID, 2)
			if err != nil || !found || retained != candidate {
				t.Fatal("original candidate binding changed")
			}
		})
	}
}

func TestRestoredStartTLSPrerequisiteIsUnpublishedWithoutRuntimeEffects(t *testing.T) {
	a, _, id, _ := runModelFixture(t)
	manager, err := internaltls.Open(filepath.Join(a.options.DataDirectory, "runtime", "agent-tls"), a.Store)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = manager.Close() })
	profile, _, err := a.Settings.LoadRuntime()
	if err != nil {
		t.Fatal(err)
	}
	secret, err := a.files.ReadSecret(profile.Model.CredentialRef)
	if err != nil {
		t.Fatal(err)
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: id, Generation: 3, InstanceID: "agent-restored-fixture"}
	state, err := manager.CheckModelCredential(context.Background(), scope, secret)
	if err != nil || state != internaltls.ModelCredentialUnpublished {
		t.Fatal("fresh generation TLS prerequisite not valid", state, err)
	}
}
