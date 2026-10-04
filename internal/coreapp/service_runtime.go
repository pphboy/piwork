package coreapp

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/moby/moby/api/types/container"
	"os"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/diagnostics"
	"piwork/internal/dockerengine"
)

const serviceRevisionLabel = "piwork.service_revision"

type serviceTarget struct {
	WorkID, ServiceID, OperationID string
	Control, Revision              int64
	Enabled, Removed               bool
}

type serviceRuntimeError struct {
	Code, Stage string
	ExitCode    *int
	Collection  *contracts.DiagnosticCollection
}

func (e *serviceRuntimeError) Error() string { return e.Code }

func (a *Application) serviceTargetTx(tx *sql.Tx, target serviceTarget) error {
	work, err := corestore.ReadWork(tx, target.WorkID, false)
	if err != nil {
		return err
	}
	service, err := corestore.ReadService(tx, target.WorkID, target.ServiceID, true)
	if err != nil {
		return err
	}
	if work.ControlVersion != target.Control || service.DesiredRevision != target.Revision || service.Enabled != target.Enabled || (service.TombstonedAt != nil) != target.Removed {
		return errWorkSuperseded
	}
	if target.OperationID != "" {
		var latest, state string
		if err := tx.QueryRow(`SELECT id,state FROM operations WHERE work_id=? AND service_id=? AND json_extract(request_json,'$.fence.scope')='service' ORDER BY rowid DESC LIMIT 1`, target.WorkID, target.ServiceID).Scan(&latest, &state); err != nil {
			return err
		}
		if latest != target.OperationID || state != "pending" && state != "running" {
			return errWorkSuperseded
		}
	}
	return corestore.AssertWorkMutable(tx, target.WorkID)
}
func (a *Application) serviceTargetCurrent(ctx context.Context, target serviceTarget) error {
	return a.Store.Read(ctx, func(tx *sql.Tx) error { return a.serviceTargetTx(tx, target) })
}
func serviceContainerIdentity(workID, serviceID string, revision int64) dockerengine.ContainerIdentity {
	identity := dockerengine.ContainerIdentity{WorkID: workID, Kind: "service", LogicalID: serviceID}
	if revision > 0 {
		identity.Labels = map[string]string{serviceRevisionLabel: strconv.FormatInt(revision, 10)}
	}
	return identity
}

// The persisted resource binding must match every ownership/specification label
// before effects. A Docker name or service head alone is never authority.
func (a *Application) inspectServiceRuntime(ctx context.Context, workID, serviceID string) (*container.InspectResponse, *corestore.ResourceBinding, error) {
	if a.dockerRuntime == nil {
		return nil, nil, errCapturedWork
	}
	view, err := a.dockerRuntime.InspectContainer(ctx, serviceContainerIdentity(workID, serviceID, 0))
	if err != nil {
		return nil, nil, err
	}
	var binding corestore.ResourceBinding
	err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, err = corestore.ReadResourceBinding(tx, a.Store.InstallationID(), workID, "service", serviceID)
		return err
	})
	if errors.Is(err, corestore.ErrNotFound) {
		if view != nil {
			return nil, nil, dockerengine.ErrIdentity
		}
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	if view == nil {
		return nil, &binding, nil
	}
	if view.Config == nil || view.State == nil || strings.TrimPrefix(view.Name, "/") != binding.RuntimeID {
		return nil, nil, dockerengine.ErrIdentity
	}
	var labels map[string]string
	if json.Unmarshal([]byte(binding.LabelsJSON), &labels) != nil {
		return nil, nil, corestore.ErrStorage
	}
	for key, value := range labels {
		if view.Config.Labels[key] != value {
			return nil, nil, dockerengine.ErrIdentity
		}
	}
	revision, err := strconv.ParseInt(view.Config.Labels[serviceRevisionLabel], 10, 64)
	if err != nil || revision < 1 {
		return nil, nil, dockerengine.ErrIdentity
	}
	var exists bool
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM service_revisions WHERE work_id=? AND service_id=? AND revision=? AND resolved_image_digest=?)`, workID, serviceID, revision, view.Config.Image).Scan(&exists)
	}); err != nil {
		return nil, nil, err
	}
	if !exists {
		return nil, nil, dockerengine.ErrIdentity
	}
	return view, &binding, nil
}
func serviceRemovalKey(workID, serviceID string) string {
	sum := sha256.Sum256([]byte(workID + "\x00" + serviceID))
	return "service_remove_" + hex.EncodeToString(sum[:])
}
func (a *Application) stopServiceRuntime(ctx context.Context, workID, serviceID string, remove bool) (returned error) {
	stage := "service-stop"
	if remove {
		stage = "service-remove"
	}
	target := serviceTarget{WorkID: workID, ServiceID: serviceID}
	if err := a.serviceStage(ctx, target, stage, "started", "WORK_OPERATION_FAILED"); err != nil {
		return err
	}
	defer func() {
		outcome := "succeeded"
		if returned != nil {
			outcome = "failed"
		}
		if err := a.serviceStage(ctx, target, stage, outcome, "WORK_OPERATION_FAILED"); err != nil {
			returned = errors.Join(returned, err)
		}
	}()
	if a.dockerRuntime == nil {
		// A definition accepted while stopped can finish without Engine access
		// only when no runtime creation intent or occupied charge ever existed.
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			if _, err := corestore.ReadResourceBinding(tx, a.Store.InstallationID(), workID, "service", serviceID); !errors.Is(err, corestore.ErrNotFound) {
				if err != nil {
					return err
				}
				return dockerengine.ErrStateUnknown
			}
			binding, err := corestore.ReadServiceRuntimeBinding(tx, workID, serviceID)
			if err != nil && !errors.Is(err, corestore.ErrNotFound) {
				return err
			}
			if binding.ContainerID != nil {
				return dockerengine.ErrStateUnknown
			}
			quota, err := corestore.ReadQuotaReservation(tx, workID, "service", serviceID)
			if err != nil {
				return err
			}
			if quota.OccupiedCPUMillis != 0 || quota.OccupiedMemoryBytes != 0 {
				return dockerengine.ErrStateUnknown
			}
			return nil
		})
		if err != nil {
			return err
		}
		return nil
	}
	view, binding, err := a.inspectServiceRuntime(ctx, workID, serviceID)
	if err != nil {
		return err
	}
	key := serviceRemovalKey(workID, serviceID)
	if view == nil && binding != nil {
		// A persisted unanswered create cannot become confirmed absence after
		// restart. Only a prior exact-instance removal can settle this binding.
		raw, err := a.Store.ControlMetadata(ctx, key)
		var recorded corestore.ResourceBinding
		if err != nil || strictMetadata(raw, &recorded) != nil || recorded != *binding {
			var confirmed corestore.ServiceRuntimeBinding
			if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
				var err error
				confirmed, err = corestore.ReadServiceRuntimeBinding(tx, workID, serviceID)
				return err
			}); err != nil || confirmed.ContainerID == nil {
				return dockerengine.ErrStateUnknown
			}
			if err := a.dockerRuntime.ConfirmContainerAbsent(ctx, *confirmed.ContainerID, binding.RuntimeID); err != nil {
				return err
			}
		}
		remove = true
	}
	if view != nil {
		identity := serviceContainerIdentity(workID, serviceID, 0)
		if remove {
			encoded, _ := json.Marshal(binding)
			if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, key, string(encoded), packageNow())
				return err
			}); err != nil {
				return err
			}
		}
		if view.State.Running {
			seconds := int(a.options.WorkStopTimeout / time.Second)
			stopCtx, cancel := context.WithTimeout(ctx, a.options.WorkStopTimeout+5*time.Second)
			stopped, err := a.dockerRuntime.StopContainer(stopCtx, identity, seconds)
			cancel()
			if err != nil {
				return err
			}
			if stopped == nil || stopped.State == nil || stopped.State.Running {
				return dockerengine.ErrStateUnknown
			}
		}
		if remove {
			if err := a.dockerRuntime.RemoveContainer(ctx, identity); err != nil {
				return err
			}
		}
		check, err := a.dockerRuntime.InspectContainer(ctx, identity)
		if err != nil {
			return err
		}
		if remove && check != nil || !remove && (check == nil || check.State == nil || check.State.Running) {
			return dockerengine.ErrStateUnknown
		}
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec("DELETE FROM control_metadata WHERE key=?", serviceInteractionKey(workID, serviceID)); err != nil {
			return err
		}
		if err := corestore.ConfirmQuotaOccupation(tx, workID, "service", serviceID, 0, 0, true); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE service_runtime_bindings SET ready_since=NULL,updated_at=? WHERE work_id=? AND service_id=?`, packageNow(), workID, serviceID); err != nil {
			return err
		}
		if remove {
			if _, err := tx.Exec(`DELETE FROM resource_bindings WHERE installation_id=? AND resource_kind='service' AND logical_id=?`, a.Store.InstallationID(), workID+"/"+serviceID); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, key); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE service_runtime_bindings SET container_id=NULL,ready_since=NULL,updated_at=? WHERE work_id=? AND service_id=?`, packageNow(), workID, serviceID)
			return err
		}
		return nil
	})
}

func (a *Application) runServiceRuntime(ctx context.Context, target serviceTarget, definition contracts.ServiceDefinition, restart bool) (returned error) {
	if err := a.serviceTargetCurrent(ctx, target); err != nil {
		return err
	}
	if a.dockerRuntime == nil || a.engine == nil {
		return errCapturedWork
	}
	if target.OperationID == "" {
		if err := a.serviceStage(ctx, target, "service-recovery", "started", "SERVICE_START_FAILED"); err != nil {
			return err
		}
		defer func() {
			outcome := "succeeded"
			if returned != nil {
				outcome = "failed"
			}
			if err := a.serviceStage(ctx, target, "service-recovery", outcome, "SERVICE_START_FAILED"); err != nil {
				returned = errors.Join(returned, err)
			}
		}()
	}
	stage, code := "service-image", "IMAGE_UNAVAILABLE"
	if err := a.serviceStage(ctx, target, stage, "started", code); err != nil {
		return err
	}
	transition := func(next, nextCode string) error {
		if err := a.serviceStage(ctx, target, stage, "succeeded", code); err != nil {
			return err
		}
		stage, code = next, nextCode
		return a.serviceStage(ctx, target, stage, "started", code)
	}
	defer func() {
		outcome := "succeeded"
		if returned != nil {
			outcome = "failed"
			var runtimeErr *serviceRuntimeError
			if errors.As(returned, &runtimeErr) {
				stage, code = runtimeErr.Stage, runtimeErr.Code
				if ctx.Err() == nil && (stage == "service-start" || stage == "service-readiness") {
					collection := a.collectServiceInitialization(ctx, target)
					runtimeErr.Collection = &collection
				}
			}
		}
		if err := a.serviceStage(ctx, target, stage, outcome, code); err != nil {
			returned = errors.Join(returned, err)
		}
	}()
	if restart {
		if err := a.stopServiceRuntime(ctx, target.WorkID, target.ServiceID, true); err != nil {
			return &serviceRuntimeError{Code: "WORK_OPERATION_FAILED", Stage: "service-stop"}
		}
	}
	view, existingBinding, err := a.inspectServiceRuntime(ctx, target.WorkID, target.ServiceID)
	if err != nil {
		return err
	}
	if view == nil && existingBinding != nil {
		if err := a.stopServiceRuntime(ctx, target.WorkID, target.ServiceID, true); err != nil {
			return err
		}
	}
	if view != nil {
		var hasIdentity bool
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			v, err := readInteractionIdentity(tx, target.WorkID, target.ServiceID)
			if errors.Is(err, sql.ErrNoRows) {
				return nil
			}
			// The identity is persisted before Docker creation. A crash can leave
			// its container ID unbound even though the exact intended container
			// exists. EnsureContainer below verifies the complete immutable spec
			// before binding that same instance; no second creation is needed.
			hasIdentity = err == nil && v.Revision == target.Revision && v.ServiceName == definition.Name && (v.ContainerID == view.ID || v.ContainerID == "")
			return err
		}); err != nil {
			return err
		}
		if !hasIdentity {
			if err := a.stopServiceRuntime(ctx, target.WorkID, target.ServiceID, true); err != nil {
				return err
			}
			view = nil
		}
	}
	if view != nil && view.Config.Labels[serviceRevisionLabel] != strconv.FormatInt(target.Revision, 10) {
		if err := a.stopServiceRuntime(ctx, target.WorkID, target.ServiceID, true); err != nil {
			return err
		}
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_heads SET observed_state='starting',last_error_json=NULL WHERE work_id=? AND service_id=?`, target.WorkID, target.ServiceID)
		return err
	}); err != nil {
		return err
	}
	var imageID *string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT resolved_image_digest FROM service_revisions WHERE work_id=? AND service_id=? AND revision=?`, target.WorkID, target.ServiceID, target.Revision).Scan(&imageID)
	}); err != nil {
		return err
	}
	if imageID == nil {
		image, err := a.engine.PrepareImage(ctx, definition.Image.Reference)
		if err != nil {
			return &serviceRuntimeError{Code: "IMAGE_UNAVAILABLE", Stage: "service-image"}
		}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			if err := a.serviceTargetTx(tx, target); err != nil {
				return err
			}
			_, err := tx.Exec(`UPDATE service_revisions SET resolved_image_digest=? WHERE work_id=? AND service_id=? AND revision=? AND resolved_image_digest IS NULL`, image.ID, target.WorkID, target.ServiceID, target.Revision)
			return err
		}); err != nil {
			return err
		}
		imageID = &image.ID
	}
	if err := a.serviceTargetCurrent(ctx, target); err != nil {
		return err
	}
	if err := transition("service-storage", "WORK_OPERATION_FAILED"); err != nil {
		return err
	}
	network, err := a.dockerRuntime.EnsureNetwork(ctx, target.WorkID)
	if err != nil {
		return &serviceRuntimeError{Code: "WORK_OPERATION_FAILED", Stage: "service-storage"}
	}
	var networkName string
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT name FROM work_network_names WHERE work_id=?`, target.WorkID).Scan(&networkName)
	}); err != nil {
		return err
	}
	interaction, interactionConfig, interactionCA, err := a.prepareServiceInteraction(ctx, target, definition.Name)
	if err != nil {
		return err
	}
	mounts := []dockerengine.ContainerMount{{Type: "tmpfs", Target: "/tmp"},
		{Type: "bind", Source: interactionConfig, Target: "/etc/piwork/interaction/config.json", ReadOnly: true},
		{Type: "bind", Source: interactionCA, Target: "/etc/piwork/interaction/installation-ca.crt", ReadOnly: true}}
	for _, item := range definition.Mounts {
		var volume string
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT runtime_name FROM volume_records WHERE work_id=? AND volume_role='workspace' AND state IN ('active','retained')`, target.WorkID).Scan(&volume)
		}); err != nil {
			return err
		}
		mounts = append(mounts, dockerengine.ContainerMount{Type: "volume", Source: volume, Target: path.Clean(item.Target), ReadOnly: item.ReadOnly})
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		return updateServiceWorkspaceReference(tx, target.WorkID, target.ServiceID, len(definition.Mounts) > 0)
	}); err != nil {
		return err
	}
	environment := make(map[string]string, len(definition.Environment))
	for key, value := range definition.Environment {
		var text string
		if json.Unmarshal(value, &text) != nil {
			return corestore.ErrStorage
		}
		environment[key] = text
	}
	identity := serviceContainerIdentity(target.WorkID, target.ServiceID, target.Revision)
	if err := transition("service-start", "SERVICE_START_FAILED"); err != nil {
		return err
	}
	ensured, err := a.dockerRuntime.EnsureContainer(ctx, dockerengine.ContainerSpec{Identity: identity, Image: *imageID, DisplayName: networkName + "_" + definition.Name, Entrypoint: []string{definition.Command}, Command: definition.Args, Environment: environment, User: "10001:10001", CPUMillis: definition.CpuMillis, MemoryBytes: definition.MemoryBytes, WorkingDirectory: path.Clean(definition.WorkingDirectory), Network: &dockerengine.ContainerNetwork{Name: network.Name, WorkID: target.WorkID, Aliases: []string{"svc-" + definition.Name}}, Mounts: mounts})
	if err != nil {
		return &serviceRuntimeError{Code: "SERVICE_START_FAILED", Stage: "service-start"}
	}
	if err := a.serviceTargetCurrent(ctx, target); err != nil {
		return err
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		binding, err := corestore.ReadServiceRuntimeBinding(tx, target.WorkID, target.ServiceID)
		if errors.Is(err, corestore.ErrNotFound) {
			binding = corestore.ServiceRuntimeBinding{WorkID: target.WorkID, ServiceID: target.ServiceID, Revision: target.Revision}
		} else if err != nil {
			return err
		}
		if err := a.bindServiceInteractionTx(tx, target, interaction, ensured.ID); err != nil {
			return err
		}
		binding.Revision = target.Revision
		binding.ContainerID = &ensured.ID
		binding.ImageIdentity = imageID
		binding.UpdatedAt = packageNow()
		if err := corestore.PutServiceRuntimeBinding(tx, binding); err != nil {
			return err
		}
		// Once a create has been confirmed its resource charge persists even
		// when start/readiness fails, until a confirmed stop releases it.
		return corestore.ConfirmQuotaOccupation(tx, target.WorkID, "service", target.ServiceID, definition.CpuMillis, definition.MemoryBytes, true)
	}); err != nil {
		return err
	}
	if _, err := a.dockerRuntime.StartContainer(ctx, identity); err != nil {
		return &serviceRuntimeError{Code: "SERVICE_START_FAILED", Stage: "service-start"}
	}
	if err := transition("service-readiness", "SERVICE_READINESS_TIMEOUT"); err != nil {
		return err
	}
	if err := a.waitServiceReady(ctx, target, definition, network.Name); err != nil {
		return err
	}
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := a.serviceTargetTx(tx, target); err != nil {
			return err
		}
		now := packageNow()
		if _, err := tx.Exec(`UPDATE service_heads SET observed_state='ready',applied_revision=?,last_error_json=NULL WHERE work_id=? AND service_id=?`, target.Revision, target.WorkID, target.ServiceID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE service_runtime_bindings SET next_retry_at=NULL,ready_since=COALESCE(ready_since,?),updated_at=? WHERE work_id=? AND service_id=?`, now, now, target.WorkID, target.ServiceID)
		return err
	})
}

func (a *Application) serviceStage(ctx context.Context, target serviceTarget, stage, outcome, code string) error {
	event := diagnostics.Event{Component: "core", Stage: stage, Outcome: outcome, Code: code, ServiceID: target.ServiceID}
	if trace := traceFrom(ctx); trace != nil {
		return trace.observe(ctx, event)
	}
	correlation := target.OperationID
	if correlation == "" {
		correlation = "recovery-" + target.ServiceID
	}
	diagnostics.Write(os.Stderr, event, target.WorkID, target.OperationID, correlation)
	return nil
}
func (a *Application) collectServiceInitialization(ctx context.Context, target serviceTarget) contracts.DiagnosticCollection {
	collect, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	unavailable := contracts.DiagnosticCollection{State: "unavailable", Code: contracts.Supplied("DIAGNOSTIC_COLLECTION_FAILED")}
	view, _, err := a.inspectServiceRuntime(collect, target.WorkID, target.ServiceID)
	if err != nil || view == nil {
		return unavailable
	}
	logs, err := a.dockerRuntime.Logs(collect, serviceContainerIdentity(target.WorkID, target.ServiceID, target.Revision), 200, view.ID)
	if err != nil {
		return unavailable
	}
	state := "available"
	if logs.Truncated {
		state = "truncated"
	}
	return contracts.DiagnosticCollection{State: state}
}

func (a *Application) waitServiceReady(ctx context.Context, target serviceTarget, definition contracts.ServiceDefinition, networkName string) (returned error) {
	deadline := 120 * time.Second
	probe := dockerengine.Probe{NetworkName: networkName, Timeout: 2 * time.Second}
	if definition.Readiness.Present {
		input := definition.Readiness.Value
		deadline = time.Duration(input.DeadlineMs.Value) * time.Millisecond
		probe.Kind = input.Kind
		probe.Path = input.Path.Value
		probe.Command = input.Command.Value
		probe.Timeout = time.Duration(input.TimeoutMs.Value) * time.Millisecond
		for _, port := range definition.Ports {
			if port.Name == input.PortName.Value {
				probe.Port = int(port.ContainerPort)
			}
		}
	}
	readyCtx, cancel := context.WithTimeout(ctx, deadline)
	defer cancel()
	defer func() {
		if ctx.Err() == nil && errors.Is(readyCtx.Err(), context.DeadlineExceeded) {
			returned = &serviceRuntimeError{Code: "SERVICE_READINESS_TIMEOUT", Stage: "service-readiness"}
		}
	}()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		if err := a.serviceTargetCurrent(readyCtx, target); err != nil {
			return err
		}
		view, _, err := a.inspectServiceRuntime(readyCtx, target.WorkID, target.ServiceID)
		if err != nil {
			return err
		}
		if view == nil || view.State == nil {
			return dockerengine.ErrStateUnknown
		}
		if !view.State.Running {
			code := view.State.ExitCode
			return &serviceRuntimeError{Code: "SERVICE_EXITED", Stage: "service-readiness", ExitCode: &code}
		}
		if !definition.Readiness.Present {
			return nil
		}
		if ready, err := a.dockerRuntime.Probe(readyCtx, serviceContainerIdentity(target.WorkID, target.ServiceID, target.Revision), probe); err != nil {
			return err
		} else if ready {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-readyCtx.Done():
			return &serviceRuntimeError{Code: "SERVICE_READINESS_TIMEOUT", Stage: "service-readiness"}
		case <-ticker.C:
		}
	}
}
