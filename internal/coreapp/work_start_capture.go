package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
	"strconv"
	"strings"

	"piwork/internal/corestore"
	"piwork/internal/safefs"
)

func startCaptureKey(id string) string {
	return "work_start_context_" + strings.ReplaceAll(id, "-", "_")
}
func generationContextKey(workID string, generation int64) string {
	return "work_generation_context_" + strings.ReplaceAll(workID, "-", "_") + "_" + strconv.FormatInt(generation, 10)
}
func putCapturedStart(tx *sql.Tx, key, contextID string) error {
	if !safefs.ValidFileName(contextID) {
		return corestore.ErrStorage
	}
	raw, err := json.Marshal(map[string]string{"contextId": contextID})
	if err != nil {
		return err
	}
	_, err = tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`, key, string(raw), packageNow())
	return err
}
func (a *Application) readCapturedStart(ctx context.Context, key string) (string, error) {
	raw, err := a.Store.ControlMetadata(ctx, key)
	if err != nil {
		return "", err
	}
	if len(raw) == 0 {
		return "", nil
	}
	var record struct {
		ContextID string `json:"contextId"`
	}
	if strictMetadata(raw, &record) != nil || !safefs.ValidFileName(record.ContextID) {
		return "", corestore.ErrStorage
	}
	return record.ContextID, nil
}

// An initial launch may have failed before active was published. A later
// accepted Start can capture a different desired context; the existing Agent
// must be removed with its original identity before allocating a new one.
// The caller holds the Work lock through generation selection and activation.
func (a *Application) selectCapturedAgentGenerationLocked(ctx context.Context, work corestore.WorkRecord, captured string) (int64, string, error) {
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil || captured == "" {
		return generation, instance, err
	}
	if work.ActiveContextID != nil {
		return a.selectRestoredActiveGenerationLocked(ctx, work, captured, generation, instance)
	}
	prior, err := a.readCapturedStart(ctx, generationContextKey(work.ID, generation))
	if err != nil || prior == "" || prior == captured {
		return generation, instance, err
	}
	current, err := a.Store.Work(ctx, work.ID, false)
	if err != nil {
		return 0, "", err
	}
	if current.ControlVersion != work.ControlVersion || current.DesiredState != "running" || current.ActiveContextID != nil {
		return 0, "", errWorkSuperseded
	}
	if generation >= contracts.MaxSafeInteger {
		return 0, "", corestore.ErrStorage
	}
	if err := a.removeApplyAgent(ctx, work.ID); err != nil {
		return 0, "", err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return 0, "", err
	}
	return generation + 1, "agent-" + id.String(), nil
}

// An unpublished Apply can leave the newest generation bound to its candidate
// after Stop restores the old active context. Never rewrite that launch binding
// or relaunch its identity against the restored context.
func (a *Application) selectRestoredActiveGenerationLocked(ctx context.Context, work corestore.WorkRecord, captured string, generation int64, instance string) (int64, string, error) {
	binding, found, err := a.runtimeLaunch(ctx, work.ID, generation)
	if err != nil {
		return 0, "", err
	}
	if !found || binding.ContextID == captured {
		return generation, instance, nil
	}
	currentMatches := func() error {
		current, err := a.Store.Work(ctx, work.ID, false)
		if err != nil {
			return err
		}
		if current.ControlVersion != work.ControlVersion || current.DesiredState != "running" || current.ActiveContextID == nil || *current.ActiveContextID != captured {
			return errWorkSuperseded
		}
		latest, latestInstance, err := a.selectAgentGeneration(ctx, current)
		if err != nil {
			return err
		}
		if latest != generation || latestInstance != instance {
			return errWorkSuperseded
		}
		return nil
	}
	if err := currentMatches(); err != nil {
		return 0, "", err
	}
	prior, err := a.Store.RuntimeGeneration(ctx, work.ID, generation)
	if err != nil {
		return 0, "", err
	}
	if prior.State != "stopped" || prior.InstanceID == nil || *prior.InstanceID != instance || binding.InstanceID != instance {
		return 0, "", dockerengine.ErrStateUnknown
	}
	if generation >= contracts.MaxSafeInteger {
		return 0, "", corestore.ErrStorage
	}
	if a.dockerRuntime == nil {
		return 0, "", dockerengine.ErrUnavailable
	}
	view, err := a.inspectResumeAgent(ctx, work.ID)
	if err != nil {
		return 0, "", err
	}
	if view != nil {
		if view.State == nil || view.State.Running {
			return 0, "", dockerengine.ErrStateUnknown
		}
		if err := checkResumeIdentity(view, generation, instance, binding.ContextID); err != nil {
			return 0, "", err
		}
	}
	if err := currentMatches(); err != nil {
		return 0, "", err
	}
	if err := a.removeStoppedApplyAgent(ctx, work.ID); err != nil {
		return 0, "", err
	}
	if err := currentMatches(); err != nil {
		return 0, "", err
	}
	id, err := uuid.NewRandom()
	if err != nil {
		return 0, "", err
	}
	return generation + 1, "agent-" + id.String(), nil
}
