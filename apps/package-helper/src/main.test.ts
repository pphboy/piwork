import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { packPiPackageDirectory, validatePiPackageArtifact } from "@piwork/pi-package";
import { runPackageHelper } from "./main.js";

const execute = promisify(execFile);

async function createHostModuleFixture(root: string, version = "0.86.1"): Promise<string> {
  const moduleRoot = join(root, "host-modules");
  for (const name of ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core", "@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
    const directory = join(moduleRoot, ...name.split("/"));
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "package.json"), JSON.stringify({ name, version }));
  }
  return moduleRoot;
}

test("trusted capture validates a prepared tree and emits a frozen artifact ZIP", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-helper-"));
  try {
    const workRoot = join(root, "work"), spoolRoot = join(root, "spool");
    await mkdir(join(workRoot, "result"), { recursive: true });
    await mkdir(spoolRoot);
    await writeFile(join(workRoot, "result", "package.json"), '{"name":"tools","version":"1.0.0"}');
    await writeFile(join(spoolRoot, "request.json"), JSON.stringify({ sourceKind: "zip", resolvedSource: "tools.zip",
      preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" } }));
    const captured = await runPackageHelper("capture", { workRoot, spoolRoot }) as { metadata: { name: string; contentDigest: string }; zipSha256: string };
    assert.equal(captured.metadata.name, "tools");
    assert.match(captured.metadata.contentDigest, /^sha256:[a-f0-9]{64}$/);
    assert.match(captured.zipSha256, /^[a-f0-9]{64}$/);
    assert.equal((JSON.parse(await readFile(join(spoolRoot, "result.json"), "utf8")) as { zipSha256: string }).zipSha256, captured.zipSha256);
    assert.ok((await readFile(join(spoolRoot, "artifact.zip"))).length > 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("trusted volume measurement counts sparse lifecycle output without following links", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-measure-"));
  try {
    const workRoot = join(root, "work");
    await mkdir(workRoot);
    const descriptor = await (await import("node:fs/promises")).open(join(workRoot, "cache"), "w");
    try { await descriptor.truncate(4 * 1024 * 1024 * 1024 + 1); }
    finally { await descriptor.close(); }
    const measured = await runPackageHelper("measure", { workRoot, spoolRoot: root }) as { bytes: number };
    assert.ok(measured.bytes > 4 * 1024 * 1024 * 1024);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("known source and dependency command failures have safe distinct codes", { concurrency: false }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-command-failures-"));
  const originalPath = process.env.PATH;
  try {
    const bin = join(root, "bin");
    await mkdir(bin);
    for (const name of ["npm", "git"]) {
      await writeFile(join(bin, name), "#!/bin/sh\necho child-private-marker >&2\nexit 7\n");
      await chmod(join(bin, name), 0o755);
    }
    process.env.PATH = `${bin}:${originalPath ?? "/usr/bin:/bin"}`;
    const hostModuleRoot = await createHostModuleFixture(root);
    const prepare = async (label: string, source: unknown, inputZip?: string) => {
      const base = join(root, label), sourceRoot = join(base, "source"), workRoot = join(base, "work");
      await mkdir(sourceRoot, { recursive: true }); await mkdir(workRoot);
      await writeFile(join(sourceRoot, "request.json"), JSON.stringify({ source }));
      if (inputZip) await (await import("node:fs/promises")).copyFile(inputZip, join(sourceRoot, "input.zip"));
      return runPackageHelper("prepare", { sourceRoot, workRoot, spoolRoot: base, hostModuleRoot });
    };
    const packageRoot = join(root, "local");
    await mkdir(packageRoot);
    await writeFile(join(packageRoot, "package.json"), '{"name":"fixture-tools","version":"1.0.0"}');
    const zip = join(root, "local.zip");
    await packPiPackageDirectory(packageRoot, zip);
    for (const [label, source, zipPath, code] of [
      ["npm", { kind: "npm", spec: "fixture-tools@1.0.0" }, undefined, "PI_PACKAGE_SOURCE_FETCH_FAILED"],
      ["git", { kind: "git", spec: "github.com/example/fixture-tools@v1" }, undefined, "PI_PACKAGE_SOURCE_FETCH_FAILED"],
      ["dependency", { kind: "local", displayName: "local" }, zip, "PI_PACKAGE_DEPENDENCY_INSTALL_FAILED"],
    ] as const) {
      await assert.rejects(prepare(label, source, zipPath), (error: unknown) =>
        (error as { code?: string }).code === code && !(error as Error).message.includes("child-private-marker"));
    }
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("unlocked runtime installation does not resolve unavailable dev dependencies", { concurrency: false, timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-runtime-only-"));
  const previousRegistry = process.env.NPM_CONFIG_REGISTRY;
  const previousCache = process.env.NPM_CONFIG_CACHE;
  let requests = 0;
  const registry = createServer((_request, response) => { requests += 1; response.writeHead(404); response.end("not found"); });
  await new Promise<void>((resolve) => registry.listen(0, "127.0.0.1", resolve));
  const address = registry.address(); assert.ok(address && typeof address !== "string");
  try {
    process.env.NPM_CONFIG_REGISTRY = `http://127.0.0.1:${address.port}/`;
    process.env.NPM_CONFIG_CACHE = join(root, "npm-cache");
    const packageRoot = join(root, "package"), sourceRoot = join(root, "source"), workRoot = join(root, "work");
    await mkdir(packageRoot); await mkdir(sourceRoot); await mkdir(workRoot);
    const original = { name: "pi-web-access", version: "0.31.0", devDependencies: { "@example/unavailable-dev-only": "1.0.0" } };
    await writeFile(join(packageRoot, "package.json"), JSON.stringify(original));
    await packPiPackageDirectory(packageRoot, join(sourceRoot, "input.zip"));
    await writeFile(join(sourceRoot, "request.json"), JSON.stringify({ source: { kind: "zip", displayName: "web.zip" } }));
    const result = await runPackageHelper("prepare", { workRoot, spoolRoot: root, sourceRoot,
      hostModuleRoot: await createHostModuleFixture(root) }) as { name: string };
    assert.equal(result.name, "pi-web-access");
    assert.equal(requests, 0, "runtime-only install must not resolve the unavailable development tree");
    assert.deepEqual(JSON.parse(await readFile(join(workRoot, "result", "package.json"), "utf8")), original);
  } finally {
    if (previousRegistry === undefined) delete process.env.NPM_CONFIG_REGISTRY; else process.env.NPM_CONFIG_REGISTRY = previousRegistry;
    if (previousCache === undefined) delete process.env.NPM_CONFIG_CACHE; else process.env.NPM_CONFIG_CACHE = previousCache;
    await new Promise<void>((resolve) => registry.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("npm and Git preparation freeze resolved identity through argv-only commands", { concurrency: false }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-sources-"));
  const originalPath = process.env.PATH;
  try {
    const hostModuleRoot = await createHostModuleFixture(root);
    const bin = join(root, "bin");
    await mkdir(bin);
    const npm = join(bin, "npm"), git = join(bin, "git");
    await writeFile(npm, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
const args = process.argv.slice(2), prefix = args[args.indexOf("--prefix") + 1];
const source = args.at(-1);
if (args[0] === "pack") {
  const split = source.lastIndexOf("@"), name = source.slice(0, split), version = source.slice(split + 1);
  const destination = args[args.indexOf("--pack-destination") + 1];
  const packageRoot = path.join(destination, "pack-source", "package");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ name, version,
    ...(name === "pi-web-access" ? { dependencies: { runtime: "1.0.0" },
      devDependencies: { "@earendil-works/pi-coding-agent": "0.86.1", typescript: "^7.0.2" } } : {}),
    ...(name.includes("requires-new-pi") ? { peerDependencies: { "@earendil-works/pi-ai": ">=0.87.0" } } : {}) }));
  if (name.includes("oversized")) for (let index = 0; index < 17; index++) {
    const descriptor = fs.openSync(path.join(packageRoot, "large-" + index), "w");
    fs.ftruncateSync(descriptor, 64 * 1024 * 1024);
    fs.closeSync(descriptor);
  }
  const filename = name.replaceAll("/", "-").replace("@", "") + "-" + version + ".tgz";
  cp.execFileSync("tar", ["-czf", path.join(destination, filename), "-C", path.dirname(packageRoot), "package"]);
  fs.rmSync(path.join(destination, "pack-source"), { recursive: true });
  process.stdout.write(filename + "\\n");
  process.exit(0);
}
if (args[0] !== "install" && args[0] !== "ci") process.exit(2);
fs.writeFileSync(path.join(prefix, "npm-command.txt"), args[0]);
fs.writeFileSync(path.join(prefix, "npm-saw-dev-dependencies.txt"), String("devDependencies" in JSON.parse(fs.readFileSync(path.join(prefix, "package.json")))));
if (source && source.includes("@") && !source.startsWith("/")) {
  const split = source.lastIndexOf("@"), name = source.slice(0, split), version = source.slice(split + 1);
  const target = path.join(prefix, "node_modules", ...name.split("/"));
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name, version }));
}
`);
    await writeFile(git, `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path"), args = process.argv.slice(2);
if (args[0] === "clone") {
  const target = args.at(-1); fs.mkdirSync(path.join(target, ".git"), { recursive: true });
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "@example/git-tools", version: "2.0.0",
    ...(args[2].includes("requires-new-pi") ? { peerDependencies: { "@earendil-works/pi-ai": ">=0.87.0" } } : {}) }));
  fs.writeFileSync(path.join(target, "package-lock.json"), JSON.stringify({ name: "@example/git-tools", version: "2.0.0", lockfileVersion: 3,
    packages: { "": { name: "@example/git-tools", version: "2.0.0", dependencies: args[2].includes("stale") ? { broken: "1.0.0" } : {} } } }));
  if (args[2].includes("oversized")) for (let index = 0; index < 17; index++) {
    const descriptor = fs.openSync(path.join(target, "large-" + index), "w");
    fs.ftruncateSync(descriptor, 64 * 1024 * 1024);
    fs.closeSync(descriptor);
  }
} else if (args.includes("rev-parse")) process.stdout.write("0123456789abcdef0123456789abcdef01234567\\n");
else if (!args.includes("checkout")) process.exit(2);
`);
    await chmod(npm, 0o755); await chmod(git, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? "/usr/bin:/bin"}`;
    const prepare = async (label: string, source: unknown) => {
      const workRoot = join(root, label, "work"), spoolRoot = join(root, label, "spool"), sourceRoot = join(root, label, "source");
      await mkdir(workRoot, { recursive: true }); await mkdir(spoolRoot); await mkdir(sourceRoot);
      await writeFile(join(sourceRoot, "request.json"), JSON.stringify({ source }));
      return runPackageHelper("prepare", { workRoot, spoolRoot, sourceRoot, hostModuleRoot }) as Promise<{ name: string; version: string; resolvedSource: string }>;
    };
    const npmResult = await prepare("npm", { kind: "npm", spec: "@example/npm-tools@1.0.0" });
    assert.deepEqual(npmResult, { name: "@example/npm-tools", version: "1.0.0", sourceKind: "npm", resolvedSource: "@example/npm-tools@1.0.0" });
    const web = await prepare("npm-web", { kind: "npm", spec: "pi-web-access@0.31.0" });
    assert.equal(web.name, "pi-web-access");
    assert.equal(await readFile(join(root, "npm-web", "work", "result", "npm-saw-dev-dependencies.txt"), "utf8"), "false");
    assert.deepEqual((JSON.parse(await readFile(join(root, "npm-web", "work", "result", "package.json"), "utf8")) as { devDependencies: Record<string, string> }).devDependencies,
      { "@earendil-works/pi-coding-agent": "0.86.1", typescript: "^7.0.2" });
    await assert.rejects(prepare("npm-peer-old", { kind: "npm", spec: "@example/requires-new-pi@1.0.0" }),
      (error: unknown) => (error as { code?: string }).code === "PI_PACKAGE_SDK_VERSION_UNSUPPORTED");
    await assert.rejects(readFile(join(root, "npm-peer-old", "work", "result", "npm-command.txt")));
    await assert.rejects(prepare("npm-oversized", { kind: "npm", spec: "@example/oversized@1.0.0" }),
      (error: unknown) => (error as { code?: string }).code === "PI_PACKAGE_LIMIT_EXCEEDED");
    await assert.rejects(readFile(join(root, "npm-oversized", "work", "result", "npm-command.txt")),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      "oversized npm source must fail before running npm install");
    const gitResult = await prepare("git", { kind: "git", spec: "github.com/example/git-tools@v2" });
    assert.deepEqual(gitResult, { name: "@example/git-tools", version: "2.0.0", sourceKind: "git",
      resolvedSource: "https://github.com/example/git-tools@0123456789abcdef0123456789abcdef01234567" });
    assert.equal(await readFile(join(root, "git", "work", "result", "npm-command.txt"), "utf8"), "ci");
    await assert.rejects(prepare("git-peer-old", { kind: "git", spec: "github.com/example/requires-new-pi@v2" }),
      (error: unknown) => (error as { code?: string }).code === "PI_PACKAGE_SDK_VERSION_UNSUPPORTED");
    await assert.rejects(readFile(join(root, "git-peer-old", "work", "result", "npm-command.txt")));
    const uploadPackage = join(root, "upload-package");
    await mkdir(uploadPackage);
    await writeFile(join(uploadPackage, "package.json"), JSON.stringify({ name: "upload-tools", version: "1.0.0",
      peerDependencies: { "@earendil-works/pi-ai": ">=0.87.0" } }));
    for (const kind of ["local", "zip"] as const) {
      const label = `${kind}-peer-old`, workRoot = join(root, label, "work"), spoolRoot = join(root, label, "spool"), sourceRoot = join(root, label, "source");
      await mkdir(workRoot, { recursive: true }); await mkdir(spoolRoot); await mkdir(sourceRoot);
      await packPiPackageDirectory(uploadPackage, join(sourceRoot, "input.zip"));
      await writeFile(join(sourceRoot, "request.json"), JSON.stringify({ source: { kind, displayName: "upload-tools" } }));
      await assert.rejects(runPackageHelper("prepare", { workRoot, spoolRoot, sourceRoot, hostModuleRoot }),
        (error: unknown) => (error as { code?: string }).code === "PI_PACKAGE_SDK_VERSION_UNSUPPORTED");
      await assert.rejects(readFile(join(workRoot, "result", "npm-command.txt")));
    }
    const stale = await prepare("git-stale", { kind: "git", spec: "github.com/example/stale@v2" });
    assert.equal(stale.name, "@example/git-tools");
    assert.equal(await readFile(join(root, "git-stale", "work", "result", "npm-command.txt"), "utf8"), "install");
    await assert.rejects(prepare("git-oversized", { kind: "git", spec: "github.com/example/oversized@v2" }),
      (error: unknown) => (error as { code?: string }).code === "PI_PACKAGE_LIMIT_EXCEEDED");
    await assert.rejects(readFile(join(root, "git-oversized", "work", "result", "npm-command.txt")),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
      "oversized Git source must fail before running npm install");
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true });
  }
});

test("real local npm registry and Git fixture resolve exact bytes and a fixed commit", { concurrency: false, timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-package-real-sources-"));
  const previous = { gitConfig: process.env.GIT_CONFIG_GLOBAL, registry: process.env.NPM_CONFIG_REGISTRY,
    cache: process.env.NPM_CONFIG_CACHE };
  const server = createServer();
  try {
    const hostModuleRoot = await createHostModuleFixture(root);
    const source = join(root, "tar-source"), packageRoot = join(source, "package");
    await mkdir(packageRoot, { recursive: true });
    await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name: "fixture-tools", version: "1.2.3", main: "index.js",
      dependencies: { "fixture-dependency": "3.0.0" } }));
    await writeFile(join(packageRoot, "index.js"), "module.exports = 'registry-fixture';\n");
    const tarball = join(root, "fixture-tools.tgz");
    await execute("tar", ["-czf", tarball, "-C", source, "package"]);
    const archive = await readFile(tarball);
    const dependencySource = join(root, "dependency-source"), dependencyRoot = join(dependencySource, "package");
    await mkdir(dependencyRoot, { recursive: true });
    await writeFile(join(dependencyRoot, "package.json"), JSON.stringify({ name: "fixture-dependency", version: "3.0.0", main: "index.js" }));
    await writeFile(join(dependencyRoot, "index.js"), "module.exports = 'dependency-fixture';\n");
    const dependencyTarball = join(root, "fixture-dependency.tgz");
    await execute("tar", ["-czf", dependencyTarball, "-C", dependencySource, "package"]);
    const dependencyArchive = await readFile(dependencyTarball);
    server.on("request", (request, response) => {
      if (request.url === "/fixture-tools" || request.url === "/fixture-dependency") {
        const address = server.address();
        if (address === null || typeof address === "string") throw new Error("registry address unavailable");
        const dependency = request.url === "/fixture-dependency";
        const name = dependency ? "fixture-dependency" : "fixture-tools";
        const version = dependency ? "3.0.0" : "1.2.3";
        const bytes = dependency ? dependencyArchive : archive;
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ name, "dist-tags": { latest: version }, versions: {
          [version]: { name, version, ...(dependency ? {} : { dependencies: { "fixture-dependency": "3.0.0" } }), dist: {
            tarball: `http://127.0.0.1:${address.port}/${name}/-/${name}-${version}.tgz`,
            shasum: createHash("sha1").update(bytes).digest("hex"),
          } },
        } }));
      } else if (request.url === "/fixture-tools/-/fixture-tools-1.2.3.tgz") {
        response.setHeader("content-type", "application/octet-stream");
        response.end(archive);
      } else if (request.url === "/fixture-dependency/-/fixture-dependency-3.0.0.tgz") {
        response.setHeader("content-type", "application/octet-stream");
        response.end(dependencyArchive);
      } else { response.statusCode = 404; response.end(); }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("registry address unavailable");
    process.env.NPM_CONFIG_REGISTRY = `http://127.0.0.1:${address.port}/`;
    process.env.NPM_CONFIG_CACHE = join(root, "npm-cache");

    const prepare = async (label: string, sourceRequest: unknown) => {
      const workRoot = join(root, label, "work"), spoolRoot = join(root, label, "spool"), sourceRoot = join(root, label, "source");
      await mkdir(workRoot, { recursive: true }); await mkdir(spoolRoot); await mkdir(sourceRoot);
      await writeFile(join(sourceRoot, "request.json"), JSON.stringify({ source: sourceRequest }));
      return { result: await runPackageHelper("prepare", { workRoot, spoolRoot, sourceRoot, hostModuleRoot }) as
        { name: string; version: string; resolvedSource: string }, workRoot };
    };
    const npm = await prepare("npm-real", { kind: "npm", spec: "fixture-tools@1.2.3" });
    assert.deepEqual(npm.result, { name: "fixture-tools", version: "1.2.3", sourceKind: "npm", resolvedSource: "fixture-tools@1.2.3" });
    assert.equal(await readFile(join(npm.workRoot, "result", "index.js"), "utf8"), "module.exports = 'registry-fixture';\n");
    assert.equal(await readFile(join(npm.workRoot, "result", "node_modules", "fixture-dependency", "index.js"), "utf8"),
      "module.exports = 'dependency-fixture';\n");

    const git = join(root, "repo");
    await mkdir(git);
    await execute("git", ["init", "-q", git]);
    await execute("git", ["-C", git, "config", "user.name", "Fixture"]);
    await execute("git", ["-C", git, "config", "user.email", "fixture@example.invalid"]);
    await writeFile(join(git, "package.json"), JSON.stringify({ name: "git-fixture-tools", version: "2.0.0" }));
    await writeFile(join(git, "index.js"), "module.exports = 'git-fixture';\n");
    await execute("git", ["-C", git, "add", "."]);
    await execute("git", ["-C", git, "commit", "-qm", "fixture"]);
    await execute("git", ["-C", git, "tag", "v2"]);
    const commit = (await execute("git", ["-C", git, "rev-parse", "HEAD"])).stdout.trim();
    const gitConfig = join(root, "gitconfig");
    await writeFile(gitConfig, `[url "file://${git}"]\n\tinsteadOf = https://fixture.invalid/org/repo\n`);
    process.env.GIT_CONFIG_GLOBAL = gitConfig;
    const resolvedGit = await prepare("git-real", { kind: "git", spec: "fixture.invalid/org/repo@v2" });
    assert.deepEqual(resolvedGit.result, { name: "git-fixture-tools", version: "2.0.0", sourceKind: "git",
      resolvedSource: `https://fixture.invalid/org/repo@${commit}` });
    assert.equal(await readFile(join(resolvedGit.workRoot, "result", "index.js"), "utf8"), "module.exports = 'git-fixture';\n");
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(git, { recursive: true, force: true });
    assert.equal(await readFile(join(npm.workRoot, "result", "node_modules", "fixture-dependency", "index.js"), "utf8"),
      "module.exports = 'dependency-fixture';\n", "prepared npm dependencies survive registry shutdown");
    assert.equal(await readFile(join(resolvedGit.workRoot, "result", "index.js"), "utf8"),
      "module.exports = 'git-fixture';\n", "prepared Git bytes survive deletion of the source repository");
  } finally {
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous.gitConfig === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = previous.gitConfig;
    if (previous.registry === undefined) delete process.env.NPM_CONFIG_REGISTRY; else process.env.NPM_CONFIG_REGISTRY = previous.registry;
    if (previous.cache === undefined) delete process.env.NPM_CONFIG_CACHE; else process.env.NPM_CONFIG_CACHE = previous.cache;
    await rm(root, { recursive: true, force: true });
  }
});

test("reusable v1/v2 fixtures prepare all four Pi resources and an offline runtime dependency", { concurrency: false, timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-package-fixtures-"));
  try {
    const hostModuleRoot = await createHostModuleFixture(root);
    for (const version of ["v1", "v2"] as const) {
      const fixture = fileURLToPath(new URL(`../../../fixtures/pi-packages/tools-${version}/`, import.meta.url));
      const sourceRoot = join(root, version, "source"), workRoot = join(root, version, "work"), spoolRoot = join(root, version, "spool");
      await mkdir(sourceRoot, { recursive: true }); await mkdir(workRoot); await mkdir(spoolRoot);
      await packPiPackageDirectory(fixture, join(sourceRoot, "input.zip"));
      await writeFile(join(sourceRoot, "request.json"), JSON.stringify({ source: { kind: "local", displayName: `tools-${version}` } }));
      const prepared = await runPackageHelper("prepare", { sourceRoot, workRoot, spoolRoot, hostModuleRoot }) as { name: string; version: string };
      assert.equal(prepared.name, "@piwork/fixture-tools");
      assert.equal(prepared.version, version === "v1" ? "1.0.0" : "2.0.0");
      assert.equal(await readFile(join(workRoot, "result", "prepared.txt"), "utf8"), `prepared-${version}\n`);
      assert.equal(await readFile(join(workRoot, "result", "node_modules", "fixture-dependency", "index.js"), "utf8"),
        'export default "offline-dependency";\n');
      const validated = await validatePiPackageArtifact({ root: join(workRoot, "result"), sourceKind: "local", resolvedSource: `tools-${version}`,
        preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" } });
      assert.deepEqual(validated.metadata.resourceCounts, { extensions: 1, skills: 1, prompts: 1, themes: 1 });
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
