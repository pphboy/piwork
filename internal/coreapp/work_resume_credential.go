package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/moby/moby/api/types/container"
	"piwork/internal/corestore"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
	"piwork/internal/workruntime"
)

func (a *Application) runtimeReplacement(ctx context.Context, workID string) (corestore.RuntimeReplacement, bool, error) {
	var plan corestore.RuntimeReplacement
	var found bool
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		plan, found, err = corestore.ReadRuntimeReplacementTx(tx, workID)
		return err
	})
	return plan, found, err
}

func (a *Application) runtimeLaunch(ctx context.Context, workID string, generation int64) (corestore.RuntimeLaunchBinding, bool, error) {
	var binding corestore.RuntimeLaunchBinding
	var found bool
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		var err error
		binding, found, err = corestore.ReadRuntimeLaunchTx(tx, workID, generation)
		return err
	})
	return binding, found, err
}

func launchBinding(spec workruntime.StartSpec, record capturedWork) corestore.RuntimeLaunchBinding {
	return corestore.RuntimeLaunchBinding{Version: 1, WorkID: spec.Scope.WorkID, Generation: spec.Scope.Generation, InstanceID: spec.Scope.InstanceID, ControlVersion: record.control, ContextID: record.contextID, ImageID: record.imageID, ModelRef: record.modelRef, CredentialRef: record.credentialRef, CredentialVersion: record.credentialVersion}
}

func (a *Application) inspectResumeAgent(ctx context.Context, workID string) (*container.InspectResponse, error) {
	return a.dockerRuntime.InspectContainer(ctx, dockerengine.ContainerIdentity{WorkID: workID, Kind: "agent", LogicalID: "agentd"})
}

func checkResumeIdentity(view *container.InspectResponse, generation int64, instance, contextID string) error {
	if view == nil {
		return nil
	}
	if view.Config == nil || view.State == nil {
		return dockerengine.ErrStateUnknown
	}
	labels := view.Config.Labels
	if labels["piwork.generation"] != strconv.FormatInt(generation, 10) || labels["piwork.instance_id"] != instance || labels["piwork.context_identity"] != contextID || labels["piwork.protocol_version"] != "v2" {
		return dockerengine.ErrIdentity
	}
	return nil
}

func (a *Application) credentialGenerationConfirmed(ctx context.Context, workID string, generation int64, instance string) (bool, error) {
	raw, err := a.Store.ControlMetadata(ctx, agentConfirmationKey(workID))
	if err != nil || len(raw) == 0 {
		return false, err
	}
	var record confirmedAgentInstance
	var labels map[string]string
	if strictMetadata(raw, &record) != nil || json.Unmarshal([]byte(record.Binding.LabelsJSON), &labels) != nil || labels["piwork.generation"] == "" || labels["piwork.instance_id"] == "" {
		return false, internaltls.ErrMaterial
	}
	return labels["piwork.generation"] == strconv.FormatInt(generation, 10) && labels["piwork.instance_id"] == instance, nil
}

// resumeReplacementLocked advances one persisted target. The caller holds the
// Work lock; transactions recheck the control target around Docker effects.
func (a *Application) resumeReplacementLocked(ctx context.Context, plan corestore.RuntimeReplacement) (corestore.RuntimeReplacement, error) {
	if plan.Stage == "prepared" {
		view, err := a.inspectResumeAgent(ctx, plan.WorkID)
		if err != nil {
			return plan, err
		}
		if view != nil {
			if err := checkResumeIdentity(view, plan.SourceGeneration, plan.SourceInstanceID, plan.Target.ContextID); err != nil {
				return plan, err
			}
			if view.State.Running {
				return plan, dockerengine.ErrStateUnknown
			}
		}
		err = a.removeApplyAgent(ctx, plan.WorkID)
		if view == nil && errors.Is(err, dockerengine.ErrStateUnknown) {
			if confirmErr := a.confirmMissingAgent(ctx, plan.WorkID); confirmErr != nil {
				return plan, confirmErr
			}
			err = a.releaseApplyAgentIntent(ctx, plan.WorkID)
		}
		if err != nil {
			return plan, err
		}
		if a.workResumeFaultForTest != nil {
			if err := a.workResumeFaultForTest("old-removed"); err != nil {
				return plan, err
			}
		}
		err = a.Store.Write(ctx, func(tx *sql.Tx) error {
			var err error
			plan, err = corestore.AdvanceRuntimeReplacementTx(tx, plan.WorkID, plan.Target.Generation, "old-removed", time.Now())
			return err
		})
		if err != nil {
			return plan, err
		}
	}
	if plan.Stage == "old-removed" {
		err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			var err error
			plan, err = corestore.AdvanceRuntimeReplacementTx(tx, plan.WorkID, plan.Target.Generation, "starting", time.Now())
			return err
		})
		if err != nil {
			return plan, err
		}
	}
	return plan, nil
}

func (a *Application) settleSupersededResumeForApplyLocked(ctx context.Context, operationID string, apply *workApplyPlan, previous corestore.RuntimeReplacement) error {
	if err := a.settleWorkFiles(ctx, apply.WorkID, false); err != nil {
		return err
	}
	if err := a.Store.Read(ctx, func(tx *sql.Tx) error { return corestore.AssertTemporaryCleanupConfirmedTx(tx, apply.WorkID) }); err != nil {
		return err
	}
	if err := a.applyCurrent(ctx, *apply); err != nil {
		return err
	}
	view, err := a.inspectResumeAgent(ctx, apply.WorkID)
	if err != nil {
		return err
	}
	if view != nil {
		generation, instance := previous.SourceGeneration, previous.SourceInstanceID
		if previous.Stage == "starting" {
			generation, instance = previous.Target.Generation, previous.Target.InstanceID
		}
		if err := checkResumeIdentity(view, generation, instance, previous.Target.ContextID); err != nil {
			return err
		}
		if view.State.Running && previous.Stage != "starting" {
			return dockerengine.ErrStateUnknown
		}
	}
	err = a.removeApplyAgent(ctx, apply.WorkID)
	if view == nil && errors.Is(err, dockerengine.ErrStateUnknown) {
		if confirmErr := a.confirmMissingAgent(ctx, apply.WorkID); confirmErr != nil {
			return confirmErr
		}
		err = a.releaseApplyAgentIntent(ctx, apply.WorkID)
	}
	if err != nil {
		return err
	}
	apply.PriorResumeRemoved = true
	return a.Store.Write(ctx, func(tx *sql.Tx) error {
		if err := corestore.DiscardSupersededRuntimeReplacementTx(tx, apply.WorkID, apply.Control); err != nil {
			return err
		}
		return putApplyPlan(tx, operationID, *apply)
	})
}

// resolveWorkStartLocked chooses adoption or a launch snapshot before any
// generation-scoped startup material is published.
func (a *Application) resolveWorkStartLocked(ctx context.Context, workID string, generation int64, instance, contextID string) (workruntime.StartSpec, capturedWork, error) {
	var zero workruntime.StartSpec
	plan, pending, err := a.runtimeReplacement(ctx, workID)
	if err != nil {
		return zero, capturedWork{}, err
	}
	if pending {
		work, err := a.Store.Work(ctx, workID, false)
		if err != nil || work.DesiredState != "running" || work.ControlVersion != plan.ControlVersion {
			return zero, capturedWork{}, errWorkSuperseded
		}
		plan, err = a.resumeReplacementLocked(ctx, plan)
		if err != nil {
			return zero, capturedWork{}, err
		}
		generation, instance, contextID = plan.Target.Generation, plan.Target.InstanceID, plan.Target.ContextID
	}
	view, err := a.inspectResumeAgent(ctx, workID)
	if err != nil {
		return zero, capturedWork{}, err
	}
	adopting := view != nil && view.State != nil && view.State.Running
	if adopting {
		spec, record, err := a.capturedContextSpecForLaunch(ctx, workID, generation, instance, contextID, false, nil, true)
		if err != nil {
			return zero, capturedWork{}, err
		}
		if err := checkResumeIdentity(view, generation, instance, record.contextID); err != nil {
			return zero, capturedWork{}, err
		}
		binding, found, err := a.runtimeLaunch(ctx, workID, generation)
		if err != nil {
			return zero, capturedWork{}, err
		}
		if found {
			if binding.InstanceID != instance || binding.ContextID != record.contextID || binding.ImageID != record.imageID || binding.ModelRef != record.modelRef {
				return zero, capturedWork{}, internaltls.ErrMaterial
			}
			if spec.Model.Provider != "piwork-deterministic" {
				secret, err := a.files.ReadSecret(binding.CredentialRef)
				if err != nil || len(secret) < 2 || secret[len(secret)-1] != '\n' {
					return zero, capturedWork{}, internaltls.ErrMaterial
				}
				state, err := a.agentTLS.CheckModelCredential(ctx, spec.Scope, secret[:len(secret)-1])
				if err != nil || state != internaltls.ModelCredentialSame {
					return zero, capturedWork{}, internaltls.ErrMaterial
				}
			}
		}
		spec.AdoptExisting = true
		return spec, record, nil
	}
	if view != nil && view.State == nil {
		return zero, capturedWork{}, dockerengine.ErrStateUnknown
	}
	binding, hasBinding, err := a.runtimeLaunch(ctx, workID, generation)
	if err != nil {
		return zero, capturedWork{}, err
	}
	var pinned *corestore.RuntimeLaunchBinding
	work, err := a.Store.Work(ctx, workID, false)
	if err != nil {
		return zero, capturedWork{}, err
	}
	if hasBinding && !binding.Activated && (pending || binding.ControlVersion == work.ControlVersion) {
		pinned = &binding
	}
	spec, record, err := a.capturedContextSpecForLaunch(ctx, workID, generation, instance, contextID, false, pinned, false)
	if err != nil {
		return zero, capturedWork{}, err
	}
	if err := checkResumeIdentity(view, generation, instance, record.contextID); err != nil {
		return zero, capturedWork{}, err
	}
	if hasBinding && (binding.InstanceID != instance || binding.ContextID != record.contextID || binding.ImageID != record.imageID || binding.ModelRef != record.modelRef) {
		return zero, capturedWork{}, internaltls.ErrMaterial
	}
	replace := false
	if spec.Model.Provider != "piwork-deterministic" {
		state, err := a.agentTLS.CheckModelCredential(ctx, spec.Scope, spec.Model.Credential)
		if err != nil {
			return zero, capturedWork{}, err
		}
		if hasBinding && binding.Published {
			prior, err := a.files.ReadSecret(binding.CredentialRef)
			if err != nil || len(prior) < 2 || prior[len(prior)-1] != '\n' {
				return zero, capturedWork{}, internaltls.ErrMaterial
			}
			priorState, err := a.agentTLS.CheckModelCredential(ctx, spec.Scope, prior[:len(prior)-1])
			if err != nil || priorState != internaltls.ModelCredentialSame {
				return zero, capturedWork{}, internaltls.ErrMaterial
			}
		}
		if state == internaltls.ModelCredentialUnpublished {
			confirmed, err := a.credentialGenerationConfirmed(ctx, workID, generation, instance)
			if err != nil {
				return zero, capturedWork{}, err
			}
			if view != nil || hasBinding && binding.Published || confirmed {
				return zero, capturedWork{}, internaltls.ErrMaterial
			}
			if hasBinding && !pending && binding.ControlVersion != record.control {
				next := launchBinding(spec, record)
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					return corestore.ReplaceUnpublishedRuntimeLaunchTx(tx, binding, next, time.Now())
				}); err != nil {
					return zero, capturedWork{}, err
				}
				binding = next
			}
		}
		replace = state == internaltls.ModelCredentialChanged
	}
	if view == nil && !pending {
		confirmed, err := a.credentialGenerationConfirmed(ctx, workID, generation, instance)
		if err != nil {
			return zero, capturedWork{}, err
		}
		// An initialization-only Agent may already have been removed. A new
		// container needs a distinct generation and immutable log identity.
		replace = replace || confirmed
	}
	if replace {
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return corestore.AssertTemporaryCleanupConfirmedTx(tx, workID)
		}); err != nil {
			return zero, capturedWork{}, err
		}
		id, err := uuid.NewRandom()
		if err != nil {
			return zero, capturedWork{}, err
		}
		target := launchBinding(spec, record)
		target.Generation++
		target.InstanceID = "agent-" + id.String()
		plan = corestore.RuntimeReplacement{Version: 1, WorkID: workID, ControlVersion: record.control, SourceGeneration: generation, SourceInstanceID: instance, Target: target, Stage: "prepared"}
		if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
			work, err := corestore.ReadWork(tx, workID, false)
			if err != nil || work.DesiredState != "running" || work.ControlVersion != record.control {
				return errWorkSuperseded
			}
			return corestore.PutRuntimeReplacementTx(tx, plan)
		}); err != nil {
			return zero, capturedWork{}, err
		}
		if a.workResumeFaultForTest != nil {
			if err := a.workResumeFaultForTest("replacement-prepared"); err != nil {
				return zero, capturedWork{}, err
			}
		}
		plan, err = a.resumeReplacementLocked(ctx, plan)
		if err != nil {
			return zero, capturedWork{}, err
		}
		spec, record, err = a.capturedContextSpecForLaunch(ctx, workID, plan.Target.Generation, plan.Target.InstanceID, plan.Target.ContextID, false, &plan.Target, false)
		return spec, record, err
	}
	return spec, record, nil
}
