/** Current Skill file state. The feature owns one file and one draft; Core
 * owns the complete artifact and the only publication boundary. */
export type SkillFileEntry = { path: string; size: number };
export type SkillFileContent = { path: string; content: string; version: string };
export type SkillFileSaved = { path: string; version: string };
export type SkillEditorStatus = "empty" | "loading" | "ready" | "not-text" | "error";
export type SkillSaveOutcome = "saved" | "conflict" | "failed" | "unknown" | "stale" | "noop";

/** The only Core-facing surface this feature needs. The adapter implements it;
 * the feature never receives the store or the entry point. */
export interface SkillContentPort {
  files(skill: string): Promise<SkillFileEntry[]>;
  read(skill: string, path: string): Promise<SkillFileContent>;
  save(skill: string, path: string, content: string, expectedVersion: string): Promise<SkillFileSaved>;
  identity(): number;
}

export type SkillFileError = { code: string; message: string; field?: string };

function errorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
}

export class SkillEditor {
  skill = "";
  path = "";
  status: SkillEditorStatus = "empty";
  baseline = "";
  draft = "";
  version = "";
  error = "";
  /** A save may have reached Core but its response was lost. The submitted
   * snapshot stays locked for read-only verification; it is never replayed. */
  unknown = false;
  submitted: { skill: string; path: string; content: string; version: string } | null = null;
  verified: { content: string; version: string; matchesSubmission: boolean } | null = null;
  saving = false;
  private generation = 0;
  private identity: number;
  private readonly port: SkillContentPort;
  constructor(port: SkillContentPort) {
    this.port = port;
    this.identity = port.identity();
  }
  get dirty(): boolean {
    return this.status === "ready" && this.draft !== this.baseline;
  }
  /** Identity invalidation clears content, draft and any upload reference. */
  reset(): void {
    this.generation++;
    this.identity = this.port.identity();
    this.skill = "";
    this.path = "";
    this.status = "empty";
    this.baseline = this.draft = this.version = this.error = "";
    this.unknown = false;
    this.submitted = null;
    this.verified = null;
    this.saving = false;
  }
  /** Reconcile with an identity change observed by the page. */
  syncIdentity(): boolean {
    if (this.identity === this.port.identity()) return false;
    this.reset();
    return true;
  }
  async open(skill: string, path: string): Promise<boolean> {
    const generation = ++this.generation;
    this.identity = this.port.identity();
    this.skill = skill;
    this.path = path;
    this.status = "loading";
    this.baseline = this.draft = this.version = this.error = "";
    this.unknown = false;
    this.submitted = null;
    this.verified = null;
    try {
      const file = await this.port.read(skill, path);
      if (!this.current(generation, skill, path)) return false;
      this.version = file.version;
      this.baseline = file.content;
      this.draft = file.content;
      this.status = "ready";
      return true;
    } catch (error) {
      if (!this.current(generation, skill, path)) return false;
      const code = errorCode(error);
      if (code === "SKILL_FILE_NOT_TEXT") {
        this.status = "not-text";
        return false;
      }
      if (["SESSION_EXPIRED", "SESSION_CHANGED"].includes(code)) {
        this.reset();
        return false;
      }
      this.status = "error";
      this.error = error instanceof Error ? error.message : String(error);
      return false;
    }
  }
  input(value: string): void {
    if (this.status === "ready") this.draft = value;
  }
  discard(): void {
    if (this.status !== "ready") return;
    this.draft = this.baseline;
    this.error = "";
  }
  async save(): Promise<SkillSaveOutcome> {
    if (!this.dirty || this.saving || this.unknown) return "noop";
    const submission = { skill: this.skill, path: this.path, content: this.draft, version: this.version };
    const generation = this.generation;
    this.saving = true;
    this.error = "";
    try {
      const saved = await this.port.save(submission.skill, submission.path, submission.content, submission.version);
      if (generation !== this.generation || this.skill !== submission.skill || this.path !== submission.path) return "stale";
      this.version = saved.version;
      this.baseline = submission.content;
      this.verified = null;
      return "saved";
    } catch (error) {
      if (generation !== this.generation) return "stale";
      const code = errorCode(error);
      if (["SESSION_EXPIRED", "SESSION_CHANGED"].includes(code)) {
        this.reset();
        return "stale";
      }
      if (code === "SKILL_FILE_CONFLICT") {
        this.error = error instanceof Error ? error.message : String(error);
        return "conflict";
      }
      if (["RESULT_UNKNOWN", "CORE_UNREACHABLE", "INVALID_RESPONSE"].includes(code)) {
        this.unknown = true;
        this.submitted = submission;
        return "unknown";
      }
      this.error = error instanceof Error ? error.message : String(error);
      return "failed";
    } finally {
      this.saving = false;
    }
  }
  /** Read the original file to classify an unknown result. Never resubmits. */
  async verify(): Promise<{ content: string; version: string; matchesSubmission: boolean } | null> {
    const submission = this.submitted;
    if (!submission || submission.skill !== this.skill || submission.path !== this.path) return null;
    const generation = this.generation;
    try {
      const file = await this.port.read(submission.skill, submission.path);
      if (generation !== this.generation || this.skill !== submission.skill || this.path !== submission.path) return null;
      const matchesSubmission = file.content === submission.content;
      this.verified = { content: file.content, version: file.version, matchesSubmission };
      if (matchesSubmission) {
        this.version = file.version;
        this.baseline = submission.content;
        this.unknown = false;
        this.submitted = null;
      }
      return this.verified;
    } catch (error) {
      if (["SESSION_EXPIRED", "SESSION_CHANGED"].includes(errorCode(error))) this.reset();
      return null;
    }
  }
  private current(generation: number, skill: string, path: string): boolean {
    return generation === this.generation && this.skill === skill && this.path === path && this.identity === this.port.identity();
  }
}
