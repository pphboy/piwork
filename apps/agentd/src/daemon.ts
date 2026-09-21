export interface RuntimeIdentity {
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string;
}

export interface AgentReadiness {
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string;
  readonly acceptingRuns: boolean;
  readonly draining: boolean;
  readonly modelCredentialStatus: "available" | "missing" | "invalid";
  readonly unavailableMcpServerIds: readonly string[];
  readonly contextContractVersion: number;
  readonly contextIdentity: string;
  readonly initializationComplete: boolean;
  readonly loadedSkills: readonly {
    readonly name: string;
    readonly identity: string;
    readonly loaded: boolean;
    readonly modelVisible: boolean;
    readonly visibilityReason: "" | "model-invocation-disabled" | "read-tools-disabled";
  }[];
  readonly resolvedTools: readonly string[];
  readonly activeRunCount: number;
}

export class RuntimeIdentityError extends Error {
  constructor() {
    super("runtime identity does not match this daemon generation");
    this.name = "RuntimeIdentityError";
  }
}

export class AgentDaemonControl {
  private acceptingRuns = false;
  private draining = false;
  private activeRuns = 0;
  private waiters: Array<() => void> = [];
  private modelCredentialStatus: AgentReadiness["modelCredentialStatus"] = "missing";
  private unavailableMcpServerIds: string[] = [];
  private contextContractVersion = 0;
  private contextIdentity = "";
  private initializationComplete = false;
  private loadedSkills: AgentReadiness["loadedSkills"] = [];
  private resolvedTools: string[] = [];

  constructor(readonly identity: RuntimeIdentity) {}

  configure(status: {
    readonly modelCredentialStatus: AgentReadiness["modelCredentialStatus"];
    readonly unavailableMcpServerIds?: readonly string[];
    readonly contextIdentity: string;
    readonly loadedSkills: AgentReadiness["loadedSkills"];
    readonly resolvedTools: readonly string[];
    readonly initializationComplete: boolean;
    readonly initializationOnly?: boolean;
  }): void {
    if (!status.initializationComplete || status.contextIdentity === "" || status.loadedSkills.some((skill) => !skill.loaded)) {
      throw new Error("agent context initialization is incomplete");
    }
    this.modelCredentialStatus = status.modelCredentialStatus;
    this.unavailableMcpServerIds = [...(status.unavailableMcpServerIds ?? [])];
    this.contextContractVersion = 1;
    this.contextIdentity = status.contextIdentity;
    this.initializationComplete = status.initializationComplete;
    this.loadedSkills = [...status.loadedSkills];
    this.resolvedTools = [...status.resolvedTools];
    this.acceptingRuns = status.modelCredentialStatus === "available" && this.initializationComplete && !status.initializationOnly && !this.draining;
  }

  verifyIdentity(identity: RuntimeIdentity): void {
    if (
      identity.workId !== this.identity.workId
      || identity.generation !== this.identity.generation
      || identity.instanceId !== this.identity.instanceId
    ) throw new RuntimeIdentityError();
  }

  readiness(): AgentReadiness {
    return {
      ...this.identity,
      acceptingRuns: this.acceptingRuns,
      draining: this.draining,
      modelCredentialStatus: this.modelCredentialStatus,
      unavailableMcpServerIds: this.unavailableMcpServerIds,
      contextContractVersion: this.contextContractVersion,
      contextIdentity: this.contextIdentity,
      initializationComplete: this.initializationComplete,
      loadedSkills: this.loadedSkills,
      resolvedTools: this.resolvedTools,
      activeRunCount: this.activeRuns,
    };
  }

  beginRun(): () => void {
    if (!this.acceptingRuns) throw new Error("Work is not ready to accept Runs");
    this.activeRuns += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      this.activeRuns -= 1;
      if (this.activeRuns === 0) {
        const waiters = this.waiters;
        this.waiters = [];
        waiters.forEach((resolve) => resolve());
      }
    };
  }

  async drain(): Promise<void> {
    this.draining = true;
    this.acceptingRuns = false;
    if (this.activeRuns === 0) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  prepareConfigurationChange(): { readonly prepared: boolean; readonly busy: boolean; readonly activeRunCount: number } {
    if (this.activeRuns > 0) return { prepared: false, busy: true, activeRunCount: this.activeRuns };
    this.draining = true;
    this.acceptingRuns = false;
    return { prepared: true, busy: false, activeRunCount: 0 };
  }
}
