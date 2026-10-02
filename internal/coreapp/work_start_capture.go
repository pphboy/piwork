package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"sync"

	"github.com/google/uuid"
	"piwork/internal/contracts"
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
func (a *Application) selectCapturedAgentGeneration(ctx context.Context, work corestore.WorkRecord, captured string) (int64, string, error) {
	generation, instance, err := a.selectAgentGeneration(ctx, work)
	if err != nil || work.ActiveContextID != nil || captured == "" {
		return generation, instance, err
	}
	prior, err := a.readCapturedStart(ctx, generationContextKey(work.ID, generation))
	if err != nil || prior == "" || prior == captured {
		return generation, instance, err
	}
	value, _ := a.workLocks.LoadOrStore(work.ID, &sync.Mutex{})
	lock := value.(*sync.Mutex)
	if err := lockWorkContext(ctx, lock); err != nil {
		return 0, "", err
	}
	defer lock.Unlock()
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
