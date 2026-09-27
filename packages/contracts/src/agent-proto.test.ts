import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentServiceService,
  CancelRunRequest,
  PrepareConfigurationChangeRequest,
  PrepareConfigurationChangeResponse,
  ReadinessResponse,
  Run,
  RunEvent,
  RunState,
  Session,
  SubmitRunRequest,
  WatchRunRequest,
} from "./agent.js";

test("session and run messages survive binary serialization", () => {
  const session = roundTrip(Session, {
    workId: "work-0199e6d8abcd",
    sessionId: "session-0199e6d8abcd",
    sdkHistoryPath: "/var/session/history.jsonl",
    createdAt: "2026-09-20T00:00:00Z",
    updatedAt: "2026-09-20T00:01:00Z",
  });
  assert.equal(session.sessionId, "session-0199e6d8abcd");

  const run = roundTrip(Run, {
    workId: session.workId,
    sessionId: session.sessionId,
    runId: "run-0199e6d8abcd",
    submissionKey: "submit-1",
    state: RunState.RUN_STATE_INTERRUPTED,
    promptDigest: `sha256:${"a".repeat(64)}`,
    finalText: "partial output",
    error: { code: "DAEMON_RESTARTED", message: "execution owner exited", retryable: false },
    acceptedAt: "2026-09-20T00:02:00Z",
    startedAt: "2026-09-20T00:02:01Z",
    finishedAt: "2026-09-20T00:02:02Z",
    earliestAvailableSequence: 41n,
    latestSequence: 10_041n,
  });
  assert.equal(run.state, RunState.RUN_STATE_INTERRUPTED);
  assert.equal(run.earliestAvailableSequence, 41n);
  assert.equal(run.latestSequence, 10_041n);
  assert.equal(run.error?.code, "DAEMON_RESTARTED");
});

test("submit idempotency, watch cursor, cancellation, and event union serialize", () => {
  const submit = roundTrip(SubmitRunRequest, {
    workId: "work-0199e6d8abcd",
    sessionId: "session-0199e6d8abcd",
    submissionKey: "client-submit-42",
    prompt: "continue the durable session",
  });
  assert.equal(submit.submissionKey, "client-submit-42");

  const watch = roundTrip(WatchRunRequest, {
    workId: submit.workId,
    runId: "run-0199e6d8abcd",
    afterSequence: 9_999n,
  });
  assert.equal(watch.afterSequence, 9_999n);

  const cancel = roundTrip(CancelRunRequest, {
    workId: submit.workId,
    runId: watch.runId,
    idempotencyKey: "cancel-1",
  });
  assert.equal(cancel.idempotencyKey, "cancel-1");

  const event = roundTrip(RunEvent, {
    workId: submit.workId,
    sessionId: submit.sessionId,
    runId: watch.runId,
    sequence: 10_000n,
    createdAt: "2026-09-20T00:03:00Z",
    kind: { $case: "text", text: { delta: "done" } },
  });
  assert.equal(event.kind?.$case, "text");
  if (event.kind?.$case === "text") assert.equal(event.kind.text.delta, "done");
});

test("generated grpc-js service exposes the durable Agent API", () => {
  assert.deepEqual(Object.keys(AgentServiceService), [
    "readiness",
    "prepareConfigurationChange",
    "drain",
    "createSession",
    "listSessions",
    "readSession",
    "submitRun",
    "getRun",
    "watchRun",
    "cancelRun",
  ]);
  assert.equal(AgentServiceService.watchRun.responseStream, true);
  assert.equal(AgentServiceService.submitRun.responseStream, false);
});

test("readiness and configuration-gate messages preserve the context handshake", () => {
  const absent = roundTrip(ReadinessResponse, {
    workId: "work-0199e6d8abcd", generation: 1n, instanceId: "instance-1", protocolVersion: "v1",
    acceptingRuns: false, draining: false, contextContractVersion: 0, contextIdentity: "",
    initializationComplete: false, loadedSkills: [], resolvedTools: [], activeRunCount: 0,
    packageContractVersion: 0, loadedPackages: [], packageResources: [], packageDiagnostics: [],
  });
  assert.equal(absent.contextContractVersion, 0);
  assert.deepEqual(absent.loadedSkills, []);

  const ready = roundTrip(ReadinessResponse, {
    ...absent,
    contextContractVersion: 1,
    packageContractVersion: 1,
    contextIdentity: "context-0199e6d8abcd",
    initializationComplete: true,
    loadedSkills: [{ name: "code-review", identity: "sha256:abc", loaded: true, modelVisible: true, visibilityReason: "" }],
    resolvedTools: ["read", "bash"],
  });
  assert.deepEqual(ready.loadedSkills, [{ name: "code-review", identity: "sha256:abc", loaded: true, modelVisible: true, visibilityReason: "" }]);

  const request = roundTrip(PrepareConfigurationChangeRequest, { workId: ready.workId, generation: ready.generation, instanceId: ready.instanceId });
  assert.equal(request.instanceId, "instance-1");
  assert.deepEqual(roundTrip(PrepareConfigurationChangeResponse, { prepared: false, busy: true, activeRunCount: 1 }), { prepared: false, busy: true, activeRunCount: 1 });
  assert.deepEqual(roundTrip(PrepareConfigurationChangeResponse, { prepared: true, busy: false, activeRunCount: 0 }), { prepared: true, busy: false, activeRunCount: 0 });
});

interface MessageCodec<T> {
  encode(message: T): { finish(): Uint8Array };
  decode(bytes: Uint8Array): T;
}

function roundTrip<T>(codec: MessageCodec<T>, value: T): T {
  return codec.decode(codec.encode(value).finish());
}
