import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { WorkControlHistory, WorkSourceIdentityMap } from "@piwork/contracts";
import type { WorkRecord } from "@piwork/core-store";
import { WorkBlobDirectory, parseWorkJson, encodeWorkPackage, inspectWorkPackage } from "@piwork/work-package";
import { goldenWorkFixture } from "../../../../packages/work-package/dist/fixture.js";
import { validatePiPackageArtifact } from "@piwork/pi-package";
import { WorkContextStore } from "../configuration/work-context.js";
import { restorePortableConfiguration, type WorkSnapshotMetadata } from "./metadata.js";
import { captureWorkPackage, type SnapshotCaptureRuntime } from "./capture.js";
import type { SnapshotHelperSpec } from "@piwork/runtime-docker";

test("capture assembles a fully verified cold package from both volumes, context, history, quota and image", async () => {
  const root = mkdtempSync(join(tmpdir(), "piwork-capture-"));
  try {
    const fixture = goldenWorkFixture(), spec = fixture.spec, sourceWorkId = "work-000000000001";
    const contexts = new WorkContextStore(join(root, "contexts"));
    const packageRoot = join(root, "pi-tools");
    mkdirSync(join(packageRoot, "node_modules", "dep"), { recursive: true });
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@example/pi-tools", version: "1.0.0", dependencies: { dep: "1.0.0" } }));
    writeFileSync(join(packageRoot, "node_modules", "dep", "package.json"), '{"name":"dep","version":"1.0.0"}');
    writeFileSync(join(packageRoot, "node_modules", "dep", "index.js"), "export default 1");
    symlinkSync("index.js", join(packageRoot, "node_modules", "dep", "main.js"));
    const artifact = (await validatePiPackageArtifact({ root: packageRoot, sourceKind: "local", resolvedSource: "local:fixture",
      preparedEnvironment: { os: "linux", architecture: "amd64", variant: null, nodeAbi: "137", piSdkVersion: "0.86.0" } })).metadata;
    spec.contexts[0]!.configuration.packages = [{ name: artifact.name, enabled: false }];
    const agents = fixture.data.get(spec.contexts[0]!.agentsBlob)!.toString();
    const configuration = restorePortableConfiguration(spec.contexts[0]!.configuration, agents, "runtime-model-source", "runtime-image-source", new Map(), new Map());
    const snapshot = contexts.build({ workId: sourceWorkId, snapshotId: "context-000000000001", configuration,
      imageIdentity: spec.images[0]!.imageId, skills: [], packages: [{ name: artifact.name, directory: packageRoot, metadata: artifact }], createdAt: spec.createdAt });
    const metadata: WorkSnapshotMetadata = {
      work: { id: sourceWorkId, name: "golden" } as WorkRecord,
      contexts: [{ key: "c-000001", snapshot, configuration: spec.contexts[0]!.configuration, imageKey: "i-000001" },
        { key: "c-000002", snapshot, configuration: spec.contexts[0]!.configuration, imageKey: "i-000001" }],
      services: [], quotaReservations: spec.quotaReservations, activeContext: "c-000001", desiredContext: "c-000002",
      volumes: [{ role: "agent-private", record: { runtimeName: "source-private" } as WorkSnapshotMetadata["volumes"][number]["record"], serviceRefKeys: [] },
        { role: "workspace", record: { runtimeName: "source-workspace" } as WorkSnapshotMetadata["volumes"][number]["record"], serviceRefKeys: [] }],
      images: [{ key: "i-000001", imageId: spec.images[0]!.imageId }], bindings: spec.bindings,
      history: { ...(parseWorkJson(fixture.data.get(spec.history.control)!) as WorkControlHistory),
        configurationRevisions: [{ revision: 1, contextKey: "c-000001" }, { revision: 2, contextKey: "c-000002" }] },
      identities: { ...(parseWorkJson(fixture.data.get(spec.history.sourceIdentityMap)!) as WorkSourceIdentityMap),
        contexts: [{ sourceId: "context-000000000001", key: "c-000001" }, { sourceId: "context-000000000002", key: "c-000002" }] },
    };
    const active = new Map<string, SnapshotHelperSpec>(); let runs = 0;
    const runtime: SnapshotCaptureRuntime = {
      async createSnapshotHelper(helper) { active.set(helper.name, helper); return helper.name; },
      async startSnapshotHelper(name) {
        const helper = active.get(name)!; runs++;
        if (helper.action === "verify-history") return { historyPresent: true, sessions: 0, runs: 0, events: 0 };
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
    assert.equal(result.verified.spec.piPackageArtifacts.length, 1);
    assert.equal(result.verified.spec.contexts.length, 2, "all retained contexts are captured");
    assert.equal(result.verified.spec.contexts[1]?.packageBindings[0]?.artifactKey, artifact.contentDigest,
      "shared package bytes are represented once in the archive");
    assert.equal(result.verified.spec.contexts[0]?.packageBindings[0]?.artifactKey, artifact.contentDigest);
    assert.equal(result.verified.spec.contexts[0]?.configuration.packages[0]?.enabled, false);
    assert.equal(readFileSync(result.stagingPath).byteLength, result.verified.size);
    const forged = structuredClone(result.verified.spec);
    const wrongDigest = `sha256:${"b".repeat(64)}`;
    forged.piPackageArtifacts[0]!.key = wrongDigest;
    forged.piPackageArtifacts[0]!.contentDigest = wrongDigest;
    for (const context of forged.contexts) context.packageBindings[0]!.artifactKey = wrongDigest;
    const forgedBytes: Buffer[] = [];
    for await (const chunk of encodeWorkPackage(forged, (blob) => new WorkBlobDirectory(spoolDirectory).read(blob.digest))) forgedBytes.push(Buffer.from(chunk));
    await assert.rejects(inspectWorkPackage(Readable.from([Buffer.concat(forgedBytes)])), { field: "piPackageArtifacts.contentDigest" });
    assert.ok(!JSON.stringify(result.verified.spec).includes("PRIVATE_CONTENT_SENTINEL"));
    assert.equal(readFileSync(join(spoolDirectory, fixture.spec.blobs.find((blob) => fixture.data.get(blob.digest)?.includes("PRIVATE_CONTENT_SENTINEL"))!.digest)).includes("PRIVATE_CONTENT_SENTINEL"), true);
    rmSync(join(snapshot.directory, "packages", snapshot.metadata.packageBindings[0]!.nameKey, "package.json"));
    await assert.rejects(captureWorkPackage({ metadata, runtime, installationId: "install-test", jobId: "operation-test-000002",
      helperImageId: `sha256:${"f".repeat(64)}`, spoolDirectory: join(root, "spool-missing"), createdAt: spec.createdAt }),
    "a missing retained package must fail the entire export");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
