import assert from "node:assert/strict";
import test from "node:test";
import { AgentDaemonControl, RuntimeIdentityError } from "./daemon.js";

test("identity, readiness, model credential status, and drain are independent of user login fields", async () => {
  const identity = { workId: "work-1", generation: 3, instanceId: "instance-3" };
  const daemon = new AgentDaemonControl(identity);
  assert.equal(daemon.readiness().initializationComplete, false);
  assert.deepEqual(daemon.readiness().loadedSkills, []);
  daemon.configure({ modelCredentialStatus: "missing", loadedSkills: [{
    name: "fixture", identity: "sha256:abc", loaded: true, modelVisible: true, visibilityReason: "",
  }], contextIdentity: "context-3", resolvedTools: ["read"], initializationComplete: true });
  assert.equal(daemon.readiness().acceptingRuns, false);
  assert.equal("userId" in daemon.readiness(), false);
  assert.throws(
    () => daemon.verifyIdentity({ ...identity, generation: 2 }),
    (error) => error instanceof RuntimeIdentityError,
  );

  daemon.configure({
    modelCredentialStatus: "available", unavailableMcpServerIds: ["optional"],
    loadedSkills: daemon.readiness().loadedSkills, contextIdentity: "context-3",
    resolvedTools: ["read"], initializationComplete: true,
  });
  const finish = daemon.beginRun();
  let drained = false;
  const draining = daemon.drain().then(() => { drained = true; });
  await Promise.resolve();
  assert.equal(drained, false);
  assert.equal(daemon.readiness().acceptingRuns, false);
  finish();
  await draining;
  assert.equal(drained, true);
});

test("configuration preparation is atomic and preserves active Runs when busy", () => {
  const daemon = new AgentDaemonControl({ workId: "work-1", generation: 1, instanceId: "instance-1" });
  daemon.configure({
    modelCredentialStatus: "available", initializationComplete: true,
    contextIdentity: "context-1", loadedSkills: [], resolvedTools: ["read"],
  });
  const finish = daemon.beginRun();
  assert.deepEqual(daemon.prepareConfigurationChange(), { prepared: false, busy: true, activeRunCount: 1 });
  assert.equal(daemon.readiness().acceptingRuns, true);
  finish();
  assert.deepEqual(daemon.prepareConfigurationChange(), { prepared: true, busy: false, activeRunCount: 0 });
  assert.equal(daemon.readiness().acceptingRuns, false);
  assert.throws(() => daemon.beginRun(), /not ready/);
});

test("initialization-only readiness proves loading while rejecting Runs", () => {
  const daemon = new AgentDaemonControl({ workId: "work-1", generation: 2, instanceId: "instance-2" });
  daemon.configure({
    modelCredentialStatus: "available",
    contextIdentity: "context-candidate",
    loadedSkills: [{
      name: "candidate", identity: "sha256:abc", loaded: true,
      modelVisible: true, visibilityReason: "",
    }],
    resolvedTools: ["read"],
    initializationComplete: true,
    initializationOnly: true,
  });
  assert.equal(daemon.readiness().initializationComplete, true);
  assert.equal(daemon.readiness().acceptingRuns, false);
  assert.throws(() => daemon.beginRun(), /not ready/);
});
