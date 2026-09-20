import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CoreStore, ReferencedVolumeError } from "@piwork/core-store";
import { RetainedVolumeService } from "./retained-volumes.js";

const NOW = "2026-09-20T00:00:00.000Z";

test("deleted resources retain data, referenced purge conflicts, and pending cleanup resumes after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-retained-volume-"));
  const databasePath = join(root, "core.sqlite");
  let store = CoreStore.open({ databasePath });
  let deleteAttempts = 0;
  const failingRuntime = {
    async deleteManagedVolume() {
      deleteAttempts += 1;
      throw new Error("simulated Core exit after purge was committed");
    },
  };
  let service = new RetainedVolumeService(store, failingRuntime, () => new Date(NOW));

  try {
    service.register({
      id: "volume-0199e6d8abcd",
      installationId: "installation-1",
      workId: "work-0199e6d8abcd",
      serviceId: "service-0199e6d8abcd",
      runtimeName: "piwork-vol-fixture",
      referenceCount: 1,
      createdAt: NOW,
    });
    assert.equal(service.countPolicySlots("work-0199e6d8abcd"), 1);
    assert.equal(deleteAttempts, 0);
    await assert.rejects(
      service.purge("volume-0199e6d8abcd"),
      (error) => error instanceof ReferencedVolumeError && error.referenceCount === 1,
    );
    assert.equal(deleteAttempts, 0);

    const retained = service.setReferences("volume-0199e6d8abcd", 0);
    assert.equal(retained.state, "retained");
    assert.equal(retained.retainedAt, NOW);
    await assert.rejects(service.purge("volume-0199e6d8abcd"), /simulated Core exit/);
    assert.equal(store.getVolumeRecord("volume-0199e6d8abcd")?.state, "purge_pending");
    store.close();

    store = CoreStore.open({ databasePath });
    const deleted: string[] = [];
    service = new RetainedVolumeService(store, {
      async deleteManagedVolume(workId, logicalId) {
        deleted.push(`${workId}:${logicalId}`);
      },
    }, () => new Date("2026-09-20T00:01:00.000Z"));
    const resumed = await service.resumePendingPurges();
    assert.deepEqual(deleted, ["work-0199e6d8abcd:volume-0199e6d8abcd"]);
    assert.equal(resumed[0]?.state, "purged");
    assert.equal(service.countPolicySlots("work-0199e6d8abcd"), 0);
    assert.deepEqual(service.list("work-0199e6d8abcd"), []);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
