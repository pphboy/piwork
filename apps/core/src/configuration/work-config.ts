import { Check } from "typebox/value";
import { WorkConfigSchema, type WorkConfig, type WorkConfigurationView as WorkConfigurationViewContract } from "@piwork/contracts";
import { ConfigurationRevisionConflictError, CoreStore, type WorkConfigurationState, type WorkContextSnapshotInput } from "@piwork/core-store";
import {
  authorizeWorkResource,
  type UserPrincipal,
} from "../work-access/policy.js";
import { InputValidationError } from "../input-validation.js";

export class InvalidWorkConfigurationError extends InputValidationError {
  constructor() {
    super("Work configuration does not match the supported schema");
    this.name = "InvalidWorkConfigurationError";
  }
}

export interface WorkConfigurationView extends WorkConfigurationViewContract {
}

export class WorkConfigurationService {
  constructor(
    private readonly store: CoreStore,
    private readonly now: () => Date = () => new Date(),
    private readonly hostQuota = { cpuMillis: 128_000, memoryBytes: 256 * 1_024 * 1_024 * 1_024 },
  ) {}

  get(principal: UserPrincipal, workId: string): WorkConfigurationView {
    const state = this.store.getWorkConfiguration(workId);
    authorizeConfiguration(principal, state, "read-metadata");
    return view(state!);
  }

  update(
    principal: UserPrincipal,
    workId: string,
    configurationOrExpectedRevision: WorkConfig | number,
    maybeConfiguration?: WorkConfig,
    runtimeBinding?: { readonly runtimeProfileJson: string; readonly sourceRuntimeRevision: number | null; readonly snapshot?: WorkContextSnapshotInput },
  ): WorkConfigurationView {
    const configuration = typeof configurationOrExpectedRevision === "number" ? maybeConfiguration! : configurationOrExpectedRevision;
    if (!Check(WorkConfigSchema, configuration)) throw new InvalidWorkConfigurationError();
    const existing = this.store.getWorkConfiguration(workId);
    authorizeConfiguration(principal, existing, "control");
    this.store.snapshots.assertWorkMutable(workId);
    this.assertAllocation(workId, configuration);
    const expectedRevision = typeof configurationOrExpectedRevision === "number"
      ? configurationOrExpectedRevision
      : existing?.desiredRevision;
    const updated = this.store.updateWorkConfiguration({
      workId,
      expectedRevision: expectedRevision ?? 0,
      allowLastCommitWins: typeof configurationOrExpectedRevision !== "number",
      configJson: JSON.stringify(configuration),
      createdByUserId: principal.userId,
      now: this.now().toISOString(),
      ...runtimeBinding,
      hostCpuMillis: this.hostQuota.cpuMillis,
      hostMemoryBytes: this.hostQuota.memoryBytes,
    });
    return view(updated);
  }

  /**
   * Merge a field-specific edit against the latest desired state. The CAS is
   * internal only: callers never see a revision, and a concurrent commit is
   * retried from the new desired document so unrelated fields are preserved.
   */
  async updateMerged(
    principal: UserPrincipal,
    workId: string,
    merge: (current: WorkConfig) => WorkConfig,
    prepare: (configuration: WorkConfig) => Promise<{
      readonly runtimeProfileJson: string;
      readonly sourceRuntimeRevision: number | null;
      readonly snapshot?: WorkContextSnapshotInput;
    }>,
  ): Promise<WorkConfigurationView> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = this.store.getWorkConfiguration(workId);
      authorizeConfiguration(principal, existing, "control");
      this.store.snapshots.assertWorkMutable(workId);
      if (existing === undefined) throw new InvalidWorkConfigurationError();
      const current = JSON.parse(existing.desiredConfigJson) as WorkConfig;
      const configuration = merge(current);
      if (!Check(WorkConfigSchema, configuration)) throw new InvalidWorkConfigurationError();
      this.assertAllocation(workId, configuration);
      const binding = await prepare(configuration);
      try {
        const updated = this.store.updateWorkConfiguration({
          workId,
          expectedRevision: existing.desiredRevision,
          allowLastCommitWins: false,
          configJson: JSON.stringify(configuration),
          createdByUserId: principal.userId,
          now: this.now().toISOString(),
          ...binding,
          hostCpuMillis: this.hostQuota.cpuMillis,
          hostMemoryBytes: this.hostQuota.memoryBytes,
        });
        return view(updated);
      } catch (error) {
        if (!(error instanceof ConfigurationRevisionConflictError)) throw error;
      }
    }
    throw new Error("Work configuration changed too frequently; retry the operation");
  }

  private assertAllocation(workId: string, configuration: WorkConfig): void {
    const serviceReservations = this.store.listQuotaReservations(workId).filter((item) => item.subjectKind === "service");
    const cpu = configuration.resources.agentCpuMillis + serviceReservations.reduce((sum, item) => sum + Math.max(item.desiredCpuMillis, item.occupiedCpuMillis), 0);
    const memory = configuration.resources.agentMemoryBytes + serviceReservations.reduce((sum, item) => sum + Math.max(item.desiredMemoryBytes, item.occupiedMemoryBytes), 0);
    if (cpu > configuration.resources.cpuMillis || memory > configuration.resources.memoryBytes) throw new InvalidWorkConfigurationError();
    if (this.store.listServices(workId).length > configuration.resources.maxServices) throw new InvalidWorkConfigurationError();
    if (this.store.countVolumePolicySlots(workId) > configuration.resources.maxRetainedVolumes) throw new InvalidWorkConfigurationError();
  }
}

function authorizeConfiguration(
  principal: UserPrincipal,
  state: WorkConfigurationState | undefined,
  action: "read-metadata" | "control",
): void {
  authorizeWorkResource(
    principal,
    state === undefined ? undefined : {
      id: state.workId,
      kind: "work",
      workId: state.workId,
      ownerUserId: state.ownerUserId,
    },
    action,
  );
}

function view(state: WorkConfigurationState): WorkConfigurationView {
  return {
    workId: state.workId,
    desired: publicConfig(state.desiredConfigJson),
    active: state.activeConfigJson === null ? null : publicConfig(state.activeConfigJson),
    pendingApply: state.pendingRestart,
    // Historical readiness is deliberately not projected as current runtime
    // evidence. The runtime adapter supplies a fresh observation when one is
    // available; until then this state is explicitly unavailable.
    runtime: { state: "unavailable", checkedAt: null, skills: [] },
  };
}

function publicConfig(json: string): WorkConfig {
  const { revision: _internalRevision, ...configuration } = JSON.parse(json) as WorkConfig & { revision?: number };
  return configuration;
}
