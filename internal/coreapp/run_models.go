package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/workaccess"
)

// The endpoint is private execution input. Public projections use only the
// embedded four-field description; credentials never become model metadata.
type runModelSnapshot struct {
	ModelRef *string `json:"modelRef"`
	Label    string  `json:"label"`
	Provider string  `json:"provider"`
	Model    string  `json:"model"`
	BaseURL  *string `json:"baseUrl,omitempty"`
}
type runModelCandidates struct {
	Models       []runModelSnapshot `json:"models"`
	DefaultModel runModelSnapshot   `json:"defaultModel"`
	CheckedAt    string             `json:"checkedAt"`
}
type modelResolutionInput struct {
	ModelRef contracts.Field[string] `json:"modelRef"`
	Expected *runModelSnapshot       `json:"expected,omitempty"`
}

func normalizeRunModelEndpoint(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	endpoint, err := contracts.NormalizeModelEndpoint(value)
	if err != nil {
		return nil, contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	return endpoint, nil
}
func (a *Application) resolveRunModelEntry(tx *sql.Tx, reference string, modelRef *string) (runModelSnapshot, string, error) {
	var kind, name, raw string
	var enabled bool
	if err := tx.QueryRow("SELECT kind,name,metadata_json,enabled FROM catalog_entries WHERE id=?", reference).Scan(&kind, &name, &raw, &enabled); err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			return runModelSnapshot{}, "", corestore.ErrStorage
		}
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	if kind != "model" || !enabled {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	var metadata catalogModelMetadata
	if strictMetadata([]byte(raw), &metadata) != nil || metadata.Version != 1 || metadata.SourceRuntimeRevision < 1 {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	if _, err := time.Parse(time.RFC3339Nano, metadata.UpdatedAt); err != nil {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	endpoint, err := normalizeRunModelEndpoint(metadata.BaseURL)
	if err != nil {
		return runModelSnapshot{}, "", err
	}
	model := runModelSnapshot{modelRef, name, metadata.Provider, metadata.ID, endpoint}
	public := map[string]any{"modelRef": nil, "label": name, "provider": metadata.Provider, "model": metadata.ID}
	if modelRef != nil {
		public["modelRef"] = *modelRef
	}
	if contracts.Validate("RunModelDescriptionSchema", public) != nil {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	credential, err := a.files.ReadSecret(metadata.CredentialRef)
	if err != nil || len(credential) < 2 || len(credential) > 64<<10 || strings.ContainsRune(string(credential), 0) {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	key := strings.TrimRight(string(credential), "\r\n")
	if key == "" {
		return runModelSnapshot{}, "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	return model, key, nil
}
func (a *Application) activeRunModelReference(tx *sql.Tx, actor serviceActor, workID string) (string, error) {
	if actor.Runtime == nil || actor.User != nil {
		return "", contracts.NewError("AUTHENTICATION_REQUIRED", "")
	}
	work, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Interact)
	if err != nil {
		return "", err
	}
	if work.ActiveContextID == nil {
		return "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	var raw string
	if err := tx.QueryRow("SELECT configuration_json FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?", workID, *work.ActiveContextID).Scan(&raw); err != nil {
		return "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(raw), "WorkConfigSchema", 2<<20)
	if err != nil {
		return "", contracts.NewError("MODEL_UNAVAILABLE", "")
	}
	return string(config.ModelRef), nil
}
func (a *Application) listRunModels(ctx context.Context, actor serviceActor, workID string) (runModelCandidates, error) {
	result := runModelCandidates{Models: []runModelSnapshot{}, CheckedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		reference, err := a.activeRunModelReference(tx, actor, workID)
		if err != nil {
			return err
		}
		result.DefaultModel, _, err = a.resolveRunModelEntry(tx, reference, nil)
		if err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT id FROM catalog_entries WHERE kind='model' AND enabled=1 ORDER BY name,id LIMIT 257")
		if err != nil {
			return err
		}
		var refs []string
		for rows.Next() {
			var ref string
			if err := rows.Scan(&ref); err != nil {
				rows.Close()
				return err
			}
			refs = append(refs, ref)
		}
		err = rows.Err()
		rows.Close()
		if err != nil || len(refs) > 256 {
			return contracts.NewError("MODEL_LIST_UNAVAILABLE", "")
		}
		for _, ref := range refs {
			model, _, err := a.resolveRunModelEntry(tx, ref, &ref)
			if errors.Is(err, corestore.ErrStorage) {
				return err
			}
			if err == nil {
				result.Models = append(result.Models, model)
			}
		}
		return nil
	})
	return result, err
}
func (a *Application) resolveRunModel(ctx context.Context, actor serviceActor, workID string, input modelResolutionInput) (runModelSnapshot, string, error) {
	var model runModelSnapshot
	var credential string
	if !input.ModelRef.Present || !input.ModelRef.Null && (input.ModelRef.Value == "" || contracts.Validate("ResourceIdSchema", input.ModelRef.Value) != nil) {
		return model, "", contracts.NewError("INVALID_REQUEST", "modelRef")
	}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		reference, err := a.activeRunModelReference(tx, actor, workID)
		if err != nil {
			return err
		}
		var ref *string
		if !input.ModelRef.Null {
			reference = input.ModelRef.Value
			ref = &input.ModelRef.Value
		}
		model, credential, err = a.resolveRunModelEntry(tx, reference, ref)
		if err != nil {
			return err
		}
		if expected := input.Expected; expected != nil {
			endpoint, err := normalizeRunModelEndpoint(expected.BaseURL)
			if err != nil || (expected.ModelRef == nil) != (model.ModelRef == nil) || expected.ModelRef != nil && *expected.ModelRef != *model.ModelRef || expected.Provider != model.Provider || expected.Model != model.Model || (endpoint == nil) != (model.BaseURL == nil) || endpoint != nil && *endpoint != *model.BaseURL {
				return contracts.NewError("MODEL_UNAVAILABLE", "")
			}
		}
		return nil
	})
	if err != nil {
		return runModelSnapshot{}, "", err
	}
	return model, credential, nil
}
func modelRPCError(err error) error {
	if errors.Is(err, corestore.ErrStorage) {
		return status.Error(codes.Unavailable, "MODEL_LIST_UNAVAILABLE: Model catalog is unavailable")
	}
	_, view := contracts.ProjectError(err)
	code := codes.FailedPrecondition
	if view.Code == "INVALID_REQUEST" {
		code = codes.InvalidArgument
	}
	if view.Code == "MODEL_UNAVAILABLE" || view.Code == "MODEL_LIST_UNAVAILABLE" || view.Code == "INVALID_REQUEST" {
		return status.Error(code, view.Code+": "+view.Message)
	}
	return rpcServiceError(err)
}
func (server *serviceRPC) ListRunModels(ctx context.Context, _ *servicesv1.Empty) (*servicesv1.WorkPrivateResponse, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	result, err := server.App.listRunModels(ctx, actor, workID)
	if err != nil {
		return nil, modelRPCError(err)
	}
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, modelRPCError(err)
	}
	return &servicesv1.WorkPrivateResponse{ValueJson: string(raw)}, nil
}
func (server *serviceRPC) ResolveRunModel(ctx context.Context, request *servicesv1.WorkPrivateRequest) (*servicesv1.RunModelResolution, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	var input modelResolutionInput
	if request == nil || strictMetadata([]byte(request.InputJson), &input) != nil {
		return nil, status.Error(codes.InvalidArgument, "INVALID_REQUEST: Model input is invalid")
	}
	model, credential, err := server.App.resolveRunModel(ctx, actor, workID, input)
	if err != nil {
		return nil, modelRPCError(err)
	}
	raw, err := json.Marshal(model)
	if err != nil {
		return nil, modelRPCError(err)
	}
	return &servicesv1.RunModelResolution{ModelJson: string(raw), Credential: credential}, nil
}
