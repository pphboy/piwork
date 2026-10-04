package coreapp

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"piwork/internal/contracts"
	"piwork/internal/corestore"
	"piwork/internal/internaltls"
)

func candidateFixture(t *testing.T) (*Application, serviceActor, string, contracts.BrainCandidateSubmission) {
	t.Helper()
	a, actor, id, _ := runModelFixture(t)
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE works SET desired_context_id=active_context_id WHERE id=?`, id)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	work, err := a.Store.Work(context.Background(), id, false)
	if err != nil {
		t.Fatal(err)
	}
	unitCandidateContext(t, a, id, *work.ActiveContextID, strings.Repeat("a", 64), true)
	target := contracts.BrainVerificationTarget{ContractVersion: 1, ToolName: "package:piwork-brain:review_probe", Input: map[string]json.RawMessage{"mode": json.RawMessage(`"review"`)}, CheckNames: []string{"review-success"}}
	return a, actor, id, contracts.BrainCandidateSubmission{SubmissionKey: "stable-candidate", RequestId: "request-candidate-0001", VerificationGoal: "verify review", VerificationTarget: target, ExpectedSourceDigest: contracts.Digest("sha256:" + strings.Repeat("b", 64)), ActiveDigest: contracts.Digest("sha256:" + strings.Repeat("a", 64)), DesiredDigest: contracts.Digest("sha256:" + strings.Repeat("a", 64)), ActiveContextId: contracts.Identifier(*work.ActiveContextID)}
}
func unitCandidateContext(t *testing.T, a *Application, id, contextID, digest string, enabled bool) {
	t.Helper()
	var raw string
	if err := a.Store.Read(context.Background(), func(tx *sql.Tx) error {
		return tx.QueryRow(`SELECT configuration_json FROM work_context_snapshots WHERE work_id=? AND snapshot_id=?`, id, contextID).Scan(&raw)
	}); err != nil {
		t.Fatal(err)
	}
	var config contracts.WorkConfig
	if json.Unmarshal([]byte(raw), &config) != nil {
		t.Fatal("configuration")
	}
	config.Packages = contracts.PiPackageSelection{{Name: "piwork-brain", Enabled: enabled}}
	config.AgentsMd = "Unrelated edit remains"
	bytes, _ := json.Marshal(config)
	if err := a.Store.Write(context.Background(), func(tx *sql.Tx) error {
		_, err := tx.Exec(`UPDATE work_context_snapshots SET configuration_json=? WHERE work_id=? AND snapshot_id=?`, string(bytes), id, contextID)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	metadata := contracts.WorkContextMetadata{Version: 1, SnapshotId: contextID, WorkId: id, ImageIdentity: contracts.Digest("sha256:" + strings.Repeat("c", 64)), PackageContractVersion: 1, CreatedAt: contracts.Timestamp(packageNow())}
	metadata.Skills = make([]struct {
		Name     string `json:"name"`
		Identity string `json:"identity"`
	}, 0)
	metadata.PackageBindings = append(metadata.PackageBindings, struct {
		Name     string                              `json:"name"`
		NameKey  string                              `json:"nameKey"`
		Artifact contracts.PiPackageArtifactMetadata `json:"artifact"`
	}{Name: "piwork-brain", NameKey: contracts.PackageNameKey("piwork-brain"), Artifact: contracts.PiPackageArtifactMetadata{Name: "piwork-brain", Version: json.RawMessage(`"1.0.0"`), SourceKind: "local", ResolvedSource: "piwork-brain", ContentDigest: contracts.Digest("sha256:" + digest), PreparedEnvironment: contracts.PiPackagePreparedEnvironment{Os: "linux", Architecture: "amd64", Variant: json.RawMessage(`null`), NodeAbi: "137", PiSdkVersion: "0.86.1"}}})
	data, _ := json.Marshal(metadata)
	directory := filepath.Join(a.options.DataDirectory, "works", id, "contexts", contextID)
	if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "metadata.json"), data, 0600); err != nil {
		t.Fatal(err)
	}
}
func TestBrainCandidateReplaySurvivesAgentReplacementWithoutDependencies(t *testing.T) {
	a, actor, id, submission := candidateFixture(t)
	ctx := context.Background()
	raw, _ := json.Marshal(submission)
	source, _ := json.Marshal(packageSourceInput{Kind: "brain", Name: brainPackageName, Brain: &submission})
	name := brainPackageName
	work, _ := a.Store.Work(ctx, id, false)
	accepted, err := a.Store.AcceptMutation(ctx, corestore.MutationRequest{PrincipalID: actor.key(), WorkScope: id, Kind: brainCandidateKind, IdempotencyKey: submission.SubmissionKey, RequestJSON: string(raw), TargetVersion: work.ControlVersion, WorkID: &id, FenceScope: "work"}, func(tx *sql.Tx, op string) (corestore.MutationEffect, error) {
		_, err := corestore.InsertPackageJob(tx, corestore.PackageJob{OperationID: op, ScopeKind: "work", WorkID: &id, ActorID: actor.key(), Kind: "update", PrepareImageID: "sha256:" + strings.Repeat("c", 64), TrustedHelperImageID: "sha256:" + strings.Repeat("c", 64), PreparedEnvironmentJSON: `{"os":"linux","architecture":"amd64","variant":null,"nodeAbi":"137","piSdkVersion":"0.86.1"}`, SourceJSON: string(source), RequestDigest: "sha256:" + strings.Repeat("d", 64), PackageName: &name, Phase: "queued", WorkerEpoch: 1, DeadlineAt: "2099-01-01T00:00:00Z", CreatedAt: packageNow(), UpdatedAt: packageNow()})
		return corestore.MutationEffect{ResourceID: id}, err
	})
	if err != nil {
		t.Fatal(err)
	}
	if err = a.Store.Write(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`INSERT INTO runtime_generations(work_id,generation,instance_id,state,retry_count,created_at,updated_at) VALUES(?,2,'agent-replacement','ready',0,?,?)`, id, packageNow(), packageNow())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	replacement := *actor.Runtime
	replacement.Generation = 2
	replacement.InstanceID = "agent-replacement"
	next := serviceActor{Runtime: &replacement}
	// Replay must not require an Engine, current source files or current baselines.
	replay, err := a.acceptBrainCandidate(ctx, next, id, submission)
	if err != nil || !replay.Reused || replay.OperationID != accepted.OperationID {
		t.Fatal(replay, err)
	}
	submission.VerificationTarget.CheckNames = []string{"different-proof"}
	if _, err = a.acceptBrainCandidate(ctx, next, id, submission); !errors.Is(err, corestore.ErrIdempotencyConflict) {
		t.Fatal("descriptor conflict ignored", err)
	}
	if _, err = a.acceptBrainCandidate(ctx, actor, id, submission); !errors.Is(err, internaltls.ErrStale) {
		t.Fatal("old identity replayed", err)
	}
	state, err := a.brainCandidateState(ctx, next, id, "stable-candidate")
	if err != nil || state.Candidate == nil || state.Candidate.OperationID != accepted.OperationID || state.Candidate.RequestID != "request-candidate-0001" || state.Active == nil || !state.Active.Enabled {
		t.Fatal(state, err)
	}
	missing, err := a.brainCandidateState(ctx, next, id, "other-key")
	if err != nil || missing.Candidate != nil {
		t.Fatal(missing, err)
	}
	encoded, _ := json.Marshal(state)
	for _, private := range []string{a.options.DataDirectory, "credential", "helperId", "nodeAbi", "sourceJson"} {
		if strings.Contains(string(encoded), private) {
			t.Fatal("candidate state leaked", string(encoded))
		}
	}
}
func TestBrainCandidateBaselinesFenceOnlySameBrain(t *testing.T) {
	a, _, id, submission := candidateFixture(t)
	ctx := context.Background()
	check := func() error {
		return a.Store.Read(ctx, func(tx *sql.Tx) error {
			work, err := corestore.ReadWork(tx, id, false)
			if err != nil {
				return err
			}
			return a.checkBrainBaselineTx(tx, work, submission)
		})
	}
	if err := check(); err != nil {
		t.Fatal(err)
	}
	for _, damage := range []string{"digest", "disabled", "removed", "active-context"} {
		t.Run(damage, func(t *testing.T) {
			work, _ := a.Store.Work(ctx, id, false)
			unitCandidateContext(t, a, id, *work.ActiveContextID, strings.Repeat("a", 64), true)
			switch damage {
			case "digest":
				unitCandidateContext(t, a, id, *work.ActiveContextID, strings.Repeat("b", 64), true)
			case "disabled":
				unitCandidateContext(t, a, id, *work.ActiveContextID, strings.Repeat("a", 64), false)
			case "removed":
				if err := a.Store.Write(ctx, func(tx *sql.Tx) error {
					_, err := tx.Exec(`UPDATE work_context_snapshots SET configuration_json=json_set(configuration_json,'$.packages',json('[]')) WHERE work_id=? AND snapshot_id=?`, id, *work.ActiveContextID)
					return err
				}); err != nil {
					t.Fatal(err)
				}
			case "active-context":
				submission.ActiveContextId = "context-another-0001"
			}
			if err := check(); err == nil {
				t.Fatal("changed baseline accepted")
			}
		})
	}
}
