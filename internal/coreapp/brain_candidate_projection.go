package coreapp

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
)

func (a *Application) projectBrainCandidate(ctx context.Context, work corestore.WorkRecord, desiredDigest, activeDigest string, desiredEnabled, activeEnabled bool, entry *contracts.PiPackageWorkEntry) error {
	var operationID, phase, sourceRaw string
	var receipt *brainCandidateReceipt
	var apply *brainApplyView
	found := false
	err := a.Store.Read(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT o.id,j.phase,j.source_json FROM operations o JOIN pi_package_jobs j ON j.operation_id=o.id WHERE o.work_id=? AND o.kind=? ORDER BY o.rowid DESC LIMIT 1`, work.ID, brainCandidateKind).Scan(&operationID, &phase, &sourceRaw); err != nil {
			return err
		}
		found = true
		var err error
		receipt, err = readBrainReceiptTx(tx, operationID)
		if err != nil {
			return err
		}
		if receipt != nil {
			apply, err = a.brainCandidateApplyTx(tx, work.ID, receipt)
		}
		return err
	})
	if !found && errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	var source packageSourceInput
	if strictMetadata([]byte(sourceRaw), &source) != nil || source.Brain == nil || source.Kind != "brain" {
		return corestore.ErrStorage
	}
	raw, err := json.Marshal(source.Brain)
	if err != nil {
		return corestore.ErrStorage
	}
	if _, err := contracts.Decode[contracts.BrainCandidateSubmission](bytes.NewReader(raw), "BrainCandidateSubmissionSchema", 32<<10); err != nil {
		return corestore.ErrStorage
	}
	value := (contracts.PiPackageWorkEntry{}).Candidate.Value
	value.Source = "Work files"
	value.OperationId = contracts.ResourceId(operationID)
	value.RequestId = contracts.Identifier(source.Brain.RequestId)
	value.Preparation = phase
	value.Adoption = "unavailable"
	value.Baseline.ActiveSelected, value.Baseline.DesiredSelected = true, true
	value.Baseline.ActiveMatchesCurrent = activeEnabled && activeDigest == string(source.Brain.ActiveDigest) && work.ActiveContextID != nil && *work.ActiveContextID == string(source.Brain.ActiveContextId)
	value.Baseline.DesiredMatchesCurrent = desiredEnabled && desiredDigest == string(source.Brain.DesiredDigest)
	private := []string{string(source.Brain.ActiveContextId)}
	if work.ActiveContextID != nil {
		private = append(private, *work.ActiveContextID)
	}
	if work.DesiredContextID != nil {
		private = append(private, *work.DesiredContextID)
	}
	if receipt != nil {
		private = append(private, receipt.ContextID)
	}
	value.Verification.Goal = publicBrainText(source.Brain.VerificationGoal, private)
	value.Verification.ToolName = source.Brain.VerificationTarget.ToolName
	input, _ := json.Marshal(source.Brain.VerificationTarget.Input)
	value.Verification.InputSummary = publicBrainText(string(input), private)
	if summary := []rune(value.Verification.InputSummary); len(summary) > 4096 {
		value.Verification.InputSummary = string(summary[:4093]) + "…"
	}
	value.Verification.CheckNames = source.Brain.VerificationTarget.CheckNames
	value.Apply.Availability = "not-applied"
	if apply != nil {
		value.Apply.Availability = "available"
		value.Apply.OperationId = contracts.Supplied(contracts.ResourceId(apply.OperationID))
		value.Apply.State = contracts.Supplied(contracts.OperationState(apply.State))
		if apply.Error != nil {
			diagnostic := value.Apply.Error.Value
			diagnostic.Code, diagnostic.Message = apply.Error.Code, apply.Error.Message
			value.Apply.Error = contracts.Supplied(diagnostic)
		}
	}
	if receipt != nil {
		value.Desired = desiredEnabled && desiredDigest == receipt.ArtifactDigest
		value.Active = activeEnabled && activeDigest == receipt.ArtifactDigest
	}
	// Core projects current Agent evidence; it never declares behavior verified
	// from a package prepare, Apply or loaded boolean alone.
	if work.DesiredState == "running" && work.ActiveContextID != nil {
		var generation int64
		var instance, state string
		err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT generation,instance_id,state FROM runtime_generations WHERE work_id=? ORDER BY generation DESC LIMIT 1`, work.ID).Scan(&generation, &instance, &state)
		})
		if err == nil && state == "ready" {
			client, _, err := a.agentRoutes.Admission(internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: work.ID, Generation: generation, InstanceID: instance}, *work.ActiveContextID)
			if err == nil {
				detail, err := client.GetAgentRequest(ctx, string(source.Brain.RequestId), contracts.AgentEvidenceQuery{Limit: contracts.Supplied(int64(100))})
				if err == nil {
					value.Adoption = "not-confirmed"
					if value.Active {
						for _, proof := range detail.Evidence.Items {
							if proof.Kind == "sdk" && proof.Verified && proof.ObjectRef == source.Brain.VerificationTarget.ToolName && detail.Request.State == "completed" {
								value.Adoption = "verified"
							}
							if proof.Kind == "sdk" && !proof.Verified && proof.ObjectRef == source.Brain.VerificationTarget.ToolName && detail.Request.State == "needs_attention" {
								value.Adoption = "failed"
							}
						}
					}
				}
			}
		}
	}
	entry.Candidate = contracts.Supplied(value)
	// The generated contract is the final public allowlist.
	raw, _ = json.Marshal(entry)
	if _, err := contracts.Decode[contracts.PiPackageWorkEntry](bytes.NewReader(raw), "PiPackageWorkEntrySchema", 64<<10); err != nil {
		return corestore.ErrStorage
	}
	return nil
}

var brainPublicSecret = regexp.MustCompile(`(?i)\b(?:Bearer\s+\S+|(?:password|token|credential|secret|authorization)\s*[:=]\s*[^\s,;]+)`)
var brainPublicPath = regexp.MustCompile(`/(?:home|run|var|tmp|etc|proc|root|mnt|opt)/[^\s"'<>]+`)
var brainPublicDigest = regexp.MustCompile(`sha256:[a-f0-9]{64}`)
var brainPublicPEM = regexp.MustCompile(`(?s)-----BEGIN .*?-----END [^-]+-----`)

func publicBrainText(value string, private []string) string {
	value = brainPublicPEM.ReplaceAllString(value, "[redacted]")
	value = brainPublicSecret.ReplaceAllString(value, "[redacted]")
	value = brainPublicPath.ReplaceAllString(value, "[private path]")
	value = brainPublicDigest.ReplaceAllString(value, "[private artifact]")
	for _, id := range private {
		if id != "" {
			value = strings.ReplaceAll(value, id, "[private context]")
		}
	}
	return value
}
