package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/google/uuid"
	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/identity"
	"piwork/internal/pipackage"
	"piwork/internal/workaccess"
)

type packageSourceInput struct {
	Kind       string `json:"kind"`
	Spec       string `json:"spec,omitempty"`
	UploadID   string `json:"uploadId,omitempty"`
	Name       string `json:"name,omitempty"`
	ArtifactID string `json:"artifactId,omitempty"`
}

func (a *Application) corePackageInstallHTTP(w http.ResponseWriter, r *http.Request, actor identity.Principal, admin bool, prefix string) (bool, error) {
	if r.Method != http.MethodPost {
		return false, nil
	}
	path := r.URL.EscapedPath()
	kind := "install"
	name := ""
	if path != prefix+"/packages" {
		if !strings.HasPrefix(path, prefix+"/packages/") || !strings.HasSuffix(path, "/update") {
			return false, nil
		}
		encoded := strings.TrimSuffix(strings.TrimPrefix(path, prefix+"/packages/"), "/update")
		if strings.Contains(encoded, "/") {
			return false, nil
		}
		var err error
		name, err = url.PathUnescape(encoded)
		if err != nil || !pipackage.ValidName(name) {
			return true, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		}
		kind = "update"
	}
	var source json.RawMessage
	var key string
	var add bool
	if kind == "install" {
		body, err := readControlJSON[contracts.PiPackageInstallRequest](r, "PiPackageInstallRequestSchema", admin)
		if err != nil {
			return true, err
		}
		source, key, add = body.Source, body.IdempotencyKey, body.AddToDefaults.Value
	} else {
		body, err := readControlJSON[contracts.PiPackageUpdateRequest](r, "PiPackageUpdateRequestSchema", admin)
		if err != nil {
			return true, err
		}
		source, key = body.Source, body.IdempotencyKey
	}
	accepted, err := a.acceptCorePackage(r, actor, kind, name, source, key, add)
	if err != nil {
		return true, packagePublicError(err)
	}
	nameJSON, _ := json.Marshal(any(nil))
	if name != "" {
		nameJSON, _ = json.Marshal(name)
	}
	send(w, http.StatusAccepted, contracts.PiPackageOperationAcceptance{OperationId: contracts.ResourceId(accepted.OperationID), WorkId: json.RawMessage(`null`), CorrelationId: contracts.ResourceId(accepted.OperationID), Reused: accepted.Reused, Scope: "core", Kind: "pi-package-" + kind, Name: nameJSON})
	return true, nil
}

func packagePublicError(err error) error {
	if errors.Is(err, corestore.ErrIdempotencyConflict) {
		return contracts.NewError("IDEMPOTENCY_CONFLICT", "")
	}
	var repository *corestore.RepositoryError
	if errors.As(err, &repository) {
		return contracts.NewError(repository.Code(), "")
	}
	if code, ok := pipackage.ErrorCode(err).(string); ok {
		return contracts.NewError(code, "")
	}
	return err
}

func (a *Application) authorizeCorePackageTx(tx *sql.Tx, r *http.Request, actor identity.Principal) error {
	if !actor.IsOperator() {
		return a.Identity.AuthorizeAdministratorTx(tx, actor)
	}
	values := r.Header.Values("Authorization")
	if len(values) != 1 || !strings.HasPrefix(values[0], "Operator ") || !a.Settings.VerifyOperator(r.Context(), strings.TrimPrefix(values[0], "Operator ")) {
		return contracts.NewError("OPERATOR_AUTHENTICATION_REQUIRED", "")
	}
	return nil
}

func (a *Application) acceptCorePackage(r *http.Request, actor identity.Principal, kind, name string, raw json.RawMessage, key string, add bool) (corestore.AcceptedMutation, error) {
	return a.acceptPackage(r, actor, "", kind, name, raw, key, add)
}

func (a *Application) acceptPackage(r *http.Request, actor identity.Principal, workID, kind, name string, raw json.RawMessage, key string, add bool) (corestore.AcceptedMutation, error) {
	ctx := r.Context()
	scopeKind, workScope := "core", "core"
	var scopedWork *string
	var work corestore.WorkRecord
	if workID != "" {
		scopeKind, workScope, scopedWork = "work", workID, &workID
		var err error
		work, err = workaccess.Work(ctx, a.Store, actor, workID, workaccess.Control)
		if err != nil {
			return corestore.AcceptedMutation{}, err
		}
	}
	actorID := "operator"
	if !actor.IsOperator() {
		actorID = actor.UserID
	}
	var source packageSourceInput
	if json.Unmarshal(raw, &source) != nil {
		return corestore.AcceptedMutation{}, pipackage.ErrSource
	}
	var semantic any
	var uploadID *string
	switch source.Kind {
	case "npm", "git":
		parsed, err := pipackage.ParseSource(source.Kind + ":" + source.Spec)
		if err != nil {
			return corestore.AcceptedMutation{}, err
		}
		semantic = map[string]string{"kind": parsed.Kind, "spec": parsed.Spec}
	case "upload":
		var upload corestore.PackageUpload
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			var err error
			upload, err = corestore.ReadPackageUpload(tx, source.UploadID)
			return err
		})
		if err != nil || upload.ActorID != actorID || upload.ScopeKind != scopeKind || (upload.WorkID == nil) != (scopedWork == nil) || scopedWork != nil && *upload.WorkID != workID || upload.Digest == nil {
			return corestore.AcceptedMutation{}, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		}
		semantic = map[string]any{"kind": upload.SourceKind, "digest": *upload.Digest, "size": upload.Size}
		uploadID = &source.UploadID
	case "core":
		if workID == "" || !pipackage.ValidName(source.Name) || kind == "update" && source.Name != name {
			return corestore.AcceptedMutation{}, pipackage.ErrSource
		}
		semantic = map[string]string{"kind": "core", "name": source.Name}
	default:
		return corestore.AcceptedMutation{}, pipackage.ErrSource
	}
	requestJSON, _ := json.Marshal(map[string]any{"kind": kind, "name": name, "source": semantic, "addToDefaults": add})
	accepted, found, err := a.Store.FindAcceptedMutation(ctx, actorID, workScope, "pi-package-"+kind, key, string(requestJSON))
	if err != nil || found {
		return accepted, err
	}
	if kind == "update" && workID == "" {
		var exists bool
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM pi_package_catalog WHERE name=?)`, name).Scan(&exists)
		})
		if err != nil {
			return accepted, err
		}
		if !exists {
			return accepted, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
		}
	}
	if a.engine == nil || a.inspector == nil {
		return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	var prepareReference string
	if workID == "" {
		profile, configured, err := a.Settings.LoadRuntime()
		if err != nil {
			return accepted, err
		}
		if !configured {
			return accepted, contracts.NewError("RUNTIME_NOT_CONFIGURED", "")
		}
		prepareReference = profile.AgentImage
	} else {
		if work.DesiredContextID == nil {
			return accepted, contracts.NewError("CONFLICT", "")
		}
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT image_identity FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, *work.DesiredContextID).Scan(&prepareReference)
		}); err != nil {
			return accepted, err
		}
	}
	prepare, err := a.engine.PrepareImage(ctx, prepareReference)
	if err != nil {
		return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	trustedReference := a.options.PackageHelperImage
	if trustedReference == "" {
		trustedReference = "piwork-agentd:local"
	}
	trusted, err := a.engine.PrepareImage(ctx, trustedReference)
	if err != nil {
		return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	for _, image := range []string{prepare.ID, trusted.ID} {
		if _, err := a.inspector.InspectNativeAgent(ctx, image); err != nil {
			if errors.Is(err, dockerengine.ErrImageIncompatible) {
				return accepted, contracts.NewError("PI_PACKAGE_HELPER_INCOMPATIBLE", "")
			}
			return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
	}
	if !a.Status().Ready || a.dockerRuntime == nil {
		return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
	}
	environment, err := a.probePackageEnvironment(ctx, prepare.ID)
	if err != nil {
		return accepted, err
	}
	environmentJSON, _ := json.Marshal(environment)
	now := time.Now().UTC()
	timestamp := now.Format(time.RFC3339Nano)
	sourceJSON, _ := json.Marshal(source)
	value, _ := contracts.ParseJSON(strings.NewReader(string(requestJSON)), 2<<20)
	digest, _ := contracts.PrivateDigest("package-request/v1", value)
	var targetName *string
	if name != "" {
		targetName = &name
	}
	request := corestore.MutationRequest{PrincipalID: actorID, WorkScope: workScope, Kind: "pi-package-" + kind, IdempotencyKey: key, RequestJSON: string(requestJSON), TargetVersion: 1, Now: timestamp}
	if workID != "" {
		request.WorkID, request.ExpectedWorkVersion, request.TargetVersion, request.FenceScope = scopedWork, &work.ControlVersion, work.ControlVersion, "work"
	}
	accepted, err = a.Store.AcceptMutation(ctx, request, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		if workID == "" {
			if err := a.authorizeCorePackageTx(tx, r, actor); err != nil {
				return corestore.MutationEffect{}, err
			}
		} else {
			if err := a.Identity.AuthorizePrincipalTx(tx, actor); err != nil {
				return corestore.MutationEffect{}, err
			}
			current, err := corestore.ReadWork(tx, workID, false)
			if err != nil {
				return corestore.MutationEffect{}, err
			}
			if current.OwnerUserID != actor.UserID && actor.Role != "admin" {
				return corestore.MutationEffect{}, contracts.NewError("NOT_FOUND", "")
			}
			if current.DesiredContextID == nil || *current.DesiredContextID != *work.DesiredContextID {
				return corestore.MutationEffect{}, contracts.NewError("REVISION_CONFLICT", "")
			}
		}
		if kind == "update" && workID == "" {
			var exists bool
			if err := tx.QueryRow(`SELECT EXISTS(SELECT 1 FROM pi_package_catalog WHERE name=?)`, name).Scan(&exists); err != nil {
				return corestore.MutationEffect{}, err
			}
			if !exists {
				return corestore.MutationEffect{}, contracts.NewError("PI_PACKAGE_NOT_FOUND", "")
			}
		}
		_, err := corestore.InsertPackageJob(tx, corestore.PackageJob{OperationID: id, ScopeKind: scopeKind, WorkID: scopedWork, ActorID: actorID, Kind: kind, PrepareImageID: prepare.ID, TrustedHelperImageID: trusted.ID, PreparedEnvironmentJSON: string(environmentJSON), AddToDefaults: add, SourceJSON: string(sourceJSON), SourceUploadID: uploadID, RequestDigest: digest, PackageName: targetName, Phase: "queued", WorkerEpoch: 1, DeadlineAt: now.Add(30 * time.Minute).Format(time.RFC3339Nano), CreatedAt: timestamp, UpdatedAt: timestamp})
		resourceID := workID
		if resourceID == "" {
			resourceID = "core-pi-packages"
		}
		return corestore.MutationEffect{ResourceID: resourceID}, err
	})
	if err == nil && !accepted.Reused {
		a.kickCorePackageJob(accepted.OperationID)
	}
	return accepted, err
}

func (a *Application) probePackageEnvironment(ctx context.Context, imageID string) (result contracts.PiPackagePreparedEnvironment, returned error) {
	spec := dockerengine.PackageHelperSpec{PackageIdentity: dockerengine.PackageIdentity{WorkID: "core", JobID: "probe-" + uuid.NewString()}, Epoch: 1, Action: "environment", ImageID: imageID}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		err := a.dockerRuntime.RemovePackageHelper(cleanup, spec)
		if err == nil {
			err = a.Store.ReleaseResourceIntent(cleanup, "core", "package-helper", spec.JobID+"-1-environment", true)
		}
		if err != nil {
			result = contracts.PiPackagePreparedEnvironment{}
			returned = contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
	}()
	if _, err := a.dockerRuntime.EnsurePackageHelper(ctx, spec); err != nil {
		return result, contracts.NewError("PI_PACKAGE_ENVIRONMENT_MISMATCH", "")
	}
	raw, err := a.dockerRuntime.RunPackageHelper(ctx, spec)
	if err != nil {
		return result, contracts.NewError("PI_PACKAGE_ENVIRONMENT_MISMATCH", "")
	}
	result, err = pipackage.ValidateEnvironment(raw)
	if err != nil {
		return result, contracts.NewError("PI_PACKAGE_ENVIRONMENT_MISMATCH", "")
	}
	return result, nil
}
