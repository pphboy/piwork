package coreapp

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"time"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

// A captured default may keep an older execution definition. Explicit Chat
// choices require the current head, unless they already have a Run binding.
func (a *Application) catalogModelTx(tx *sql.Tx, reference string, current bool) (catalogModelMetadata, string, string, error) {
	var metadata catalogModelMetadata
	var kind, name, raw string
	var enabled bool
	if err := tx.QueryRow("SELECT kind,name,metadata_json,enabled FROM catalog_entries WHERE id=?", reference).Scan(&kind, &name, &raw, &enabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return metadata, "", "", contracts.NewError("MODEL_UNAVAILABLE", "")
		}
		return metadata, "", "", corestore.ErrStorage
	}
	if kind != "model" || !enabled || strictMetadata([]byte(raw), &metadata) != nil || (metadata.Version != 1 && metadata.Version != 2) || metadata.SourceRuntimeRevision < 1 || metadata.CredentialRef == "" {
		return metadata, "", "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	if _, err := time.Parse(time.RFC3339Nano, metadata.UpdatedAt); err != nil {
		return metadata, "", "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	reg, err := modelRegistryTx(tx)
	if err != nil {
		return metadata, "", "", err
	}
	secret := metadata.CredentialRef
	version := ""
	if id := reg.References[reference]; id != "" {
		m := reg.Models[id]
		p := modelConnection(reg, m)
		if m.Deleted || p.Deleted || !m.Enabled || !p.Enabled || (current && m.ModelRef != reference) {
			return metadata, "", "", contracts.NewError("MODEL_UNAVAILABLE", "")
		}
		secret = p.CredentialRef
		version = p.CredentialVersion
		name = m.Name
		if metadata.Version == 2 && (metadata.ProviderID != p.ID || metadata.ManagedModelID != m.ID || modelAPI(metadata.Provider) != metadata.API) {
			return metadata, "", "", contracts.NewError("MODEL_UNAVAILABLE", "")
		}
	} else if metadata.Version == 2 {
		return metadata, "", "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	if len(name) > 256 {
		name = string([]rune(name)[:min(256, len([]rune(name)))])
	}
	metadata.CredentialRef = secret
	return metadata, name, version, nil
}

type modelExecutionBinding struct {
	Version       int              `json:"version"`
	WorkID        string           `json:"workId"`
	Generation    int64            `json:"generation"`
	InstanceID    string           `json:"instanceId"`
	Reference     string           `json:"reference"`
	CredentialRef string           `json:"credentialRef"`
	Model         runModelSnapshot `json:"model"`
}

func (a *Application) pinModelExecutionTx(tx *sql.Tx, actor serviceActor, workID, reference string, model *runModelSnapshot) error {
	metadata, _, version, err := a.catalogModelTx(tx, reference, model.ModelRef != nil)
	if err != nil {
		return err
	}
	if version == "" {
		return nil
	}
	selector := "default"
	if model.ModelRef != nil {
		selector = "explicit"
	}
	sum := sha256.Sum256([]byte(strings.Join([]string{workID, strconv.FormatInt(actor.Runtime.Generation, 10), actor.Runtime.InstanceID, reference, version, selector}, "\x00")))
	id := "model-execution-" + hex.EncodeToString(sum[:])
	model.ExecutionBindingID = id
	binding := modelExecutionBinding{Version: 1, WorkID: workID, Generation: actor.Runtime.Generation, InstanceID: actor.Runtime.InstanceID, Reference: reference, CredentialRef: metadata.CredentialRef, Model: *model}
	raw, err := json.Marshal(binding)
	if err != nil {
		return err
	}
	_, err = tx.Exec("INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING", "model_execution_"+id, string(raw), modelNow())
	return err
}
func (a *Application) resolvePinnedModelTx(tx *sql.Tx, actor serviceActor, workID string, expected runModelSnapshot) (runModelSnapshot, string, error) {
	var raw string
	var b modelExecutionBinding
	if contracts.Validate("ResourceIdSchema", expected.ExecutionBindingID) != nil {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	if tx.QueryRow("SELECT value_json FROM control_metadata WHERE key=?", "model_execution_"+expected.ExecutionBindingID).Scan(&raw) != nil || strictMetadata([]byte(raw), &b) != nil || b.Version != 1 || b.WorkID != workID || b.Generation != actor.Runtime.Generation || b.InstanceID != actor.Runtime.InstanceID {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	if _, _, _, err := a.catalogModelTx(tx, b.Reference, false); err != nil {
		return runModelSnapshot{}, "", err
	}
	if !sameExecutionModel(b.Model, expected) {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	key, err := a.files.ReadSecret(b.CredentialRef)
	if err != nil || len(key) < 2 {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	return b.Model, strings.TrimRight(string(key), "\r\n"), nil
}
func sameExecutionModel(a, b runModelSnapshot) bool {
	if (a.ModelRef == nil) != (b.ModelRef == nil) || a.ModelRef != nil && *a.ModelRef != *b.ModelRef || a.Provider != b.Provider || a.Model != b.Model || a.API != b.API || string(a.Capabilities) != string(b.Capabilities) || a.ExecutionBindingID != b.ExecutionBindingID {
		return false
	}
	aa, err := normalizeRunModelEndpoint(a.BaseURL)
	if err != nil {
		return false
	}
	bb, err := normalizeRunModelEndpoint(b.BaseURL)
	return err == nil && (aa == nil) == (bb == nil) && (aa == nil || *aa == *bb)
}

func logicalModelEndpoint(provider string, base *string) (string, error) {
	if base == nil {
		switch modelAPI(provider) {
		case "openai-responses":
			return "https://api.openai.com/v1", nil
		case "anthropic-messages":
			return "https://api.anthropic.com", nil
		}
		return "", nil
	}
	normalized, err := normalizeRunModelEndpoint(base)
	if err != nil {
		return "", err
	}
	return *normalized, nil
}

// Default execution is defined by the active owned context, including an
// imported legacy descriptor. Only credential authority comes from the registry.
func (a *Application) capturedDefaultModelTx(tx *sql.Tx, workID string, model *runModelSnapshot) error {
	var raw string
	err := tx.QueryRow(`SELECT r.runtime_profile_json FROM works w JOIN work_context_snapshots c ON c.snapshot_id=w.active_context_id AND c.work_id=w.id JOIN work_config_revisions r ON r.work_id=w.id AND r.revision=c.internal_revision WHERE w.id=?`, workID).Scan(&raw)
	if err != nil {
		return contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	var p RuntimeProfile
	if strictMetadata([]byte(raw), &p) != nil || p.Version != 1 || p.Revision < 1 {
		return contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	aURL, aErr := logicalModelEndpoint(p.Model.Provider, p.Model.BaseURL)
	bURL, bErr := logicalModelEndpoint(model.Provider, model.BaseURL)
	if aErr != nil || bErr != nil || aURL != bURL || p.Model.Provider != model.Provider || p.Model.ID != model.Model {
		return contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	model.API = p.Model.API
	model.Capabilities = append(json.RawMessage(nil), p.Model.Capabilities...)
	model.BaseURL = p.Model.BaseURL
	return nil
}
