//go:build integration

package coreapp

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/moby/moby/client"
	"piwork/internal/contracts"
	"piwork/internal/dockerengine"
	"piwork/internal/internaltls"
)

func TestNativeBrainCandidateCapturesThroughScopedRPCAndExplicitApply(t *testing.T) {
	a, base, auth, id, ctx := nativeApplyFixture(t)
	host := os.Getenv("PIWORK_TEST_DOCKER_HOST")
	if host == "" {
		host = "unix:///var/run/docker.sock"
	}
	raw, err := client.NewClientWithOpts(client.WithHost(host), client.WithAPIVersionNegotiation())
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	actor := func() serviceActor {
		var generation int64
		var instance string
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT generation,instance_id FROM runtime_generations WHERE work_id=? AND state='ready' ORDER BY generation DESC LIMIT 1`, id).Scan(&generation, &instance)
		}); err != nil {
			t.Fatal(err)
		}
		return serviceActor{Runtime: &internaltls.Scope{InstallationID: a.Store.InstallationID(), WorkID: id, Generation: generation, InstanceID: instance}}
	}
	exec := func(program string) map[string]any {
		t.Helper()
		var containerID string
		if err := a.Store.Read(ctx, func(tx *sql.Tx) error {
			return tx.QueryRow(`SELECT runtime_id FROM resource_bindings WHERE work_id=? AND resource_kind='agent' AND logical_id=?`, id, id+"/agentd").Scan(&containerID)
		}); err != nil {
			t.Fatal(err)
		}
		job, err := raw.ExecCreate(ctx, containerID, client.ExecCreateOptions{Cmd: []string{"node", "--input-type=module", "-e", program}, AttachStdout: true, AttachStderr: true, User: "10001:10001"})
		if err != nil {
			t.Fatal(err)
		}
		attached, err := raw.ExecAttach(ctx, job.ID, client.ExecAttachOptions{})
		if err != nil {
			t.Fatal(err)
		}
		var out, stderr bytes.Buffer
		err = dockerengine.Demultiplex(ctx, attached.Reader, &out, &stderr)
		attached.Close()
		if err != nil {
			t.Fatal(err)
		}
		for {
			view, err := raw.ExecInspect(ctx, job.ID, client.ExecInspectOptions{})
			if err != nil {
				t.Fatal(err)
			}
			if !view.Running {
				if view.ExitCode != 0 {
					t.Fatal("current Agent assertion failed", stderr.String())
				}
				break
			}
			time.Sleep(10 * time.Millisecond)
		}
		var result map[string]any
		if json.Unmarshal(out.Bytes(), &result) != nil {
			t.Fatal("invalid SDK assertion result", out.String())
		}
		return result
	}
	original := actor()
	heads, err := a.brainCandidateState(ctx, original, id, "")
	if err != nil || heads.Active == nil || heads.Desired == nil {
		t.Fatal(heads, err)
	}
	editor := `import {appendFile} from 'node:fs/promises';import {digestPiPackageTree} from '/workspace/packages/pi-package/dist/index.js';const source='/var/data/workspace/.pi/packages/piwork-brain';await appendFile(source+'/brain.md','\nCandidate cognition revision from Work files\n');console.log(JSON.stringify({digest:await digestPiPackageTree(source)}));`
	sourceDigest := exec(editor)["digest"].(string)
	submission := contracts.BrainCandidateSubmission{SubmissionKey: "actual-native-brain", RequestId: "request-native-brain-0001", VerificationGoal: "review probe follows captured brain", VerificationTarget: contracts.BrainVerificationTarget{ContractVersion: 1, ToolName: "package:piwork-brain:brain_service", Input: map[string]json.RawMessage{"serviceId": json.RawMessage(`"service-review-00000001"`), "operation": json.RawMessage(`"query"`), "name": json.RawMessage(`"review"`)}, CheckNames: []string{"review-result"}}, ExpectedSourceDigest: contracts.Digest(sourceDigest), ActiveDigest: contracts.Digest(heads.Active.Digest), DesiredDigest: contracts.Digest(heads.Desired.Digest), ActiveContextId: contracts.Identifier(heads.Active.ContextID)}
	payload, _ := json.Marshal(submission)
	invoke := `import {readFileSync} from 'node:fs';import {WorkPrivateClient} from '/workspace/apps/agentd/dist/work-private-client.js';const config=JSON.parse(readFileSync('/etc/piwork/runtime.json','utf8'));const client=new WorkPrivateClient(config.serviceControl);try{console.log(JSON.stringify(await client.prepareBrain(` + string(payload) + `)));}finally{client.close();}`
	accepted := exec(invoke)
	operationID := accepted["operationId"].(string)
	if status, body := packageHTTPCall(t, base, "/api/v1/works/"+id+"/configuration/agents", "PUT", auth, map[string]any{"agentsMd": "# Preserve concurrent user cognition edit"}); status != 200 {
		t.Fatal(status, body)
	}
	waitWorkOperation(t, ctx, a, operationID)
	state, err := a.brainCandidateState(ctx, original, id, submission.SubmissionKey)
	if err != nil || state.Candidate == nil || state.Candidate.State != "succeeded" || state.Candidate.ArtifactDigest == "" || state.Desired.Digest != state.Candidate.ArtifactDigest || state.Active.Digest != heads.Active.Digest || state.Active.ContextID != heads.Active.ContextID {
		t.Fatal(state, err)
	}
	saved, err := a.Store.Configuration(ctx, id)
	if err != nil || !strings.Contains(saved.DesiredConfigJSON, "Preserve concurrent user cognition edit") {
		t.Fatal(saved, err)
	}
	// Editing after capture and replaying the original key cannot recapture.
	later := exec(editor)["digest"].(string)
	if later == sourceDigest {
		t.Fatal("source edit fixture failed")
	}
	replay := exec(invoke)
	if replay["operationId"] != operationID || replay["reused"] != true {
		t.Fatal(replay)
	}
	state, err = a.brainCandidateState(ctx, original, id, submission.SubmissionKey)
	if err != nil || state.Candidate.SourceDigest != sourceDigest {
		t.Fatal(state, err)
	}
	submission.SubmissionKey = "different-candidate"
	if _, err = a.acceptBrainCandidate(ctx, original, id, submission); err == nil {
		t.Fatal("stale desired baseline published")
	}
	status, apply := packageHTTPCall(t, base, "/api/v1/works/"+id+"/configuration/apply", "POST", auth, map[string]string{"idempotencyKey": "apply-native-brain"})
	if status != 202 {
		t.Fatal(status, apply)
	}
	waitWorkOperation(t, ctx, a, apply["operationId"].(string))
	next := actor()
	state, err = a.brainCandidateState(ctx, next, id, "actual-native-brain")
	if err != nil || state.Active.Digest != state.Candidate.ArtifactDigest || state.Candidate.Apply == nil || state.Candidate.Apply.State != "succeeded" {
		t.Fatal(state, err)
	}
	if _, err = a.brainCandidateState(ctx, original, id, "actual-native-brain"); err == nil {
		t.Fatal("old generation retained private candidate authority")
	}
	work, err := a.Store.Work(ctx, id, false)
	if err != nil {
		t.Fatal(err)
	}
	agent, _, err := a.agentRoutes.Admission(*next.Runtime, *work.ActiveContextID)
	if err != nil {
		t.Fatal(err)
	}
	ready, err := agent.Readiness(ctx, *work.ActiveContextID, false)
	if err != nil || len(ready.LoadedPackages) != 1 || ready.LoadedPackages[0].ContentDigest != state.Candidate.ArtifactDigest {
		t.Fatal("actual SDK did not load immutable candidate", ready, err)
	}
	encoded, _ := json.Marshal(state)
	if strings.Contains(string(encoded), a.options.DataDirectory) {
		t.Fatal("private host path leaked")
	}
	t.Log("Go scoped mTLS RPC captured fixed Work brain through native read-only helper, preserved concurrent desired edit, replayed original frozen candidate, and loaded it only after explicit Apply")
}
