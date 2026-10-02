package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"path/filepath"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
	"piwork/internal/fileprotocol"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/internaltls"
	"piwork/internal/safefs"
	"piwork/internal/workruntime"
)

var capturedImageID = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
var errCapturedWork = errors.New("captured Work runtime is unavailable")
var errWorkSuperseded = errors.New("Work control target was superseded")

type confirmedAgentInstance struct {
	Binding     corestore.ResourceBinding
	ContainerID string
}

func agentConfirmationKey(workID string) string {
	return "agent_confirmed_" + strings.ReplaceAll(workID, "-", "_")
}

func (a *Application) startWorkRuntime(ctx context.Context, spec workruntime.StartSpec) (workruntime.Started, error) {
	if trace := traceFrom(ctx); trace != nil {
		spec.CorrelationID = trace.correlation
		spec.Observe = func(event diagnostics.Event) error { return trace.observe(ctx, event) }
	} else if spec.CorrelationID == "" {
		spec.CorrelationID = spec.Scope.InstanceID
	}
	for _, logical := range []string{"work-private", "work-workspace"} {
		var binding corestore.ResourceBinding
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			binding, err = corestore.ReadResourceBinding(tx, a.Store.InstallationID(), spec.Scope.WorkID, "volume", logical)
			return err
		})
		if errors.Is(err, corestore.ErrNotFound) {
			continue
		}
		if err != nil {
			return workruntime.Started{}, err
		}
		if _, err := a.dockerRuntime.InspectVolume(ctx, binding.RuntimeID, spec.Scope.WorkID, logical); err != nil {
			if errors.Is(err, dockerengine.ErrResourceMissing) {
				failure := &diagnostics.Failure{Cause: err, Code: "CONTEXT_NOT_FOUND", Stage: "runtime-prepare",
					Collection: contracts.DiagnosticCollection{State: "not-attempted"}}
				if spec.Observe != nil {
					_ = spec.Observe(diagnostics.Event{Component: "core", Stage: failure.Stage, Outcome: "failed", Code: failure.Code})
				}
				return workruntime.Started{}, failure
			}
			return workruntime.Started{}, err
		}
	}
	started, err := a.workRuntime.Start(ctx, spec)
	if err != nil {
		var failure *diagnostics.Failure
		if trace := traceFrom(ctx); trace != nil && errors.As(err, &failure) {
			if persistErr := a.retainFailureCollection(ctx, trace.operation, failure); persistErr != nil {
				return started, errors.Join(err, persistErr)
			}
		}
		return started, err
	}
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		binding, err := corestore.ReadResourceBinding(tx, a.Store.InstallationID(), spec.Scope.WorkID, "agent", "agentd")
		if err != nil {
			return err
		}
		raw, err := json.Marshal(confirmedAgentInstance{Binding: binding, ContainerID: started.ContainerID})
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, agentConfirmationKey(spec.Scope.WorkID), string(raw), packageNow())
		return err
	})
	if err != nil {
		started.Client.Close()
	}
	return started, err
}

func (a *Application) confirmMissingAgent(ctx context.Context, workID string) error {
	var binding corestore.ResourceBinding
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, err = corestore.ReadResourceBinding(tx, a.Store.InstallationID(), workID, "agent", "agentd")
		return err
	})
	if errors.Is(err, corestore.ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	raw, err := a.Store.ControlMetadata(ctx, agentConfirmationKey(workID))
	var confirmed confirmedAgentInstance
	if err != nil || strictMetadata(raw, &confirmed) != nil || confirmed.Binding != binding {
		return dockerengine.ErrStateUnknown
	}
	return a.dockerRuntime.ConfirmContainerAbsent(ctx, confirmed.ContainerID, binding.RuntimeID)
}

type capturedWork struct {
	contextID     string
	configuration string
	imageID       string
	profileJSON   string
	revision      int64
	control       int64
}

// capturedStartSpec derives every launch input from durable, immutable Work
// records. The mutable installation default is deliberately not consulted.
func (a *Application) capturedStartSpec(ctx context.Context, workID string, generation int64, instanceID string) (workruntime.StartSpec, capturedWork, error) {
	return a.capturedContextSpec(ctx, workID, generation, instanceID, "", false)
}

func (a *Application) capturedContextSpec(ctx context.Context, workID string, generation int64, instanceID, contextID string, allowStopped bool) (workruntime.StartSpec, capturedWork, error) {
	var spec workruntime.StartSpec
	var record capturedWork
	if !safefs.ValidFileName(workID) || !safefs.ValidFileName(instanceID) || generation < 1 || generation > contracts.MaxSafeInteger {
		return spec, record, errCapturedWork
	}
	var state string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT w.desired_state,w.control_version,c.snapshot_id,c.configuration_json,c.image_identity,c.internal_revision,r.runtime_profile_json
			FROM works w JOIN work_context_snapshots c ON c.snapshot_id=CASE WHEN ?='' THEN COALESCE(w.active_context_id,w.desired_context_id) ELSE ? END AND c.work_id=w.id
			JOIN work_config_revisions r ON r.work_id=w.id AND r.revision=c.internal_revision
			WHERE w.id=? AND w.deleted_at IS NULL AND c.configuration_json=r.config_json`, contextID, contextID, workID).
			Scan(&state, &record.control, &record.contextID, &record.configuration, &record.imageID, &record.revision, &record.profileJSON)
	})
	if err != nil || state != "running" && !(allowStopped && state == "stopped") || record.contextID == "" || !safefs.ValidFileName(record.contextID) || record.revision < 1 || !capturedImageID.MatchString(record.imageID) {
		return spec, capturedWork{}, errCapturedWork
	}
	var profile RuntimeProfile
	if strictMetadata([]byte(record.profileJSON), &profile) != nil || profile.Version != 1 || profile.Revision < 1 || profile.Model.Provider == "" || profile.Model.ID == "" || profile.Model.CredentialRef == "" {
		return spec, capturedWork{}, errCapturedWork
	}
	secret, err := a.files.ReadSecret(profile.Model.CredentialRef)
	if err != nil || len(secret) < 2 || secret[len(secret)-1] != '\n' {
		return spec, capturedWork{}, errCapturedWork
	}
	contextDirectory := filepath.Join(a.options.DataDirectory, "works", workID, "contexts", record.contextID)
	root, err := safefs.OpenExistingRoot(contextDirectory)
	if err != nil {
		return spec, capturedWork{}, errCapturedWork
	}
	content, err := root.ReadPublishedFile("config.json", 2<<20)
	root.Close()
	if err != nil {
		return spec, capturedWork{}, errCapturedWork
	}
	fileValue, fileErr := contracts.ParseJSON(bytes.NewReader(content), 2<<20)
	storedValue, storedErr := contracts.ParseJSON(strings.NewReader(record.configuration), 2<<20)
	fileCanonical, fileErr2 := contracts.EncodeCanonicalJSON(fileValue)
	storedCanonical, storedErr2 := contracts.EncodeCanonicalJSON(storedValue)
	if fileErr != nil || storedErr != nil || fileErr2 != nil || storedErr2 != nil || !bytes.Equal(fileCanonical, storedCanonical) {
		return spec, capturedWork{}, errCapturedWork
	}
	spec = workruntime.StartSpec{
		Scope:   internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instanceID},
		ImageID: record.imageID, ContextID: record.contextID, ContextDirectory: contextDirectory,
		Model: workruntime.Model{Provider: profile.Model.Provider, ID: profile.Model.ID, BaseURL: profile.Model.BaseURL, Credential: secret[:len(secret)-1]},
	}
	return spec, record, nil
}

// startCapturedWork is the single production entry for turning a captured
// Work into an Agent route. A future lifecycle worker chooses the generation
// and calls this after accepting its durable Operation. Failed or superseded
// launches never publish a route. Per-Work locks leave other Works independent.
func (a *Application) startCapturedWork(ctx context.Context, workID string, generation int64, instanceID string, capturedContexts ...string) (workruntime.Started, error) {
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		jobs, err := corestore.PendingFileJobs(tx, &workID)
		if err != nil {
			return err
		}
		if len(jobs) != 0 {
			return fileprotocol.Failure("FILE_CLEANUP_REQUIRED")
		}
		return nil
	}); err != nil {
		return workruntime.Started{}, err
	}
	var zero workruntime.Started
	if a.workRuntime == nil {
		return zero, errCapturedWork
	}
	value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return zero, err
	}
	defer lock.Unlock()
	contextID := ""
	if len(capturedContexts) > 1 {
		return zero, errCapturedWork
	}
	if len(capturedContexts) == 1 {
		contextID = capturedContexts[0]
	}
	if contextID == "" {
		work, err := a.Store.Work(ctx, workID, false)
		if err != nil {
			return zero, err
		}
		if work.ActiveContextID == nil {
			contextID, err = a.readCapturedStart(ctx, generationContextKey(workID, generation))
			if err != nil {
				return zero, err
			}
		}
	}
	spec, record, err := a.capturedContextSpec(ctx, workID, generation, instanceID, contextID, false)
	if err != nil {
		return zero, err
	}
	if _, err := a.agentRoutes.Agent(spec.Scope, spec.ContextID); err == nil {
		return zero, errWorkSuperseded
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		var existing string
		check := tx.QueryRowContext(ctx, `SELECT instance_id FROM runtime_generations WHERE work_id=? AND generation=?`, workID, generation).Scan(&existing)
		if check == nil {
			if existing != instanceID {
				return errWorkSuperseded
			}
			if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state='starting',ready_since=NULL,updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, now, workID, generation, instanceID); err != nil {
				return err
			}
		} else if errors.Is(check, sql.ErrNoRows) {
			if _, err := tx.ExecContext(ctx, `INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,?,?,'starting',0,?,?)`, workID, generation, instanceID, now, now); err != nil {
				return err
			}
		} else {
			return check
		}
		if err := putCapturedStart(tx, generationContextKey(workID, generation), record.contextID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, `UPDATE works SET observed_state='starting',updated_at=? WHERE id=? AND desired_state='running' AND control_version=?`, now, workID, record.control)
		if err != nil {
			return err
		}
		if count, err := result.RowsAffected(); err != nil || count != 1 {
			return errWorkSuperseded
		}
		return nil
	})
	if err != nil {
		return zero, err
	}
	started, err := a.startWorkRuntime(ctx, spec)
	if err != nil {
		// The Engine may have accepted a create/start just before an error.
		// Leave its generation in starting for exact-identity recovery.
		return zero, err
	}
	observed, err := a.restoreWorkServicesLocked(ctx, workID)
	if err != nil {
		started.Client.Close()
		return zero, err
	}
	if trace := traceFrom(ctx); trace != nil {
		if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "activation", Outcome: "started", Code: "WORK_OPERATION_FAILED"}); err != nil {
			started.Client.Close()
			return zero, err
		}
	}
	now = time.Now().UTC().Format(time.RFC3339Nano)
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		var control int64
		var desired string
		var activeContext sql.NullString
		if err := tx.QueryRowContext(ctx, `SELECT desired_state,control_version,active_context_id FROM works WHERE id=? AND deleted_at IS NULL`, workID).Scan(&desired, &control, &activeContext); err != nil || desired != "running" || control != record.control || activeContext.Valid && activeContext.String != record.contextID {
			return errWorkSuperseded
		}
		result, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state='ready',ready_since=?,updated_at=? WHERE work_id=? AND generation=? AND instance_id=? AND state='starting'`, now, now, workID, generation, instanceID)
		if err != nil {
			return err
		}
		if count, err := result.RowsAffected(); err != nil || count != 1 {
			return errWorkSuperseded
		}
		if _, err = tx.ExecContext(ctx, `UPDATE works SET observed_state=?,active_revision=?,active_context_id=?,updated_at=? WHERE id=?`, observed, record.revision, record.contextID, now, workID); err != nil {
			return err
		}
		if _, err := corestore.OpenFileGate(tx, workID, now); err != nil {
			return err
		}
		return a.agentRoutes.Publish(spec.Scope, spec.ContextID, started)
	})
	if err != nil {
		if client := a.agentRoutes.Revoke(workID); client != nil {
			client.Close()
		}
		started.Client.Close()
		// No Work route exists for this generation. The lifecycle reconciler
		// owns confirmed stop and any durable state correction.
		return zero, err
	}
	if trace := traceFrom(ctx); trace != nil {
		if err := trace.observe(ctx, diagnostics.Event{Component: "core", Stage: "activation", Outcome: "succeeded", Code: "WORK_OPERATION_FAILED"}); err != nil {
			return zero, err
		}
	}
	return started, nil
}

// stopCapturedWork closes admission before draining the TS harness and then
// confirms the exact Docker generation is no longer running. It retains the
// Work's desired state, captured context, and both volumes for later resume.
// The caller is responsible for fencing new Work operations and Services.
func (a *Application) stopCapturedWork(ctx context.Context, workID string, drainTimeout, stopTimeout time.Duration) error {
	if a.workRuntime == nil || !safefs.ValidFileName(workID) || drainTimeout <= 0 || drainTimeout > 10*time.Minute || stopTimeout < 0 || stopTimeout > 10*time.Minute {
		return errCapturedWork
	}
	value, _ := a.workLocks.LoadOrStore(workID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return err
	}
	defer lock.Unlock()
	return a.stopCapturedWorkLocked(ctx, workID, drainTimeout, stopTimeout)
}

func (a *Application) stopCapturedWorkLocked(ctx context.Context, workID string, drainTimeout, stopTimeout time.Duration) (returned error) {
	fileErr := a.settleWorkFiles(ctx, workID, false)
	serviceErr := a.stopWorkServicesLocked(ctx, workID, false)
	defer func() { returned = errors.Join(returned, serviceErr, fileErr) }()
	observed := "stopped"
	if serviceErr != nil || fileErr != nil {
		observed = "failed"
	}
	var generation int64
	var instanceID, contextID string
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRowContext(ctx, `SELECT g.generation,g.instance_id,COALESCE(w.active_context_id,w.desired_context_id,'')
			FROM works w JOIN runtime_generations g ON g.work_id=w.id
			WHERE w.id=? AND w.deleted_at IS NULL ORDER BY g.generation DESC LIMIT 1`, workID).
			Scan(&generation, &instanceID, &contextID)
	})
	if err != nil || generation < 1 || instanceID == "" || contextID == "" {
		return errCapturedWork
	}
	view, inspectErr := a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"})
	if inspectErr != nil {
		return inspectErr
	}
	if view == nil {
		if err := a.confirmMissingAgent(ctx, workID); err != nil {
			return err
		}
		if client := a.agentRoutes.Revoke(workID); client != nil {
			client.Close()
		}
		return a.Store.Write(ctx, func(tx *sql.Tx) error {
			if _, err := tx.Exec(`UPDATE runtime_generations SET state='stopped',updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, packageNow(), workID, generation, instanceID); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE works SET observed_state=?,updated_at=? WHERE id=?`, observed, packageNow(), workID)
			return err
		})
	}
	if view != nil {
		if view.Config == nil || view.Config.Labels["piwork.generation"] != strconv.FormatInt(generation, 10) || view.Config.Labels["piwork.instance_id"] != instanceID {
			return dockerengine.ErrIdentity
		}
		contextID = view.Config.Labels["piwork.context_identity"]
	}
	scope := internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: workID, Generation: generation, InstanceID: instanceID}
	client := a.agentRoutes.Revoke(workID)
	if client != nil {
		defer client.Close()
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state='draining',updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, now, workID, generation, instanceID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE works SET observed_state='stopping',updated_at=? WHERE id=?`, now, workID)
		return err
	}); err != nil {
		return err
	}
	var drainErr error
	if client != nil {
		drainCtx, cancel := context.WithTimeout(ctx, drainTimeout+3*time.Second)
		drained, err := client.Drain(drainCtx, drainTimeout)
		cancel()
		if err != nil || !drained {
			drainErr = errors.New("Work Agent drain was not confirmed")
		}
	}
	stopCtx, cancel := context.WithTimeout(ctx, stopTimeout+5*time.Second)
	stopErr := a.workRuntime.StopAgent(stopCtx, scope, contextID, stopTimeout)
	cancel()
	if stopErr != nil {
		return errors.Join(drainErr, stopErr)
	}
	now = time.Now().UTC().Format(time.RFC3339Nano)
	err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `UPDATE runtime_generations SET state='stopped',updated_at=? WHERE work_id=? AND generation=? AND instance_id=?`, now, workID, generation, instanceID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `UPDATE works SET observed_state=?,updated_at=? WHERE id=?`, observed, now, workID)
		return err
	})
	return errors.Join(drainErr, err)
}
