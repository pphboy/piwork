import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { WorkControlHistory, WorkSourceIdentityMap } from "@piwork/contracts";
import type { WorkRecord } from "@piwork/core-store";
import { WorkBlobDirectory, parseWorkJson } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../../packages/work-package/dist/fixture.js";
import { WorkContextStore } from "../configuration/work-context.js";
import { restorePortableConfiguration, type WorkSnapshotMetadata } from "./metadata.js";
import { captureWorkPackage, type SnapshotCaptureRuntime } from "./capture.js";
import type { SnapshotHelperSpec } from "@piwork/runtime-docker";

test("capture assembles a fully verified cold package from both volumes, context, history, quota and image", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-capture-"));
  try {
    const fixture = goldenWorkFixture(), spec = fixture.spec, sourceWorkId = "work-000000000001";
    const contexts = new WorkContextStore(join(root, "contexts"));
    const agents = fixture.data.get(spec.contexts[0]!.agentsBlob)!.toString();
    const configuration = restorePortableConfiguration(spec.contexts[0]!.configuration, agents, "runtime-model-source", "runtime-image-source", new Map(), new Map());
    const snapshot = contexts.build({ workId: sourceWorkId, snapshotId: "context-000000000001", configuration,
      imageIdentity: spec.images[0]!.imageId, skills: [], createdAt: spec.createdAt });
    const metadata: WorkSnapshotMetadata = {
      work: { id: sourceWorkId, name: "golden" } as WorkRecord,
      contexts: [{ key: "c-000001", snapshot, configuration: spec.contexts[0]!.configuration, imageKey: "i-000001" }],
      services: [], quotaReservations: spec.quotaReservations, activeContext: null, desiredContext: "c-000001",
      volumes: [{ role: "agent-private", record: { runtimeName: "source-private" } as WorkSnapshotMetadata["volumes"][number]["record"], serviceRefKeys: [] },
        { role: "workspace", record: { runtimeName: "source-workspace" } as WorkSnapshotMetadata["volumes"][number]["record"], serviceRefKeys: [] }],
      images: [{ key: "i-000001", imageId: spec.images[0]!.imageId }], bindings: spec.bindings,
      history: parseWorkJson(fixture.data.get(spec.history.control)!) as WorkControlHistory,
      identities: parseWorkJson(fixture.data.get(spec.history.sourceIdentityMap)!) as WorkSourceIdentityMap,
    };
    const active = new Map<string, SnapshotHelperSpec>(); let runs = 0;
    const runtime: SnapshotCaptureRuntime = {
      async createSnapshotHelper(helper) { active.set(helper.name, helper); return helper.name; },
      async startSnapshotHelper(name) {
        const helper = active.get(name)!; runs++;
        if (helper.action === "verify-history") return { historyPresent: false, sessions: 0, runs: 0, events: 0 };
        for (const [digest, bytes] of fixture.data) writeFileSync(join(helper.spoolDirectory, digest), bytes, { mode: 0o600 });
        const digest = spec.volumes[0].tree;
        return { tree: digest, size: fixture.data.get(digest)!.length, entries: 3, logicalBytes: 24 };
      },
      async removeSnapshotHelper(name) { active.delete(name); },
      async saveCapturedImage(_imageId, blobs: WorkBlobDirectory) {
        const image = spec.images[0]!, bytes = fixture.data.get(image.config)!;
        const stored = await blobs.put(Readable.from([bytes]), bytes.length);
        return { image: { imageId: image.imageId, platform: image.platform, config: image.config, layers: [] }, blobs: [stored] };
      },
    };
    const spoolDirectory = join(root, "spool");
    const result = await captureWorkPackage({ metadata, runtime, installationId: "install-test", jobId: "operation-test-000001",
      helperImageId: `sha256:${"f".repeat(64)}`, spoolDirectory, createdAt: spec.createdAt });
    assert.equal(runs, 3); assert.equal(active.size, 0);
    assert.equal(result.verified.spec.volumes.length, 2);
    assert.deepEqual(result.verified.spec.quotaReservations.map((row) => ({ subjectKind: row.subjectKind, subjectKey: row.subjectKey,
      desiredCpuMillis: row.desiredCpuMillis, desiredMemoryBytes: row.desiredMemoryBytes, serviceSlots: row.serviceSlots, volumeSlots: row.volumeSlots })), spec.quotaReservations);
    assert.equal(result.verified.spec.history.control.length, 64);
    assert.equal(readFileSync(result.stagingPath).byteLength, result.verified.size);
    assert.ok(!JSON.stringify(result.verified.spec).includes("PRIVATE_CONTENT_SENTINEL"));
    assert.equal(readFileSync(join(spoolDirectory, fixture.spec.blobs.find((blob) => fixture.data.get(blob.digest)?.includes("PRIVATE_CONTENT_SENTINEL"))!.digest)).includes("PRIVATE_CONTENT_SENTINEL"), true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
