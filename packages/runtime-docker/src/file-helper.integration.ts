import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";
import { encodeFileHelperFrame, FILE_HELPER_FRAME_KIND } from "@piwork/contracts";
import { DockerRuntime } from "./docker.js";
import type { FileHelperSpec } from "./file-helper.js";

const exec = promisify(execFile);
const configuredImage = process.env.PIWORK_FILE_HELPER_TEST_IMAGE;

test("real Docker file helper has one scoped mount and survives stream abort until explicit stop/remove", {
  skip: configuredImage === undefined, timeout: 120_000,
}, async () => {
  const installationId = `test-files-${randomUUID()}`;
  const workId = `work-${randomUUID()}`;
  const runtime = new DockerRuntime(installationId);
  const imageId = await runtime.resolveFileHelperImage(configuredImage!);
  const volume = await runtime.ensureManagedVolume(workId, "work-workspace");
  const created: FileHelperSpec[] = [];
  const docker = async (args: string[]) => (await exec("docker", args, { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
  const make = (suffix: string, readOnly: boolean): FileHelperSpec => ({
    installationId, workId, jobId: `filejob-${suffix}-${randomUUID()}`, attemptId: `attempt-${suffix}`,
    epoch: 1, name: `piwork-file-${suffix}-${randomUUID()}`, imageId,
    volumeName: volume.volumeName, readOnly,
  });
  try {
    const readSpec = make("read", true);
    created.push(readSpec); await runtime.createFileHelper(readSpec);
    const info = JSON.parse(await docker(["container", "inspect", readSpec.name]))[0] as {
      Config: { User: string; Labels: Record<string, string> };
      HostConfig: { NetworkMode: string; ReadonlyRootfs: boolean; Privileged: boolean; CapDrop: string[];
        NanoCpus: number; Memory: number; PidsLimit: number; PortBindings: Record<string, unknown>; Tmpfs: Record<string, string> };
      Mounts: Array<{ Type: string; Name: string; Destination: string; RW: boolean }>;
    };
    assert.equal(info.Config.User, "10001:10001");
    assert.equal(info.HostConfig.NetworkMode, "none");
    assert.equal(info.HostConfig.ReadonlyRootfs, true);
    assert.equal(info.HostConfig.Privileged, false);
    assert.ok(info.HostConfig.CapDrop.includes("ALL"));
    assert.equal(info.HostConfig.NanoCpus, 500_000_000);
    assert.equal(info.HostConfig.Memory, 128 * 1024 * 1024);
    assert.equal(info.HostConfig.PidsLimit, 32);
    assert.deepEqual(info.HostConfig.PortBindings, {});
    assert.equal(info.Mounts.filter((mount) => mount.Type === "volume").length, 1);
    assert.deepEqual(info.Mounts.find((mount) => mount.Type === "volume"),
      { ...info.Mounts.find((mount) => mount.Type === "volume"), Name: volume.volumeName, Destination: "/workspace", RW: false });
    assert.ok(info.HostConfig.Tmpfs["/tmp"]?.includes("size=16m"));
    const process = await runtime.startFileHelper(readSpec);
    const request = { version: 1, jobId: readSpec.jobId, workId, epoch: 1, action: "PROPFIND",
      pathSegments: [], destinationSegments: null, depth: 0, overwrite: null,
      conditions: { ifMatch: null, ifNoneMatch: null, ifModifiedSince: null, ifUnmodifiedSince: null },
      range: null, expectedLength: null };
    process.stdin.end(encodeFileHelperFrame(FILE_HELPER_FRAME_KIND.REQUEST, request));
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdout) chunks.push(Buffer.from(chunk));
    await process.completed;
    const output = Buffer.concat(chunks);
    assert.ok(output.includes(Buffer.from('"kind":"directory"')));
    assert.equal((await runtime.inspectFileHelper(readSpec))?.running, false);
    await runtime.removeFileHelper(readSpec);
    assert.equal(await runtime.inspectFileHelper(readSpec), undefined);

    const writeSpec = make("abort", false);
    created.push(writeSpec); await runtime.createFileHelper(writeSpec);
    const blocked = await runtime.startFileHelper(writeSpec);
    blocked.abort();
    await blocked.completed.catch(() => undefined);
    await runtime.stopFileHelper(writeSpec);
    assert.equal((await runtime.inspectFileHelper(writeSpec))?.running, false);
    await runtime.removeFileHelper(writeSpec);
    assert.equal(await runtime.inspectFileHelper(writeSpec), undefined);
  } finally {
    for (const spec of created.reverse()) {
      await runtime.stopFileHelper(spec).catch(() => undefined);
      await runtime.removeFileHelper(spec).catch(() => undefined);
      const remaining = await docker(["container", "inspect", "--format", '{{index .Config.Labels "piwork.installation_id"}}', spec.name]).catch(() => "");
      if (remaining === installationId) await docker(["container", "rm", "--force", spec.name]);
    }
    await runtime.deleteManagedVolume(workId, "work-workspace");
  }
});
