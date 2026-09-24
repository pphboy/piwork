import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WorkBlobDirectory, encodeWorkJson, type NormalizedImage } from "@piwork/work-package";
import { DockerRuntime } from "./docker.js";

const exec = promisify(execFile);
async function docker(args: string[]): Promise<string> { return (await exec("docker", args, { timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trim(); }
async function* one(value: Buffer) { yield value; }

test("real Docker loads exact custom image without tags, reuses identity and saves without registry", { skip: !process.env.PIWORK_SNAPSHOT_HELPER_TEST_IMAGE }, async () => {
  const installation = `test-image-snapshot-${randomUUID()}`;
  const existingTag = `piwork-test-snapshot/${randomUUID()}:preserved`;
  const directory = await mkdtemp(join(tmpdir(), "piwork-docker-image-"));
  const runtime = new DockerRuntime(installation), store = new WorkBlobDirectory(directory);
  let createdImage: string | undefined, createdTag = false, container: string | undefined;
  try {
    const original = JSON.parse(await docker(["image", "inspect", process.env.PIWORK_SNAPSHOT_HELPER_TEST_IMAGE!]))[0] as { Id: string };
    await docker(["image", "tag", original.Id, existingTag]); createdTag = true;
    // A small standard tar layer. It is data only: no build or user entrypoint runs.
    const content = Buffer.from("retained development environment\n"); const header = Buffer.alloc(512);
    header.write("dev-environment.txt"); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124); header.write("00000000000\0", 136); header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0", 257); header.write("00", 263);
    header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, "0")}\0 `, 148);
    const layer = await store.put(one(Buffer.concat([header, content, Buffer.alloc(512 - content.length + 1024)])), 4096);
    const platform = { os: "linux" as const, architecture: (await runtime.inspectCapturedImage(original.Id)).platform.architecture, variant: null };
    assert.deepEqual(await runtime.inspectHostPlatform(), platform);
    const config = await store.put(one(encodeWorkJson({ ...platform,
      created: "2026-09-23T00:00:00Z", rootfs: { type: "layers", diff_ids: [`sha256:${layer.digest}`] },
      history: [{ created: "2026-09-23T00:00:00Z", created_by: "piwork snapshot acceptance" }],
      config: { Cmd: ["/never-executed"], Env: ["DEV_ENV_RETAINED=true"], Labels: { installation_id: installation } },
    })), 64 * 1024);
    const normalized: NormalizedImage = { image: { imageId: `sha256:${config.digest}`, platform, config: config.digest, layers: [layer.digest] }, blobs: [config, layer] };
    createdImage = normalized.image.imageId;
    assert.deepEqual(await runtime.loadVerifiedImage(normalized, store), { imageId: createdImage, reused: false });
    assert.deepEqual(await runtime.loadVerifiedImage(normalized, store), { imageId: createdImage, reused: true });
    const inspection = JSON.parse(await docker(["image", "inspect", createdImage]))[0] as { RepoTags: string[]; Config: { Env: string[] } };
    assert.deepEqual(inspection.RepoTags, []); assert.ok(inspection.Config.Env.includes("DEV_ENV_RETAINED=true"));
    const retained = JSON.parse(await docker(["image", "inspect", existingTag]))[0] as { Id: string }; assert.equal(retained.Id, original.Id);
    const saved = await runtime.saveCapturedImage(createdImage, store);
    assert.deepEqual(saved.image, normalized.image);
    assert.deepEqual([...saved.blobs].sort((a, b) => a.digest.localeCompare(b.digest)), [...normalized.blobs].sort((a, b) => a.digest.localeCompare(b.digest)));
    container = await docker(["container", "create", "--network", "none", "--label", `installation_id=${installation}`, createdImage]);
    const state = JSON.parse(await docker(["container", "inspect", container]))[0] as { State: { Running: boolean } }; assert.equal(state.State.Running, false);
    // Docker emits a tar stream; its small fixture contains the original file bytes.
    assert.ok((await docker(["container", "cp", `${container}:/dev-environment.txt`, "-"])).includes(content.toString().trim()));
  } finally {
    if (container) { const record = JSON.parse(await docker(["container", "inspect", container]))[0]; if (record.Config.Labels.installation_id === installation) await docker(["container", "rm", container]); }
    if (createdTag) await docker(["image", "rm", existingTag]);
    if (createdImage) {
      const records = await docker(["image", "inspect", createdImage]).then((value) => JSON.parse(value) as Array<{ Config: { Labels: Record<string, string> } }>).catch(() => []);
      if (records[0]?.Config.Labels.installation_id === installation) await docker(["image", "rm", createdImage]);
    }
    await rm(directory, { recursive: true, force: true });
  }
});
