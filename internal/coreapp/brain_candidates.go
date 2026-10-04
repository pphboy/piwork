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
	"piwork/internal/dockerengine"
	"piwork/internal/rpc/servicesv1"
	"piwork/internal/workaccess"
	"piwork/internal/workcontext"
)

const brainCandidateKind = "prepare-brain-candidate"
const brainPackageName = "piwork-brain"

type brainPackageHead struct {
	Digest    string          `json:"digest"`
	Version   json.RawMessage `json:"version"`
	Enabled   bool            `json:"enabled"`
	ContextID string          `json:"contextId"`
}
type brainCandidateReceipt struct {
	ArtifactDigest    string          `json:"artifactDigest"`
	Version           json.RawMessage `json:"version"`
	ContextID         string          `json:"contextId"`
	OperationBoundary int64           `json:"operationBoundary"`
}
type brainCandidateView struct {
	OperationID    string               `json:"operationId"`
	State          string               `json:"state"`
	Phase          string               `json:"phase"`
	SourceDigest   string               `json:"sourceDigest"`
	RequestID      string               `json:"requestId"`
	ArtifactDigest string               `json:"artifactDigest,omitempty"`
	Version        json.RawMessage      `json:"version,omitempty"`
	Apply          *brainApplyView      `json:"apply,omitempty"`
	Error          *brainCandidateError `json:"error"`
}
type brainApplyView struct {
	OperationID string               `json:"operationId"`
	State       string               `json:"state"`
	Error       *brainCandidateError `json:"error,omitempty"`
}
type brainCandidateError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}
type brainCandidateState struct {
	WorkID    string              `json:"workId"`
	Active    *brainPackageHead   `json:"active"`
	Desired   *brainPackageHead   `json:"desired"`
	Candidate *brainCandidateView `json:"candidate"`
}

func brainReceiptKey(id string) string { return "brain_candidate_" + strings.ReplaceAll(id, "-", "_") }

func readBrainReceiptTx(tx *sql.Tx, operationID string) (*brainCandidateReceipt, error) {
	var raw string
	err := tx.QueryRow(`SELECT value_json FROM control_metadata WHERE key=?`, brainReceiptKey(operationID)).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var receipt brainCandidateReceipt
	if strictMetadata([]byte(raw), &receipt) != nil || receipt.OperationBoundary < 1 || contracts.Validate("DigestSchema", receipt.ArtifactDigest) != nil || contracts.Validate("IdentifierSchema", receipt.ContextID) != nil {
		return nil, corestore.ErrStorage
	}
	return &receipt, nil
}

// Publication captures the existing Operation order. This avoids wall-clock
// ambiguity and excludes older Applies, including those for identical bytes.
// Resolve the accepted Apply's immutable package binding, not a later Save.
func (a *Application) brainCandidateApplyTx(tx *sql.Tx, workID string, receipt *brainCandidateReceipt) (*brainApplyView, error) {
	rows, err := tx.Query(`SELECT o.id,o.state,m.value_json,o.error_json FROM operations o LEFT JOIN control_metadata m ON m.key=('work_apply_' || replace(o.id,'-','_')) WHERE o.work_id=? AND o.kind=? AND o.rowid>? ORDER BY o.rowid DESC`, workID, applyOperationKind, receipt.OperationBoundary)
	if err != nil {
		return nil, err
	}
	type acceptedApply struct {
		id, state        string
		plan, diagnostic *string
	}
	var applies []acceptedApply
	for rows.Next() {
		var apply acceptedApply
		if err := rows.Scan(&apply.id, &apply.state, &apply.plan, &apply.diagnostic); err != nil {
			rows.Close()
			return nil, err
		}
		applies = append(applies, apply)
	}
	err = errors.Join(rows.Err(), rows.Close())
	if err != nil {
		return nil, err
	}
	for _, apply := range applies {
		var plan workApplyPlan
		if apply.plan == nil || strictMetadata([]byte(*apply.plan), &plan) != nil || plan.WorkID != workID || contracts.Validate("IdentifierSchema", plan.ContextID) != nil {
			return nil, corestore.ErrStorage
		}
		head, err := a.brainHeadTx(tx, workID, &plan.ContextID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, corestore.ErrStorage
		}
		if err != nil {
			return nil, err
		}
		if head == nil || !head.Enabled || head.Digest != receipt.ArtifactDigest {
			continue
		}
		view := &brainApplyView{OperationID: apply.id, State: apply.state}
		if apply.diagnostic != nil {
			var diagnostic contracts.SafeDiagnostic
			if json.Unmarshal([]byte(*apply.diagnostic), &diagnostic) != nil {
				return nil, corestore.ErrStorage
			}
			code := string(diagnostic.Code)
			message, _, _, ok := safeDiagnosticText(code)
			if !ok {
				code = "WORK_OPERATION_FAILED"
				message, _, _, _ = safeDiagnosticText(code)
			}
			view.Error = &brainCandidateError{Code: code, Message: message}
		}
		return view, nil
	}
	return nil, nil
}

// Heads come from immutable captured metadata, never from the editable source.
// Reading them while the Store transaction holds its snapshot also fixes which
// contexts the caller is authorizing or publishing against.
func (a *Application) brainHeadTx(tx *sql.Tx, workID string, contextID *string) (*brainPackageHead, error) {
	if contextID == nil {
		return nil, nil
	}
	var raw string
	if err := tx.QueryRow(`SELECT configuration_json FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, *contextID).Scan(&raw); err != nil {
		return nil, err
	}
	config, err := contracts.Decode[contracts.WorkConfig](strings.NewReader(raw), "WorkConfigSchema", 2<<20)
	if err != nil {
		return nil, err
	}
	var enabled bool
	found := false
	for _, item := range config.Packages {
		if string(item.Name) == brainPackageName {
			enabled = item.Enabled
			found = true
		}
	}
	if !found {
		return nil, nil
	}
	metadata, err := workcontext.Metadata(a.Store, workID, *contextID)
	if err != nil {
		return nil, err
	}
	for _, binding := range metadata.PackageBindings {
		if binding.Name == brainPackageName {
			return &brainPackageHead{string(binding.Artifact.ContentDigest), binding.Artifact.Version, enabled, *contextID}, nil
		}
	}
	return nil, corestore.ErrStorage
}
func (a *Application) checkBrainBaselineTx(tx *sql.Tx, work corestore.WorkRecord, submission contracts.BrainCandidateSubmission) error {
	active, err := a.brainHeadTx(tx, work.ID, work.ActiveContextID)
	if err != nil {
		return err
	}
	desired, err := a.brainHeadTx(tx, work.ID, work.DesiredContextID)
	if err != nil {
		return err
	}
	if active == nil || desired == nil || !active.Enabled || !desired.Enabled || active.ContextID != string(submission.ActiveContextId) || active.Digest != string(submission.ActiveDigest) || desired.Digest != string(submission.DesiredDigest) {
		return contracts.NewError("PI_PACKAGE_CANDIDATE_CONFLICT", "")
	}
	return nil
}
func (a *Application) acceptBrainCandidate(ctx context.Context, actor serviceActor, workID string, submission contracts.BrainCandidateSubmission) (corestore.AcceptedMutation, error) {
	var accepted corestore.AcceptedMutation
	raw, err := json.Marshal(submission)
	if err != nil {
		return accepted, err
	}
	if _, err = contracts.Decode[contracts.BrainCandidateSubmission](strings.NewReader(string(raw)), "BrainCandidateSubmissionSchema", 32<<10); err != nil {
		return accepted, err
	}
	if actor.Runtime == nil || actor.User != nil {
		return accepted, contracts.NewError("PERMISSION_DENIED", "")
	}
	var work corestore.WorkRecord
	if err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		work, err = a.authorizeServiceTx(tx, actor, workID, workaccess.Interact)
		return err
	}); err != nil {
		return accepted, err
	}
	// Current authentication is mandatory even for replay. Execution-dependent
	// checks happen only after the stable Work actor's committed key lookup.
	accepted, found, err := a.Store.FindAcceptedMutation(ctx, actor.key(), workID, brainCandidateKind, submission.SubmissionKey, string(raw))
	if err != nil || found {
		return accepted, err
	}
	var prepareReference string
	if err = a.Store.Read(ctx, func(tx *sql.Tx) error {
		current, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Interact)
		if err != nil {
			return err
		}
		if err = a.checkBrainBaselineTx(tx, current, submission); err != nil {
			return err
		}
		work = current
		return tx.QueryRow(`SELECT image_identity FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, *current.DesiredContextID).Scan(&prepareReference)
	}); err != nil {
		return accepted, err
	}
	if a.engine == nil || a.inspector == nil || a.dockerRuntime == nil || !a.Status().Ready {
		return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
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
	checkedImages := map[string]bool{}
	for _, image := range []string{prepare.ID, trusted.ID} {
		if checkedImages[image] {
			continue
		}
		checkedImages[image] = true
		if _, err = a.inspector.InspectNativeAgent(ctx, image); err != nil {
			if errors.Is(err, dockerengine.ErrImageIncompatible) {
				return accepted, contracts.NewError("PI_PACKAGE_HELPER_INCOMPATIBLE", "")
			}
			return accepted, contracts.NewError("RUNTIME_UNAVAILABLE", "")
		}
	}
	environment, err := a.probePackageEnvironment(ctx, prepare.ID)
	if err != nil {
		return accepted, err
	}
	environmentJSON, _ := json.Marshal(environment)
	sourceJSON, _ := json.Marshal(packageSourceInput{Kind: "brain", Name: brainPackageName, Brain: &submission})
	value, _ := contracts.ParseJSON(strings.NewReader(string(raw)), 32<<10)
	digest, _ := contracts.PrivateDigest("package-request/v1", value)
	now := time.Now().UTC()
	timestamp := now.Format(time.RFC3339Nano)
	name := brainPackageName
	accepted, err = a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.key(), WorkScope: workID, Kind: brainCandidateKind, IdempotencyKey: submission.SubmissionKey, RequestJSON: string(raw), WorkID: &workID, ExpectedWorkVersion: &work.ControlVersion, TargetVersion: work.ControlVersion, FenceScope: "work", Now: timestamp}, func(tx *sql.Tx, id string) (corestore.MutationEffect, error) {
		current, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Interact)
		if err != nil {
			return corestore.MutationEffect{}, err
		}
		if err = a.checkBrainBaselineTx(tx, current, submission); err != nil {
			return corestore.MutationEffect{}, err
		}
		// Unrelated desired edits can be merged at publication, but preparation ABI
		// is immutable and cannot silently switch to a different image.
		var currentImage string
		if err = tx.QueryRow(`SELECT image_identity FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, workID, *current.DesiredContextID).Scan(&currentImage); err != nil {
			return corestore.MutationEffect{}, err
		}
		if currentImage != prepareReference {
			return corestore.MutationEffect{}, contracts.NewError("PI_PACKAGE_CANDIDATE_CONFLICT", "")
		}
		_, err = corestore.InsertPackageJob(tx, corestore.PackageJob{OperationID: id, ScopeKind: "work", WorkID: &workID, ActorID: actor.key(), Kind: "update", PrepareImageID: prepare.ID, TrustedHelperImageID: trusted.ID, PreparedEnvironmentJSON: string(environmentJSON), SourceJSON: string(sourceJSON), RequestDigest: digest, PackageName: &name, Phase: "queued", WorkerEpoch: 1, DeadlineAt: now.Add(30 * time.Minute).Format(time.RFC3339Nano), CreatedAt: timestamp, UpdatedAt: timestamp})
		return corestore.MutationEffect{ResourceID: workID}, err
	})
	if err == nil && !accepted.Reused {
		a.kickCorePackageJob(accepted.OperationID)
	}
	return accepted, err
}
func (a *Application) brainCandidateState(ctx context.Context, actor serviceActor, workID, key string) (brainCandidateState, error) {
	result := brainCandidateState{WorkID: workID}
	if actor.Runtime == nil || actor.User != nil {
		return result, contracts.NewError("PERMISSION_DENIED", "")
	}
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		work, err := a.authorizeServiceTx(tx, actor, workID, workaccess.Interact)
		if err != nil {
			return err
		}
		result.Active, err = a.brainHeadTx(tx, workID, work.ActiveContextID)
		if err != nil {
			return err
		}
		result.Desired, err = a.brainHeadTx(tx, workID, work.DesiredContextID)
		if err != nil {
			return err
		}
		if key == "" {
			return nil
		}
		var operationID string
		err = tx.QueryRow(`SELECT operation_id FROM idempotency_records WHERE principal_id=? AND work_scope=? AND operation_kind=? AND idempotency_key=?`, actor.key(), workID, brainCandidateKind, key).Scan(&operationID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return err
		}
		job, err := corestore.ReadPackageJob(tx, operationID)
		if err != nil {
			return err
		}
		var source packageSourceInput
		if strictMetadata([]byte(job.SourceJSON), &source) != nil || source.Kind != "brain" || source.Brain == nil || job.ActorID != actor.key() || job.WorkID == nil || *job.WorkID != workID {
			return corestore.ErrStorage
		}
		var state string
		var errorRaw *string
		if err = tx.QueryRow(`SELECT state,error_json FROM operations WHERE id=? AND work_id=?`, operationID, workID).Scan(&state, &errorRaw); err != nil {
			return err
		}
		candidate := &brainCandidateView{OperationID: operationID, State: state, Phase: job.Phase, SourceDigest: string(source.Brain.ExpectedSourceDigest), RequestID: string(source.Brain.RequestId)}
		if errorRaw != nil {
			var safe struct {
				Code string `json:"code"`
			}
			if json.Unmarshal([]byte(*errorRaw), &safe) != nil {
				return corestore.ErrStorage
			}
			code := safe.Code
			if !packageSafeFailureCode(code) && code != "PI_PACKAGE_CANDIDATE_CONFLICT" {
				code = "PI_PACKAGE_PREPARATION_FAILED"
			}
			candidate.Error = &brainCandidateError{code, packageFailureMessage(code)}
		}
		receipt, err := readBrainReceiptTx(tx, operationID)
		if err != nil {
			return err
		}
		if receipt != nil {
			candidate.ArtifactDigest, candidate.Version = receipt.ArtifactDigest, receipt.Version
			candidate.Apply, err = a.brainCandidateApplyTx(tx, workID, receipt)
			if err != nil {
				return err
			}
		}
		result.Candidate = candidate
		return nil
	})
	return result, err
}
func brainCandidateRPCError(err error) error {
	if errors.Is(err, corestore.ErrIdempotencyConflict) {
		return status.Error(codes.AlreadyExists, "IDEMPOTENCY_CONFLICT: Candidate key has different content")
	}
	_, view := contracts.ProjectError(err)
	if view.Code == "PI_PACKAGE_CANDIDATE_CONFLICT" || view.Code == "INVALID_REQUEST" {
		return status.Error(codes.FailedPrecondition, view.Code+": "+view.Message)
	}
	return rpcServiceError(err)
}
func (server *serviceRPC) PrepareBrainCandidate(ctx context.Context, request *servicesv1.WorkPrivateRequest) (*servicesv1.WorkPrivateResponse, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	if request == nil {
		return nil, status.Error(codes.InvalidArgument, "INVALID_REQUEST: Candidate input is required")
	}
	input, err := contracts.Decode[contracts.BrainCandidateSubmission](strings.NewReader(request.InputJson), "BrainCandidateSubmissionSchema", 32<<10)
	if err != nil {
		return nil, status.Error(codes.InvalidArgument, "INVALID_REQUEST: Candidate input is invalid")
	}
	accepted, err := server.App.acceptBrainCandidate(ctx, actor, workID, input)
	if err != nil {
		return nil, brainCandidateRPCError(err)
	}
	raw, _ := json.Marshal(map[string]any{"operationId": accepted.OperationID, "reused": accepted.Reused})
	return &servicesv1.WorkPrivateResponse{ValueJson: string(raw)}, nil
}
func (server *serviceRPC) GetBrainCandidateState(ctx context.Context, request *servicesv1.WorkPrivateRequest) (*servicesv1.WorkPrivateResponse, error) {
	actor, workID, err := rpcActor(ctx)
	if err != nil {
		return nil, err
	}
	var input struct {
		SubmissionKey contracts.Field[string] `json:"submissionKey,omitzero"`
	}
	if request == nil || strictMetadata([]byte(request.InputJson), &input) != nil || input.SubmissionKey.Present && (input.SubmissionKey.Null || input.SubmissionKey.Value == "" || len(input.SubmissionKey.Value) > 256) {
		return nil, status.Error(codes.InvalidArgument, "INVALID_REQUEST: Candidate lookup is invalid")
	}
	state, err := server.App.brainCandidateState(ctx, actor, workID, input.SubmissionKey.Value)
	if err != nil {
		return nil, brainCandidateRPCError(err)
	}
	raw, err := json.Marshal(state)
	if err != nil {
		return nil, brainCandidateRPCError(err)
	}
	return &servicesv1.WorkPrivateResponse{ValueJson: string(raw)}, nil
}
