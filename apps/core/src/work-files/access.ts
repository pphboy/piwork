import type { CoreStore } from "@piwork/core-store";
import type { WorkRuntimeAdapter } from "../work-management/lifecycle.js";
import { WorkFileExecutionError } from "./coordinator.js";

export interface WorkFileAccessIdentity {
  readonly workId: string;
  readonly ownerUserId: string;
  readonly sessionId: string;
  readonly runtimeGeneration: number;
}

/** Checks both Core's record and the actual, currently bound agent instance. */
export class WorkFileAccessGuard {
  constructor(private readonly store: CoreStore, private readonly runtime: Pick<WorkRuntimeAdapter, "inspect">,
    private readonly now = () => new Date().toISOString()) {}

  async validate(identity: WorkFileAccessIdentity): Promise<void> {
    this.store.files.assertAccess(identity.workId, identity.ownerUserId, identity.sessionId, this.now());
    const generation = this.store.getRuntimeGeneration(identity.workId, identity.runtimeGeneration);
    if (!generation || generation.state !== "ready" || generation.instanceId === null)
      throw new WorkFileExecutionError("WORK_FILES_UNAVAILABLE");
    let actual;
    try { actual = await this.runtime.inspect(identity.workId); }
    catch { throw new WorkFileExecutionError("FILE_RUNTIME_UNAVAILABLE"); }
    // A simultaneous stop or session revocation after Docker inspection is still rejected.
    this.store.files.assertAccess(identity.workId, identity.ownerUserId, identity.sessionId, this.now());
    if (!actual.exists || !actual.running || !actual.ready || actual.generation !== generation.generation
      || actual.instanceId !== generation.instanceId)
      throw new WorkFileExecutionError("WORK_FILES_UNAVAILABLE");
    const current = this.store.getRuntimeGeneration(identity.workId, identity.runtimeGeneration);
    if (!current || current.state !== "ready" || current.instanceId !== generation.instanceId)
      throw new WorkFileExecutionError("WORK_FILES_UNAVAILABLE");
  }
}
