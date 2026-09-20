import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeWorkResource,
  ConversationAccessDeniedError,
  filterVisibleResources,
  InvisibleResourceError,
  type UserPrincipal,
  type WorkAction,
  type WorkResource,
  type WorkResourceKind,
} from "./policy.js";

const owner: UserPrincipal = { userId: "user-a", role: "user" };
const other: UserPrincipal = { userId: "user-b", role: "user" };
const admin: UserPrincipal = { userId: "admin", role: "admin" };

const kinds: readonly WorkResourceKind[] = ["work", "run", "service", "operation", "retained-volume"];
const controlActions: readonly WorkAction[] = ["read-metadata", "control", "cleanup"];

test("owner and administrator control access is consistent for every Work resource kind", () => {
  for (const kind of kinds) {
    const resource = fixture(kind, "user-a");
    for (const action of controlActions) {
      assert.equal(authorizeWorkResource(owner, resource, action), resource, `${kind}:${action}:owner`);
      assert.equal(authorizeWorkResource(admin, resource, action), resource, `${kind}:${action}:admin`);
    }
  }
});

test("ordinary cross-user lookups are indistinguishable from unknown resources", () => {
  for (const kind of kinds) {
    for (const action of [...controlActions, "read-content", "interact"] as const) {
      const foreign = capture(() => authorizeWorkResource(other, fixture(kind, "user-a"), action));
      const missing = capture(() => authorizeWorkResource(other, undefined, action));
      assert.ok(foreign instanceof InvisibleResourceError, `${kind}:${action}`);
      assert.ok(missing instanceof InvisibleResourceError, `${kind}:${action}:missing`);
      assert.deepEqual(
        { name: foreign.name, code: foreign.code, message: foreign.message },
        { name: missing.name, code: missing.code, message: missing.message },
      );
    }
  }
});

test("administrator control permission does not grant conversation content or interaction", () => {
  for (const kind of ["work", "run"] as const) {
    for (const action of ["read-content", "interact"] as const) {
      assert.throws(
        () => authorizeWorkResource(admin, fixture(kind, "user-a"), action),
        ConversationAccessDeniedError,
      );
      assert.equal(authorizeWorkResource(owner, fixture(kind, "user-a"), action).ownerUserId, "user-a");
    }
  }
});

test("resource lists do not leak other owners to ordinary users", () => {
  const resources = [fixture("work", "user-a", "work-a"), fixture("work", "user-b", "work-b")];
  assert.deepEqual(filterVisibleResources(owner, resources, "read-metadata").map((item) => item.id), ["work-a"]);
  assert.deepEqual(filterVisibleResources(other, resources, "read-metadata").map((item) => item.id), ["work-b"]);
  assert.deepEqual(filterVisibleResources(admin, resources, "read-metadata").map((item) => item.id), ["work-a", "work-b"]);
  assert.deepEqual(filterVisibleResources(admin, resources, "read-content"), []);
});

function fixture(kind: WorkResourceKind, ownerUserId: string, id = `${kind}-1`): WorkResource {
  return { id, kind, workId: "work-1", ownerUserId };
}

function capture(run: () => unknown): InvisibleResourceError {
  try {
    run();
  } catch (error) {
    if (error instanceof InvisibleResourceError) return error;
    throw error;
  }
  throw new Error("expected authorization failure");
}
