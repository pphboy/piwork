function errorCode(error) {
    return error && typeof error === "object" && "code" in error ? String(error.code) : "";
}
export class SkillEditor {
    skill = "";
    path = "";
    status = "empty";
    baseline = "";
    draft = "";
    version = "";
    error = "";
    /** A save may have reached Core but its response was lost. The submitted
     * snapshot stays locked for read-only verification; it is never replayed. */
    unknown = false;
    submitted = null;
    verified = null;
    saving = false;
    generation = 0;
    identity;
    port;
    constructor(port) {
        this.port = port;
        this.identity = port.identity();
    }
    get dirty() {
        return this.status === "ready" && this.draft !== this.baseline;
    }
    /** Identity invalidation clears content, draft and any upload reference. */
    reset() {
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
    syncIdentity() {
        if (this.identity === this.port.identity())
            return false;
        this.reset();
        return true;
    }
    async open(skill, path) {
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
            if (!this.current(generation, skill, path))
                return false;
            this.version = file.version;
            this.baseline = file.content;
            this.draft = file.content;
            this.status = "ready";
            return true;
        }
        catch (error) {
            if (!this.current(generation, skill, path))
                return false;
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
    input(value) {
        if (this.status === "ready")
            this.draft = value;
    }
    discard() {
        if (this.status !== "ready")
            return;
        this.draft = this.baseline;
        this.error = "";
    }
    async save() {
        if (!this.dirty || this.saving || this.unknown)
            return "noop";
        const submission = { skill: this.skill, path: this.path, content: this.draft, version: this.version };
        const generation = this.generation;
        this.saving = true;
        this.error = "";
        try {
            const saved = await this.port.save(submission.skill, submission.path, submission.content, submission.version);
            if (generation !== this.generation || this.skill !== submission.skill || this.path !== submission.path)
                return "stale";
            this.version = saved.version;
            this.baseline = submission.content;
            this.verified = null;
            return "saved";
        }
        catch (error) {
            if (generation !== this.generation)
                return "stale";
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
        }
        finally {
            this.saving = false;
        }
    }
    /** Read the original file to classify an unknown result. Never resubmits. */
    async verify() {
        const submission = this.submitted;
        if (!submission || submission.skill !== this.skill || submission.path !== this.path)
            return null;
        const generation = this.generation;
        try {
            const file = await this.port.read(submission.skill, submission.path);
            if (generation !== this.generation || this.skill !== submission.skill || this.path !== submission.path)
                return null;
            const matchesSubmission = file.content === submission.content;
            this.verified = { content: file.content, version: file.version, matchesSubmission };
            if (matchesSubmission) {
                this.version = file.version;
                this.baseline = submission.content;
                this.unknown = false;
                this.submitted = null;
            }
            return this.verified;
        }
        catch (error) {
            if (["SESSION_EXPIRED", "SESSION_CHANGED"].includes(errorCode(error)))
                this.reset();
            return null;
        }
    }
    current(generation, skill, path) {
        return generation === this.generation && this.skill === skill && this.path === path && this.identity === this.port.identity();
    }
}
//# sourceMappingURL=skill-editor.js.map