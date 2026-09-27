import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DockerRuntime } from "./docker.js";

const execute = promisify(execFile);
const imageReference = process.env.PIWORK_PACKAGE_HELPER_TEST_IMAGE;

test("real package helper has scoped mounts, independent egress and fixed resource limits", { skip: !imageReference, timeout: 120_000 }, async () => {
  const image = (await execute("docker", ["image", "inspect", "--format", "{{.Id}}", imageReference!])).stdout.trim();
  const installationId = `pi-package-test-${randomUUID().slice(0, 8)}`;
  const jobId = `job-${randomUUID()}`;
  const runtime = new DockerRuntime(installationId);
  const root = await mkdtemp(join(tmpdir(), "piwork-package-docker-"));
  const sourceDirectory = join(root, "source"), spoolDirectory = join(root, "spool");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(sourceDirectory); await mkdir(spoolDirectory);
  const names = [`piwork-pkg-init-${jobId}`, `piwork-pkg-prepare-${jobId}`];
  try {
    const resources = await runtime.ensurePiPackageResources(jobId);
    await runtime.createPiPackageHelper({ installationId, jobId, name: names[0]!, imageId: image,
      volumeName: resources.volumeName, action: "init" });
    assert.deepEqual(await runtime.startPiPackageHelper(names[0]!, jobId), { initialized: true });
    await runtime.removePiPackageHelper(names[0]!, jobId);
    assert.equal(await runtime.measurePiPackageVolume(jobId, resources.volumeName, image), 0);
    await execute("docker", ["container", "run", "--rm", "--network", "none",
      "--mount", `type=volume,source=${resources.volumeName},target=/package/work`, "--entrypoint", "node", image,
      "-e", "const f=require('node:fs');const d=f.openSync('/package/work/cache','w');f.ftruncateSync(d,4*1024*1024*1024+1);f.closeSync(d)"]);
    assert.ok(await runtime.measurePiPackageVolume(jobId, resources.volumeName, image) > 4 * 1024 * 1024 * 1024);
    await runtime.createPiPackageHelper({ installationId, jobId, name: names[1]!, imageId: image,
      volumeName: resources.volumeName, action: "prepare", sourceDirectory, networkName: resources.networkName });
    const raw = JSON.parse((await execute("docker", ["container", "inspect", names[1]!])).stdout)[0] as {
      Config: { User: string }; HostConfig: { ReadonlyRootfs: boolean; Memory: number; NanoCpus: number; PidsLimit: number; NetworkMode: string; CapDrop: string[] };
      Mounts: Array<{ Type: string; Source: string; Destination: string; RW: boolean }>;
    };
    assert.equal(raw.Config.User, "10001:10001");
    assert.equal(raw.HostConfig.ReadonlyRootfs, true);
    assert.equal(raw.HostConfig.Memory, 2 * 1024 * 1024 * 1024);
    assert.equal(raw.HostConfig.NanoCpus, 2_000_000_000);
    assert.equal(raw.HostConfig.PidsLimit, 256);
    assert.equal(raw.HostConfig.NetworkMode, resources.networkName);
    assert.ok(raw.HostConfig.CapDrop.includes("ALL"));
    assert.deepEqual(raw.Mounts.map((mount) => [mount.Type, mount.Destination, mount.RW]).sort((a, b) =>
      String(a[1]).localeCompare(String(b[1]))), [
      ["bind", "/package/source", false], ["volume", "/package/work", true],
    ]);
    assert.equal(raw.Mounts.some((mount) => mount.Source.includes("docker.sock") || mount.Source.includes("/home/") || mount.Destination.includes("/var/data")), false);
  } finally {
    for (const name of names) await runtime.removePiPackageHelper(name, jobId).catch(() => undefined);
    await runtime.removePiPackageResources(jobId).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
