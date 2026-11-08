import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isServiceViewTarget, isServiceViewRequest, serviceViewRequest } from "./service-view-controls.js";

const fixture = JSON.parse(readFileSync(new URL("../../../fixtures/service-view-controls.json", import.meta.url), "utf8"));
test("Service view wire targets reject foreign controls and produce a bounded request", () => {
  for (const target of fixture.validTargets) {
    assert.equal(isServiceViewTarget(target), true);
    for (const action of ["select", "refresh"] as const) {
      const request = serviceViewRequest(action, target);
      assert.deepEqual(request, { kind: "piwork.service-view", version: 1, status: "requested", action, ...target });
      assert.ok(Buffer.byteLength(JSON.stringify(request)) < 1024);
      assert.equal(isServiceViewRequest(request), true);
      for (const patch of fixture.invalidRequests) assert.equal(isServiceViewRequest({ ...request, ...patch }), false);
    }
  }
  for (const target of fixture.invalidTargets) {
    assert.equal(isServiceViewTarget(target), false);
    assert.throws(() => serviceViewRequest("select", target));
  }
});
