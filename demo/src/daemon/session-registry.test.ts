import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SessionRegistry } from "./session-registry.js";

describe("SessionRegistry", () => {
  it("adds and looks up sessions", () => {
    const registry = new SessionRegistry<string>();
    registry.add("s1", "value-1", () => {});
    assert.equal(registry.size, 1);
    assert.equal(registry.get("s1")?.value, "value-1");
    assert.equal(registry.get("missing"), undefined);
  });

  it("starts sessions idle and tracks the busy flag", () => {
    const registry = new SessionRegistry<string>();
    const entry = registry.add("s1", "value-1", () => {});
    assert.equal(entry.busy, false);
    registry.markBusy("s1", true);
    assert.equal(registry.get("s1")?.busy, true);
    registry.markBusy("s1", false);
    assert.equal(registry.get("s1")?.busy, false);
  });

  it("ignores markBusy for an unknown session", () => {
    const registry = new SessionRegistry<string>();
    assert.doesNotThrow(() => registry.markBusy("missing", true));
  });

  it("rejects a duplicate id", () => {
    const registry = new SessionRegistry<string>();
    registry.add("s1", "value-1", () => {});
    assert.throws(() => registry.add("s1", "value-2", () => {}), /already registered/);
  });

  it("disposes a session when it is removed", async () => {
    const registry = new SessionRegistry<string>();
    let disposed = 0;
    registry.add("s1", "value-1", () => {
      disposed += 1;
    });
    assert.equal(await registry.remove("s1"), true);
    assert.equal(disposed, 1);
    assert.equal(registry.size, 0);
    assert.equal(await registry.remove("s1"), false);
  });

  it("disposes every session on shutdown", async () => {
    const registry = new SessionRegistry<string>();
    const disposed: string[] = [];
    registry.add("s1", "a", () => {
      disposed.push("s1");
    });
    registry.add("s2", "b", () => {
      disposed.push("s2");
    });
    await registry.disposeAll();
    assert.deepEqual(disposed.sort(), ["s1", "s2"]);
    assert.equal(registry.size, 0);
  });
});
