import { CoreStore, type RuntimeGenerationRecord } from "@piwork/core-store";
import type { WorkRuntimeAdapter } from "./lifecycle.js";

export class WorkRecoveryPolicy {
  constructor(
    private readonly store: CoreStore,
    private readonly runtime: WorkRuntimeAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async healthCheck(workId: string, generation: number): Promise<RuntimeGenerationRecord> {
    const actual = await this.runtime.inspect(workId);
    const now = this.now().toISOString();
    if (actual.exists && actual.running && actual.ready) {
      this.store.updateRuntimeGeneration(workId, generation, "ready", now, {
        instanceId: actual.instanceId,
        readySince: now,
      });
      return this.store.resetStableRuntimeRetryBudget(workId, generation, now);
    }
    return this.store.recordRuntimeFailure(workId, generation, now);
  }

  dueRetries(): RuntimeGenerationRecord[] {
    return this.store.listDueRuntimeRetries(this.now().toISOString());
  }

  explicitRetry(workId: string, generation: number): RuntimeGenerationRecord {
    return this.store.resetRuntimeRetryBudget(workId, generation, this.now().toISOString());
  }
}
