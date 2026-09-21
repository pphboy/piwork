import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore, SkillAlreadyExistsError } from "@piwork/core-store";
import { SkillArtifactStore } from "./skill-artifact-store.js";
import { CoreSkillService, SkillAdministrationError, SkillUnavailableError } from "./skills.js";

const admin = { userId: "operator", role: "admin" as const };
const user = { userId: "user-1", role: "user" as const };

test("Core Skill service authorizes before path access and projects safe ordered views", () => withFixture(({ service, root }) => {
  assert.throws(() => service.add(user, join(root, "does-not-exist")), SkillAdministrationError);
  createSkill(root, "z-last", "---\nname: hidden\ndescription: z\n---\nz", "z");
  createSkill(root, "a-first", "not frontmatter", "a");
  service.add(admin, join(root, "z-last"));
  service.add(admin, join(root, "a-first"));
  assert.deepEqual(service.listForUser(user), [{ name: "a-first" }, { name: "z-last" }]);
  const operator = service.listForOperator(admin);
  assert.deepEqual(operator.map(({ name }) => name), ["a-first", "z-last"]);
  assert.deepEqual(Object.keys(operator[0]!).sort(), ["createdAt", "enabled", "fileCount", "name", "totalBytes", "updatedAt"]);
  assert.equal(JSON.stringify(operator).includes(root), false);
  assert.equal(JSON.stringify(operator).includes("frontmatter"), false);
  service.disable(admin, "z-last");
  assert.deepEqual(service.listForUser(user), [{ name: "a-first" }]);
  assert.throws(() => service.showForUser(user, "z-last"), SkillUnavailableError);
  assert.throws(() => service.showForUser(user, "missing"), SkillUnavailableError);
}));

test("duplicate and basename-mismatched mutations preserve current content", () => withFixture(({ service, store, root }) => {
  createSkill(root, "code-review", "one", "support-one");
  service.add(admin, join(root, "code-review"));
  const original = store.getManagedSkill("code-review")!.currentIdentity;
  assert.throws(() => service.add(admin, join(root, "code-review")), SkillAlreadyExistsError);
  createSkill(root, "reviewer", "two", "support-two");
  assert.throws(() => service.update(admin, "code-review", join(root, "reviewer")), /does not match/);
  assert.equal(store.getManagedSkill("code-review")?.currentIdentity, original);
  writeFileSync(join(root, "code-review", "SKILL.md"), "updated");
  service.update(admin, "code-review", join(root, "code-review"));
  assert.notEqual(store.getManagedSkill("code-review")?.currentIdentity, original);
}));

test("default references block disable/remove and cleanup preserves referenced artifacts", () => withFixture(({ service, store, managed, root }) => {
  createSkill(root, "code-review", "one", "support");
  service.add(admin, join(root, "code-review"));
  store.setControlMetadata("default_work_configuration", { version: 1, configuration: { skills: ["code-review"] } }, new Date().toISOString());
  assert.throws(() => service.disable(admin, "code-review"), /selected by default/);
  assert.throws(() => service.remove(admin, "code-review"), /selected by default/);
  store.setControlMetadata("default_work_configuration", { version: 1, configuration: { skills: [] } }, new Date().toISOString());
  service.remove(admin, "code-review");
  assert.equal(existsSync(join(managed, "code-review")), false);
}));

function createSkill(root: string, name: string, manifest: string, support: string): void {
  const directory = join(root, name);
  if (!existsSync(directory)) mkdirSync(join(directory, "references"), { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), manifest);
  writeFileSync(join(directory, "references", "guide.txt"), support);
}

function withFixture(run: (fixture: { root: string; managed: string; store: CoreStore; service: CoreSkillService }) => void): void {
  const root = mkdtempSync(join(tmpdir(), "piwork-skills-service-"));
  const managed = join(root, "managed");
  const store = CoreStore.open({ databasePath: join(root, "core.sqlite") });
  const service = new CoreSkillService(store, new SkillArtifactStore(managed), () => new Date("2026-09-21T00:00:00Z"));
  try { run({ root, managed, store, service }); }
  finally { store.close(); rmSync(root, { recursive: true, force: true }); }
}
