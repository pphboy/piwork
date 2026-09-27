import assert from "node:assert/strict";
import test from "node:test";
import { assertPiPackageHostPeers, parsePiPackageManifest, parsePiPackageSource } from "./source.js";
import { inspectPiPackageResources } from "./inventory.js";

test("four CLI package source forms are distinguished without reading Core host paths", () => {
  assert.deepEqual(parsePiPackageSource("npm:@example/pi-tools@1.0.0"), { kind: "npm", spec: "@example/pi-tools@1.0.0" });
  assert.deepEqual(parsePiPackageSource("git:github.com/example/pi-tools@v1"), {
    kind: "git", spec: "github.com/example/pi-tools@v1", url: "https://github.com/example/pi-tools", ref: "v1",
  });
  assert.deepEqual(parsePiPackageSource("./local-package"), { kind: "local", path: "./local-package", displayName: "local-package" });
  assert.deepEqual(parsePiPackageSource("./pi-tools.zip"), { kind: "zip", path: "./pi-tools.zip", displayName: "pi-tools.zip" });
});

test("source parser rejects credentials, SSH, malformed npm and ambiguous relative paths", () => {
  for (const source of [
    "git:https://user:secret@github.com/example/pi-tools@main", "git:git@github.com:example/pi-tools",
    "git:http://github.com/example/pi-tools", "npm:https://registry.example/package", "npm:@example", "local-package",
  ]) assert.throws(() => parsePiPackageSource(source));
});

test("manifest identity requires a valid name and maps absent version to null", () => {
  assert.deepEqual(parsePiPackageManifest(Buffer.from('{"name":"@example/pi-tools"}')), { name: "@example/pi-tools", version: null, pi: null, dependencies: {}, peerDependencies: {} });
  for (const value of ["{}", '{"name":""}', '{"name":"A Name"}', '{"name":"tools","version":""}',
    '{"name":"tools","pi":{"skills":["../outside"]}}']) {
    assert.throws(() => parsePiPackageManifest(Buffer.from(value)));
  }
});

test("Pi host peer ranges are validated without rewriting other peer declarations", () => {
  const manifest = parsePiPackageManifest(Buffer.from(JSON.stringify({ name: "tools", peerDependencies: {
    "@earendil-works/pi-ai": ">=0.86.1 <0.87.0", "example-peer": "workspace:*",
  } })));
  assert.deepEqual(manifest.peerDependencies, { "@earendil-works/pi-ai": ">=0.86.1 <0.87.0", "example-peer": "workspace:*" });
  for (const peers of [null, [], { "@earendil-works/pi-ai": "" }, { "@earendil-works/pi-ai": "workspace:*" },
    { "@earendil-works/pi-ai": ">=not-a-version" }, { "bad name": "1.0.0" }]) {
    assert.throws(() => parsePiPackageManifest(Buffer.from(JSON.stringify({ name: "tools", peerDependencies: peers }))),
      (error) => (error as { code?: string }).code === "PI_PACKAGE_INVALID_MANIFEST");
  }
});

test("Pi host peers use exact selected-image versions and exclude prereleases", () => {
  const hostVersions = Object.fromEntries(["@earendil-works/pi-ai", "@earendil-works/pi-agent-core",
    "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"].map((name) => [name, "0.86.1"]));
  const manifest = parsePiPackageManifest(Buffer.from(JSON.stringify({ name: "tools", peerDependencies: {
    "@earendil-works/pi-ai": ">=0.86.1", "@earendil-works/pi-coding-agent": "^0.86.1",
  } })));
  assert.doesNotThrow(() => assertPiPackageHostPeers(manifest, hostVersions));
  for (const versions of [{ ...hostVersions, "@earendil-works/pi-ai": "0.86.0" },
    { ...hostVersions, "@earendil-works/pi-ai": "0.86.1-rc.1" },
    { ...hostVersions, "@earendil-works/pi-ai": "not-a-version" },
    { ...hostVersions, "@earendil-works/pi-ai": "" }]) {
    assert.throws(() => assertPiPackageHostPeers(manifest, versions),
      (error) => (error as { code?: string }).code === "PI_PACKAGE_SDK_VERSION_UNSUPPORTED");
  }
});

test("resource inventory uses manifest declarations and rejects missing paths", () => {
  const paths = [
    { path: "extensions/main.ts", type: "file" as const },
    { path: "skills/review/SKILL.md", type: "file" as const },
    { path: "skills/review/support.md", type: "file" as const },
    { path: "skills/review/assets/example.txt", type: "file" as const },
    { path: "prompts/review.md", type: "file" as const },
    { path: "themes/dark.json", type: "file" as const },
  ];
  const conventions = inspectPiPackageResources(parsePiPackageManifest(Buffer.from('{"name":"tools"}')), paths);
  assert.deepEqual(Object.fromEntries(Object.entries(conventions).map(([kind, items]) => [kind, items.length])), { extensions: 1, skills: 1, prompts: 1, themes: 1 });
  const declared = parsePiPackageManifest(Buffer.from('{"name":"tools","pi":{"extensions":["./extensions/*.ts"],"skills":["skills"],"prompts":[],"themes":["themes/dark.json"]}}'));
  assert.deepEqual(inspectPiPackageResources(declared, paths), {
    extensions: ["extensions/main.ts"], skills: ["skills/review/SKILL.md"], prompts: [], themes: ["themes/dark.json"],
  });
  const direct = parsePiPackageManifest(Buffer.from('{"name":"tools","pi":{"skills":["skills/review/SKILL.md"]}}'));
  assert.deepEqual(inspectPiPackageResources(direct, paths).skills, ["skills/review/SKILL.md"]);
  const missing = parsePiPackageManifest(Buffer.from('{"name":"tools","pi":{"extensions":["missing.ts"]}}'));
  assert.throws(() => inspectPiPackageResources(missing, paths), /no matching resource/);
});

test("Skill directory and glob declarations count SDK entrypoints, not supporting files", () => {
  const paths = [
    { path: "skills", type: "directory" as const },
    { path: "skills/review", type: "directory" as const },
    { path: "skills/review/SKILL.md", type: "file" as const },
    { path: "skills/review/support.md", type: "file" as const },
    { path: "skills/review/assets/example.txt", type: "file" as const },
    { path: "skills/quick.md", type: "file" as const },
  ];
  for (const declaration of ["skills", "skills/*", "skills/review"]) {
    const manifest = parsePiPackageManifest(Buffer.from(JSON.stringify({ name: "tools", pi: { skills: [declaration] } })));
    const expected = declaration === "skills/review" ? ["skills/review/SKILL.md"] : ["skills/quick.md", "skills/review/SKILL.md"];
    assert.deepEqual(inspectPiPackageResources(manifest, paths).skills, expected);
  }
  const glob = parsePiPackageManifest(Buffer.from('{"name":"tools","pi":{"skills":["skills/qui*.md"]}}'));
  assert.deepEqual(inspectPiPackageResources(glob, paths).skills, ["skills/quick.md"]);
});
