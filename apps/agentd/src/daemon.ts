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
  readonly loadedSkillDigests: readonly string[];
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
  private loadedSkillDigests: string[] = [];

  constructor(readonly identity: RuntimeIdentity) {}

  configure(status: {
    readonly modelCredentialStatus: AgentReadiness["modelCredentialStatus"];
    readonly unavailableMcpServerIds?: readonly string[];
    readonly loadedSkillDigests?: readonly string[];
  }): void {
    this.modelCredentialStatus = status.modelCredentialStatus;
    this.unavailableMcpServerIds = [...(status.unavailableMcpServerIds ?? [])];
    this.loadedSkillDigests = [...(status.loadedSkillDigests ?? [])];
    this.acceptingRuns = status.modelCredentialStatus === "available" && !this.draining;
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
      loadedSkillDigests: this.loadedSkillDigests,
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
}
