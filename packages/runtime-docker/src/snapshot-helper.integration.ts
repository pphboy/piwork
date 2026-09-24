import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { snapshotHelperCreateArgs } from "./snapshot-helper.js";

const exec = promisify(execFile);
const helperImage = process.env.PIWORK_SNAPSHOT_HELPER_TEST_IMAGE;
test("real helper captures both volume roots read-only and restores independent new volumes", { skip: helperImage === undefined, timeout: 120000 }, async () => {
  const installationId = `test-snapshot-${randomUUID()}`;
  const spoolDirectory = await mkdtemp(join(tmpdir(), "piwork-snapshot-docker-"));
  const containers: string[] = [], volumes: string[] = [];
  const docker = async (args: string[]) => (await exec("docker", args, { timeout: 30000, maxBuffer: 1024 * 1024 })).stdout.trim();
  const imageId = await docker(["image", "inspect", "--format", "{{.Id}}", helperImage!]);
  const container = async (args: string[]) => {
    const id = await docker(args); containers.push(id);
    return { id, output: await docker(["start", "--attach", id]) };
  };
  try {
    for (const suffix of ["private", "workspace", "new-private", "new-workspace"]) {
      const name = `${installationId}-${suffix}`;
      await docker(["volume", "create", "--label", `installation_id=${installationId}`, name]); volumes.push(name);
    }
    const privateVolume = volumes[0]!, workspaceVolume = volumes[1]!;
    await container(["create", "--label", `installation_id=${installationId}`, "--network", "none", "--read-only", "--entrypoint", "python3",
      "--mount", `type=volume,source=${privateVolume},target=/private`, "--mount", `type=volume,source=${workspaceVolume},target=/workspace-data`, imageId, "-c",
      "import os; os.mkdir('/private/workspace'); open('/private/workspace/hidden','wb').write(b'underlying-private'); open('/private/home-tool','wb').write(b'dev-tool'); open('/workspace-data/.env','wb').write(b'TOKEN=original'); os.chmod('/workspace-data/.env',0o751); os.chown('/workspace-data/.env',10001,10001); os.utime('/workspace-data/.env',ns=(1727049600123456789,1727049600123456789)); os.link('/workspace-data/.env','/workspace-data/hard'); os.symlink('/etc/missing','/workspace-data/outside'); open(b'/workspace-data/'+bytes([255]),'wb').write(b'byte-name')",
    ]);
    await container(["create", "--label", `installation_id=${installationId}`, "--network", "none", "--read-only", "--entrypoint", "python3",
      "--mount", `type=volume,source=${workspaceVolume},target=/workspace-data`, imageId, "-c",
      "import os; os.makedirs('/workspace-data/node_modules/.bin'); p='/workspace-data/node_modules/portable-tool'; open(p,'w').write('#!/bin/sh\\necho linked-tool-retained\\n'); os.chmod(p,0o755); os.symlink('../portable-tool','/workspace-data/node_modules/.bin/portable-tool')",
    ]);
    const captured: string[] = [];
    for (const volumeName of [privateVolume, workspaceVolume]) {
      const result = await container(snapshotHelperCreateArgs({ installationId, jobId: installationId, name: `${installationId}-${captured.length}`, imageId, spoolDirectory, volumeName, action: "capture" }));
      const info = JSON.parse(await docker(["inspect", result.id]))[0] as { HostConfig: { NetworkMode: string; ReadonlyRootfs: boolean; NanoCpus: number; Memory: number; PidsLimit: number; Privileged: boolean }; Mounts: Array<{ Destination: string; RW: boolean }> };
      assert.equal(info.HostConfig.NetworkMode, "none"); assert.equal(info.HostConfig.ReadonlyRootfs, true); assert.equal(info.HostConfig.Privileged, false);
      assert.equal(info.HostConfig.NanoCpus, 1000000000); assert.equal(info.HostConfig.Memory, 512 * 1024 * 1024); assert.equal(info.HostConfig.PidsLimit, 64);
      assert.equal(info.Mounts.find((mount) => mount.Destination === "/snapshot/volume")!.RW, false);
      assert.equal(info.Mounts.length, 2);
      captured.push((JSON.parse(result.output) as { tree: string }).tree);
      const blob = join(spoolDirectory, captured.at(-1)!);
      assert.equal((await stat(blob)).uid, process.getuid!());
      assert.equal((await stat(blob)).mode & 0o777, 0o600);
      assert.equal(JSON.parse(await readFile(blob, "utf8")).version, 1);
    }
    for (let index = 0; index < 2; index++) await container(snapshotHelperCreateArgs({ installationId, jobId: installationId,
      name: `${installationId}-restore-${index}`, imageId, spoolDirectory, volumeName: volumes[index + 2]!, action: "restore", treeDigest: captured[index]! }));
    const linkedTool = await container(["create", "--label", `installation_id=${installationId}`, "--network", "none", "--read-only", "--entrypoint", "python3",
      "--mount", `type=volume,source=${volumes[3]!},target=/workspace-data`, imageId, "-c",
      "import os,subprocess; p='/workspace-data/node_modules/.bin/portable-tool'; assert os.readlink(p)=='../portable-tool'; print(subprocess.check_output([p],text=True).strip())",
    ]);
    assert.equal(linkedTool.output, "linked-tool-retained");
    await mkdir(join(spoolDirectory, "contexts", "c-000001"), { recursive: true, mode: 0o700 });
    const owned = await container(snapshotHelperCreateArgs({ installationId, jobId: installationId, name: `${installationId}-context`, imageId,
      spoolDirectory, action: "restore-context", treeDigest: captured[1]!, contextKey: "c-000001" }));
    assert.equal((JSON.parse(owned.output) as { tree: string }).tree, captured[1]);
    assert.equal((await stat(join(spoolDirectory, "contexts", "c-000001", ".env"))).uid, process.getuid!());
    assert.equal((await readFile(join(spoolDirectory, "contexts", "c-000001", ".env"), "utf8")), "TOKEN=original");
    // A second capture produces the same tree, including root metadata and byte names.
    for (let index = 0; index < 4; index++) {
      const copy = await container(snapshotHelperCreateArgs({ installationId, jobId: installationId, name: `${installationId}-verify-${index}`, imageId, spoolDirectory, volumeName: volumes[index]!, action: "capture" }));
      assert.equal((JSON.parse(copy.output) as { tree: string }).tree, captured[index % 2]);
    }
    await container(["create", "--label", `installation_id=${installationId}`, "--network", "none", "--read-only", "--entrypoint", "python3",
      "--mount", `type=volume,source=${workspaceVolume},target=/workspace-data`, imageId, "-c", "import os; os.mkfifo('/workspace-data/unsupported-fifo')"]);
    const rejectedHelper = await docker(snapshotHelperCreateArgs({ installationId, jobId: installationId, name: `${installationId}-unsupported`,
      imageId, spoolDirectory, volumeName: workspaceVolume, action: "capture" }));
    containers.push(rejectedHelper);
    await assert.rejects(docker(["start", "--attach", rejectedHelper]), (error: unknown) =>
      String((error as { stderr?: string }).stderr ?? error).includes("SNAPSHOT_STORAGE_UNSUPPORTED"));
  } finally {
    for (const id of containers.reverse()) {
      const owner = await docker(["inspect", "--format", '{{or (index .Config.Labels "piwork.installation_id") (index .Config.Labels "installation_id")}}', id]);
      assert.equal(owner, installationId); await docker(["rm", "--force", id]);
    }
    for (const name of volumes) {
      const owner = await docker(["volume", "inspect", "--format", '{{index .Labels "installation_id"}}', name]);
      assert.equal(owner, installationId); await docker(["volume", "rm", name]);
    }
    await rm(spoolDirectory, { recursive: true, force: true });
  }
});
