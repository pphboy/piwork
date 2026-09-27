import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const docker = async (...args) => (await execute("docker", args, { timeout: 120_000 })).stdout.trim();

async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "0.0.0.0", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function copyFixture(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) await cp(join(from, entry), join(to, entry), { recursive: true });
}

async function oversizedFiles(directory, patterned = false) {
  const pattern = Buffer.alloc(1024 * 1024);
  if (patterned) for (let index = 0; index < pattern.length; index += 1024) pattern[index] = (index / 1024) % 255 + 1;
  for (let index = 0; index < 17; index++) {
    const file = await open(join(directory, `oversized-${index}`), "w");
    try {
      if (patterned) for (let chunk = 0; chunk < 64; chunk++) await file.write(pattern, 0, pattern.length, chunk * pattern.length);
      else await file.truncate(64 * 1024 * 1024);
    }
    finally { await file.close(); }
  }
}

/** A registry and dumb-HTTP Git fixture reachable from each isolated package helper network. */
export async function startPiPackageSources(root, baseImage = "piwork-agentd:acceptance") {
  const directory = join(root, "pi-package-sources"), fixtures = join(process.cwd(), "fixtures", "pi-packages");
  const image = `piwork-agentd:package-fixture-${randomUUID().slice(0, 12)}`;
  const sha1 = {};
  let server;
  try {
    await mkdir(join(directory, "tarballs"), { recursive: true });
    for (const [version, folder] of [["1.0.0", "tools-v1"], ["2.0.0", "tools-v2"], ["9.9.9", "tools-v1"]]) {
      const stage = join(directory, `tar-${version}`);
      await copyFixture(join(fixtures, folder), join(stage, "package"));
      await writeFile(join(stage, "package", "source-marker.txt"), "npm\n");
      if (version === "9.9.9") {
        const manifestPath = join(stage, "package", "package.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        await writeFile(manifestPath, JSON.stringify({ ...manifest, version }));
        await oversizedFiles(join(stage, "package"), true);
      }
      const archive = join(directory, "tarballs", `${version}.tgz`);
      await execute("tar", ["-czf", archive, "-C", stage, "package"]);
      sha1[version] = createHash("sha1").update(await readFile(archive)).digest("hex");
    }
    await writeFile(join(directory, "registry.json"), JSON.stringify({ sha1 }));
    const repo = join(directory, "repo");
    await mkdir(repo);
    await execute("git", ["init", "-q", repo]);
    await execute("git", ["-C", repo, "config", "user.name", "Fixture"]);
    await execute("git", ["-C", repo, "config", "user.email", "fixture@example.invalid"]);
    for (const [tag, folder] of [["v1", "tools-v1"], ["v2", "tools-v2"], ["oversized", "tools-v1"]]) {
      for (const entry of await readdir(repo)) if (entry !== ".git") await rm(join(repo, entry), { recursive: true, force: true });
      await copyFixture(join(fixtures, folder), repo);
      await writeFile(join(repo, "source-marker.txt"), "git\n");
      if (tag === "oversized") await oversizedFiles(repo);
      await execute("git", ["-C", repo, "add", "-A"]);
      await execute("git", ["-C", repo, "commit", "-qm", tag]);
      await execute("git", ["-C", repo, "tag", tag]);
    }
    await mkdir(join(directory, "git"));
    await execute("git", ["clone", "--bare", "-q", repo, join(directory, "git", "repo.git")]);
    await execute("git", ["-C", join(directory, "git", "repo.git"), "update-server-info"]);
    const port = await freePort();
    const gateway = await docker("network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}");
    if (!gateway) throw new Error("Docker bridge gateway unavailable");
    server = spawn(process.execPath, [join(process.cwd(), "scripts", "pi-package-fixture-server.mjs"), directory, String(port), gateway],
      { stdio: ["ignore", "pipe", "pipe"] });
    await Promise.race([
      new Promise((resolve, reject) => {
        server.stdout.once("data", (chunk) => String(chunk).includes("ready") ? resolve() : reject(new Error("fixture server did not become ready")));
        server.once("exit", (code) => reject(new Error(`fixture server exited: ${code}`)));
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("fixture server startup timed out")), 10_000)),
    ]);
    const build = join(directory, "image");
    await mkdir(build);
    await writeFile(join(build, "gitconfig"), `[url "http://${gateway}:${port}/git/repo.git"]\n\tinsteadOf = https://fixture.invalid/org/repo\n`);
    await writeFile(join(build, "Dockerfile"), `FROM ${baseImage}\nCOPY gitconfig /etc/piwork-fixture-gitconfig\nENV GIT_CONFIG_GLOBAL=/etc/piwork-fixture-gitconfig NPM_CONFIG_REGISTRY=http://${gateway}:${port}/\n`);
    await docker("build", "-q", "-t", image, build);
    const stopSources = async () => {
      if (server.exitCode === null && server.signalCode === null) server.kill("SIGTERM");
      if (server.exitCode === null && server.signalCode === null) await new Promise((resolve) => server.once("exit", resolve));
    };
    return { image, npm: (version) => `npm:@piwork/fixture-tools@${version}`,
      git: (tag) => `git:fixture.invalid/org/repo@${tag}`,
      local: (tag) => join(fixtures, `tools-${tag}`), directory,
      stopSources,
      close: async () => {
        await stopSources();
        await docker("image", "rm", "-f", image).catch(() => undefined);
      } };
  } catch (error) {
    server?.kill("SIGTERM");
    await docker("image", "rm", "-f", image).catch(() => undefined);
    throw error;
  }
}
