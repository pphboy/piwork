import assert from "node:assert/strict";
import test from "node:test";
import { Check } from "typebox/value";
import {
  BrainCandidateSubmissionSchema, SetSessionModelSchema, AgentRequestStateSchema, AgentRequestedPayloadSchema, AgentWaitRefSchema, RunModelDescriptionSchema,
  RunModelSelectorSchema, ServiceConnectionSchema, ServiceEventSchema, ReadinessResponse, SubmitRunRequest, isBrainVerificationTarget,
} from "./index.js";

test("model selection preserves omitted, explicit default, and explicit reference on protobuf wire", () => {
  for (const modelRef of [undefined, "", "model-0000000000000001"]) {
    const value = SubmitRunRequest.create({ workId: "work-000000000000001", sessionId: "session-1", submissionKey: "key", prompt: "hello", modelRef });
    assert.equal(SubmitRunRequest.decode(SubmitRunRequest.encode(value).finish()).modelRef, modelRef);
  }
  assert.equal(Check(RunModelSelectorSchema, { kind: "model", modelRef: "" }), false);
  assert.equal(Check(RunModelSelectorSchema, { kind: "work-default", credential: "secret" }), false);
  assert.equal(Check(RunModelDescriptionSchema, { modelRef: null, label: "Default", provider: "fixture", model: "local", credentialPath: "/secret" }), false);
});

test("candidate verification is one bounded private brain tool/input/check contract", () => {
  const target = { contractVersion: 1, toolName: "package:piwork-brain:brain_review_probe", input: { format: "completed-first" }, checkNames: ["review_format"] };
  assert.equal(isBrainVerificationTarget(target), true);
  for (const invalid of [undefined, { ...target, toolName: "builtin:read" }, { ...target, toolName: "package:piwork-brain:brain_feedback" },
    { ...target, toolName: "package:piwork-brain:brain_package_update" }, { ...target, checkNames: [] }, { ...target, checkNames: ["x", "x"] },
    { ...target, checkNames: ["中"] }, { ...target, checkNames: ["x".repeat(65)] }, { ...target, checkNames: Array.from({ length: 9 }, (_, n) => `check${n}`) },
    { ...target, input: { text: "中".repeat(3000) } }, { ...target, input: { token: "private" } },
    { ...target, input: { endpoint: "http://old-work:8080" } }, { ...target, input: { path: "/tmp/private" } }]) {
    assert.equal(isBrainVerificationTarget(invalid), false, JSON.stringify(invalid)?.slice(0, 120));
  }
});

test("missing readiness fields cannot advertise brain or model support", () => {
  const value = ReadinessResponse.decode(new Uint8Array());
  assert.equal(value.runModelContractVersion, 0);
  assert.equal(value.workFeedbackContractVersion, 0);
  assert.equal(value.workHistorySchemaVersion, 0);
  assert.equal(value.chatControlsContractVersion, 0);
});

test("feedback contract rejects unknown state, unsafe connections, invalid scopes and unsupported fields", () => {
  assert.equal(Check(AgentRequestStateSchema, "queued-run"), false);
  assert.equal(Check(AgentRequestStateSchema, "waiting_apply"), true);
  assert.equal(Check(ServiceConnectionSchema, { contractVersion: 1, serviceName: "todo", apiPortName: "http", mode: "pi-managed", url: "https://other.invalid" }), false);
  assert.equal(Check(AgentRequestedPayloadSchema, { reason: "feedback", goal: "x".repeat(8193), evidenceRefs: [] }), false);
  assert.equal(Check(AgentWaitRefSchema, { kind: "cron", id: "job-1", deadlineAt: "2026-10-03T01:00:00Z", nextPhase: "verifying", verificationGoal: "verify" }), false);
  const event = { contractVersion: 1, eventId: "event-1", origin: { workId: "work-000000000000001", serviceId: "service-000000000001" }, serviceName: "todo", type: "page.visited", occurredAt: "2026-10-03T01:00:00Z", stateVersion: "1", payload: { pathname: "/review" } };
  assert.equal(Check(ServiceEventSchema, event), true);
  assert.equal(Check(ServiceEventSchema, { ...event, origin: { ...event.origin, token: "secret" } }), false);
});


test("current candidate requires a fixed target and preference requires an explicit value", () => {
  const target = { contractVersion: 1, toolName: "package:piwork-brain:brain_review_probe", input: {}, checkNames: ["review_format"] };
  const digest = `sha256:${"a".repeat(64)}`;
  const candidate = { submissionKey: "submission-1", requestId: "request-1", verificationGoal: "verify", verificationTarget: target, expectedSourceDigest: digest, activeDigest: digest, desiredDigest: digest, activeContextId: "context-1" };
  assert.equal(Check(BrainCandidateSubmissionSchema, candidate), true);
  const { verificationTarget: _, ...missing } = candidate;
  assert.equal(Check(BrainCandidateSubmissionSchema, missing), false);
  assert.equal(Check(BrainCandidateSubmissionSchema, { ...candidate, credential: "secret" }), false);
  assert.equal(Check(SetSessionModelSchema, {}), false);
  assert.equal(Check(SetSessionModelSchema, { modelRef: null }), true);
  assert.equal(Check(SetSessionModelSchema, { modelRef: "model-0000000000000001" }), true);
});
