package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
)

// Persist real candidate/Apply descriptors; no mocked candidate lookup. Actual
// loader rollback is also covered by the native workstation integration test.
func publishedCandidateFixture(t *testing.T) (*Application, serviceActor, string, contracts.BrainCandidateSubmission, string) {
	t.Helper()
	a, actor, id, submission := candidateFixture(t)
	ctx := context.Background()
	work, _ := a.Store.Work(ctx, id, false)
	source, _ := json.Marshal(packageSourceInput{Kind: "brain", Name: brainPackageName, Brain: &submission})
	raw, _ := json.Marshal(submission)
	name := brainPackageName
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.key(), WorkScope: id, Kind: brainCandidateKind, IdempotencyKey: submission.SubmissionKey, RequestJSON: string(raw), TargetVersion: work.ControlVersion, WorkID: &id, FenceScope: "work"}, func(tx *sql.Tx, op string) (corestore.MutationEffect, error) {
		_, err := corestore.InsertPackageJob(tx, corestore.PackageJob{OperationID: op, ScopeKind: "work", WorkID: &id, ActorID: actor.key(), Kind: "update", PrepareImageID: "sha256:" + strings.Repeat("c", 64), TrustedHelperImageID: "sha256:" + strings.Repeat("c", 64), PreparedEnvironmentJSON: `{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"}`, SourceJSON: string(source), RequestDigest: "sha256:" + strings.Repeat("d", 64), PackageName: &name, Phase: "queued", WorkerEpoch: 1, DeadlineAt: "2099-01-01T00:00:00Z", CreatedAt: packageNow(), UpdatedAt: packageNow()})
		return corestore.MutationEffect{ResourceID: id}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		for _, next := range []string{"context-candidate-published", "context-after-unrelated-save", "context-different-brain", "context-disabled-brain", "context-removed-brain"} {
			if _, err := tx.Exec(`INSERT INTO work_context_snapshots(snapshot_id,work_id,internal_revision,configuration_json,image_identity,created_by_user_id,created_at) SELECT ?,work_id,NULL,configuration_json,image_identity,created_by_user_id,created_at FROM work_context_snapshots WHERE snapshot_id=?`, next, *work.ActiveContextID); err != nil {
				return err
			}
		}
		_, err := tx.Exec(`UPDATE works SET desired_context_id='context-after-unrelated-save' WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	for _, next := range []string{"context-candidate-published", "context-after-unrelated-save", "context-disabled-brain", "context-removed-brain"} {
		unitCandidateContext(t, a, id, next, strings.Repeat("b", 64), next != "context-disabled-brain")
	}
	unitCandidateContext(t, a, id, "context-different-brain", strings.Repeat("c", 64), true)
	// Same name and version, same candidate bytes, but accepted before publication.
	unitCandidateApply(t, a, actor, id, "context-candidate-published", "older-apply")
	if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.Exec(`UPDATE work_context_snapshots SET configuration_json=json_set(configuration_json,'$.agentsMd','A later unrelated AGENTS edit') WHERE work_id=? AND snapshot_id='context-after-unrelated-save'`, id); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE work_context_snapshots SET configuration_json=json_set(configuration_json,'$.packages',json('[]')) WHERE work_id=? AND snapshot_id='context-removed-brain'`, id); err != nil {
			return err
		}
		var boundary int64
		if err := tx.QueryRow(`SELECT MAX(rowid) FROM operations`).Scan(&boundary); err != nil {
			return err
		}
		receipt, _ := json.Marshal(brainCandidateReceipt{ArtifactDigest: string(submission.ExpectedSourceDigest), Version: json.RawMessage(`"1.0.0"`), ContextID: "context-candidate-published", OperationBoundary: boundary})
		if _, err := tx.Exec(`INSERT INTO control_metadata(key,value_json,updated_at) VALUES(?,?,?)`, brainReceiptKey(accepted.OperationID), string(receipt), packageNow()); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE pi_package_jobs SET phase='succeeded' WHERE operation_id=?`, accepted.OperationID); err != nil {
			return err
		}
		_, err := tx.Exec(`UPDATE operations SET state='succeeded' WHERE id=?`, accepted.OperationID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return a, actor, id, submission, accepted.OperationID
}

func unitCandidateApply(t *testing.T, a *Application, actor serviceActor, id, contextID, key string) string {
	t.Helper()
	work, err := a.Store.Work(context.Background(), id, false)
	if err != nil {
		t.Fatal(err)
	}
	accepted, err := a.Store.AcceptMutation(context.Background(), corestore.MutationRequest{PrincipalID: actor.key(), WorkScope: id, Kind: applyOperationKind, IdempotencyKey: key, RequestJSON: `{}`, TargetVersion: work.ControlVersion, WorkID: &id, FenceScope: "work"}, func(tx *sql.Tx, op string) (corestore.MutationEffect, error) {
		return corestore.MutationEffect{ResourceID: id}, putApplyPlan(tx, op, workApplyPlan{WorkID: id, ContextID: contextID, Revision: 1, PriorContextID: work.ActiveContextID, PriorRevision: work.ActiveRevision, DesiredState: "running", Control: work.ControlVersion, Stage: "rollback"})
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE operations SET state='failed',error_json=? WHERE id=?`, `{"code":"WORK_OPERATION_FAILED","message":"Bearer private-diagnostic /tmp/private"}`, accepted.OperationID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	return accepted.OperationID
}

func TestBrainCandidateMatchesOnlyPostPublicationApplyWithSameEnabledArtifact(t *testing.T) {
	for _, contextID := range []string{"", "context-candidate-published", "context-after-unrelated-save", "context-different-brain", "context-disabled-brain", "context-removed-brain"} {
		t.Run(contextID, func(t *testing.T) {
			a, actor, id, submission, _ := publishedCandidateFixture(t)
			expected := ""
			if contextID != "" {
				op := unitCandidateApply(t, a, actor, id, contextID, "post-publication-apply")
				if contextID == "context-candidate-published" || contextID == "context-after-unrelated-save" {
					expected = op
				}
			}
			// A later unrelated Work may even refer to the same opaque context ID.
			other := "work-other-candidate-0001"
			work, _ := a.Store.Work(context.Background(), id, false)
			if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
				return corestore.InsertWork(tx, corestore.WorkRecord{ID: other, OwnerUserID: work.OwnerUserID, Name: "Other Work", DesiredState: "stopped", ObservedState: "stopped", DesiredRevision: 1, ControlVersion: 1, CreatedAt: packageNow(), UpdatedAt: packageNow()})
			}); err != nil {
				t.Fatal(err)
			}
			unitCandidateApply(t, a, actor, other, "context-candidate-published", "other-work-apply")
			state, err := a.brainCandidateState(context.Background(), actor, id, submission.SubmissionKey)
			if err != nil {
				t.Fatal(err)
			}
			entry := contracts.PiPackageWorkEntry{Name: brainPackageName, Desired: json.RawMessage(`{"version":"1.0.0","enabled":true}`), Active: json.RawMessage(`{"version":"1.0.0","enabled":true}`), Runtime: contracts.PiPackageRuntimeState{Availability: "unavailable", Loaded: json.RawMessage(`null`), Diagnostics: []string{}}}
			if err := a.projectBrainCandidate(context.Background(), work, string(submission.ExpectedSourceDigest), string(submission.ActiveDigest), true, true, &entry); err != nil {
				t.Fatal(err)
			}
			if expected == "" {
				if state.Candidate.Apply != nil {
					t.Fatal("unrelated or earlier Apply was claimed", state.Candidate.Apply)
				}
				if entry.Candidate.Value.Apply.Availability != "not-applied" || entry.Candidate.Value.Apply.OperationId.Present {
					t.Fatal("public projection claimed unrelated Apply", entry.Candidate.Value.Apply)
				}
				return
			}
			if entry.Candidate.Value.Apply.Availability != "available" || string(entry.Candidate.Value.Apply.OperationId.Value) != expected || entry.Candidate.Value.Apply.State.Value != "failed" {
				t.Fatal("public/private Apply association diverged", entry.Candidate.Value.Apply)
			}
			if state.Candidate.Apply == nil || state.Candidate.Apply.OperationID != expected || state.Candidate.Apply.State != "failed" {
				t.Fatal("actual Apply was lost", state.Candidate)
			}
			if state.Candidate.Apply.Error == nil || strings.Contains(state.Candidate.Apply.Error.Message, "private") {
				t.Fatal("unsafe Apply diagnostic", state.Candidate.Apply)
			}
			// Updating the captured Apply plan cannot change acceptance ordering.
			latest := unitCandidateApply(t, a, actor, id, "context-after-unrelated-save", "latest-matching-apply")
			unitCandidateApply(t, a, actor, id, "context-different-brain", "newer-other-bytes")
			state, err = a.brainCandidateState(context.Background(), actor, id, submission.SubmissionKey)
			if err != nil || state.Candidate.Apply == nil || state.Candidate.Apply.OperationID != latest {
				t.Fatal("latest matching acceptance not returned", state, err)
			}
		})
	}
}

func TestBrainCandidatePublicProjectionHasFixedSafeDetailsAndOriginalApply(t *testing.T) {
	a, actor, id, submission, op := publishedCandidateFixture(t)
	apply := unitCandidateApply(t, a, actor, id, "context-after-unrelated-save", "failed-after-save")
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE pi_package_jobs SET source_json=json_set(source_json,'$.brain.verificationGoal',?) WHERE operation_id=?`, "Verify review token=private-secret /tmp/private "+string(submission.ActiveContextId)+" "+string(submission.ExpectedSourceDigest), op)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	work, _ := a.Store.Work(context.Background(), id, false)
	entry := contracts.PiPackageWorkEntry{Name: brainPackageName, Desired: json.RawMessage(`{"version":"1.0.0","enabled":true}`), Active: json.RawMessage(`{"version":"1.0.0","enabled":true}`), Runtime: contracts.PiPackageRuntimeState{Availability: "unavailable", Loaded: json.RawMessage(`null`), Diagnostics: []string{}}}
	if err := a.projectBrainCandidate(context.Background(), work, string(submission.ExpectedSourceDigest), string(submission.ActiveDigest), true, true, &entry); err != nil {
		t.Fatal(err)
	}
	v := entry.Candidate.Value
	if !v.Baseline.ActiveSelected || !v.Baseline.DesiredSelected || !v.Baseline.ActiveMatchesCurrent || v.Baseline.DesiredMatchesCurrent {
		t.Fatal("acceptance baseline was replaced with current selection", v.Baseline)
	}
	if v.OperationId != contracts.ResourceId(op) || v.RequestId != submission.RequestId || v.Verification.ToolName != submission.VerificationTarget.ToolName || v.Verification.InputSummary != `{"mode":"review"}` || len(v.Verification.CheckNames) != 1 || v.Verification.CheckNames[0] != "review-success" {
		t.Fatal("fixed verification details missing", v)
	}
	if v.Apply.Availability != "available" || string(v.Apply.OperationId.Value) != apply || v.Apply.State.Value != "failed" || v.Adoption != "unavailable" {
		t.Fatal("public Apply facts wrong", v)
	}
	raw, _ := json.Marshal(entry)
	for _, private := range []string{"private-secret", "/tmp/private", string(submission.ActiveContextId), string(submission.ExpectedSourceDigest), "Bearer", "contextId", "artifactDigest"} {
		if strings.Contains(string(raw), private) {
			t.Fatal("private candidate data escaped", string(raw))
		}
	}
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE control_metadata SET value_json=json_set(value_json,'$.contextId','context-missing-0001') WHERE key=?`, applyPlanKey(apply))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.projectBrainCandidate(context.Background(), work, string(submission.ExpectedSourceDigest), string(submission.ActiveDigest), true, true, &entry); !errors.Is(err, corestore.ErrStorage) {
		t.Fatal("missing Apply context concealed as absent candidate", err)
	}
	// Missing/corrupt captured authority is unavailable, never 'not applied'.
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`DELETE FROM control_metadata WHERE key=?`, applyPlanKey(apply))
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := a.projectBrainCandidate(context.Background(), work, string(submission.ExpectedSourceDigest), string(submission.ActiveDigest), true, true, &entry); !errors.Is(err, corestore.ErrStorage) {
		t.Fatal("missing Apply authority reported as no matching Apply", err)
	}
}
