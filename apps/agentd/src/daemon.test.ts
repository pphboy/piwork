import assert from "node:assert/strict";
import test from "node:test";
import { AgentDaemonControl, RuntimeIdentityError } from "./daemon.js";

test("identity, readiness, model credential status, and drain are independent of user login fields", async () => {
  const identity = { workId: "work-1", generation: 3, instanceId: "instance-3" };
  const daemon = new AgentDaemonControl(identity);
  daemon.configure({ modelCredentialStatus: "missing", loadedSkillDigests: ["sha256:abc"] });
  assert.equal(daemon.readiness().acceptingRuns, false);
  assert.equal("userId" in daemon.readiness(), false);
  assert.throws(
    () => daemon.verifyIdentity({ ...identity, generation: 2 }),
    (error) => error instanceof RuntimeIdentityError,
  );

  daemon.configure({ modelCredentialStatus: "available", unavailableMcpServerIds: ["optional"] });
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
