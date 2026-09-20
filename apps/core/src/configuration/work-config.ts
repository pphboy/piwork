import { Check } from "typebox/value";
import { WorkConfigSchema, type WorkConfig } from "@piwork/contracts";
import { CoreStore, type WorkConfigurationState } from "@piwork/core-store";
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

export interface WorkConfigurationView {
  readonly workId: string;
  readonly desiredRevision: number;
  readonly activeRevision: number | null;
  readonly desired: WorkConfig;
  readonly active: WorkConfig | null;
  readonly pendingRestart: boolean;
}

export class WorkConfigurationService {
  constructor(
    private readonly store: CoreStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(principal: UserPrincipal, workId: string): WorkConfigurationView {
    const state = this.store.getWorkConfiguration(workId);
    authorizeConfiguration(principal, state, "read-metadata");
    return view(state!);
  }

  update(
    principal: UserPrincipal,
    workId: string,
    expectedRevision: number,
    configuration: WorkConfig,
    runtimeBinding?: { readonly runtimeProfileJson: string; readonly sourceRuntimeRevision: number | null },
  ): WorkConfigurationView {
    if (!Check(WorkConfigSchema, configuration)) throw new InvalidWorkConfigurationError();
    const existing = this.store.getWorkConfiguration(workId);
    authorizeConfiguration(principal, existing, "control");
    const next = { ...configuration, revision: expectedRevision + 1 };
    const updated = this.store.updateWorkConfiguration({
      workId,
      expectedRevision,
      configJson: JSON.stringify(next),
      createdByUserId: principal.userId,
      now: this.now().toISOString(),
      ...runtimeBinding,
    });
    return view(updated);
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
    desiredRevision: state.desiredRevision,
    activeRevision: state.activeRevision,
    desired: JSON.parse(state.desiredConfigJson) as WorkConfig,
    active: state.activeConfigJson === null ? null : JSON.parse(state.activeConfigJson) as WorkConfig,
    pendingRestart: state.pendingRestart,
  };
}
