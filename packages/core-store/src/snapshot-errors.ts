export class SnapshotStoreError extends Error {
  constructor(readonly code: "WORK_BUSY" | "WORK_SNAPSHOT_BUSY" | "SNAPSHOT_CAPACITY_BUSY" | "SNAPSHOT_TRANSFER_BUSY" | "SNAPSHOT_WORKER_FENCED" | "WORK_NAME_CONFLICT" | "SNAPSHOT_RECORD_CONFLICT") { super(code); this.name = "SnapshotStoreError"; }
}
