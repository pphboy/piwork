import { CoreStore, type NewVolumeRecord, type VolumeRecord } from "@piwork/core-store";

export interface VolumeRuntime {
  deleteManagedVolume(workId: string, logicalId: string): Promise<void>;
}

export class RetainedVolumeService {
  constructor(
    private readonly store: CoreStore,
    private readonly runtime: VolumeRuntime,
    private readonly now: () => Date = () => new Date(),
  ) {}

  register(record: NewVolumeRecord): VolumeRecord {
    return this.store.createVolumeRecord(record);
  }

  setReferences(id: string, referenceCount: number): VolumeRecord {
    return this.store.setVolumeReferenceCount(id, referenceCount, this.now().toISOString());
  }

  list(workId: string): VolumeRecord[] {
    return this.store.listVolumeRecords(workId);
  }

  countPolicySlots(workId: string): number {
    return this.store.countVolumePolicySlots(workId);
  }

  async purge(id: string): Promise<VolumeRecord> {
    const pending = this.store.requestVolumePurge(id);
    if (pending.state === "purged") return pending;
    await this.runtime.deleteManagedVolume(pending.workId, pending.id);
    return this.store.completeVolumePurge(id, this.now().toISOString());
  }

  async resumePendingPurges(): Promise<readonly VolumeRecord[]> {
    const completed: VolumeRecord[] = [];
    for (const record of this.store.listVolumeRecords(undefined, true)) {
      if (record.state !== "purge_pending") continue;
      await this.runtime.deleteManagedVolume(record.workId, record.id);
      completed.push(this.store.completeVolumePurge(record.id, this.now().toISOString()));
    }
    return completed;
  }
}
