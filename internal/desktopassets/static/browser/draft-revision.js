/** Coordinates the existing New Work fields; it never stores or resets their values. */
export class NewWorkDraftRevision {
    generation = 0;
    context = 0;
    revision = 0;
    accepted;
    capture() {
        return Object.freeze({ generation: this.generation, context: this.context, revision: this.revision });
    }
    edit() { this.revision++; this.accepted = undefined; }
    /** Call only for a reliable acceptance, before checking whether the old modal is visible. */
    accept(token) {
        if (!this.matches(token))
            return false;
        this.accepted = this.capture();
        return true;
    }
    /** Call once per explicit New Work. A true result asks the caller to restore its defaults. */
    open() {
        const reset = !!this.accepted && this.matches(this.accepted);
        this.context++;
        if (reset)
            this.revision++;
        this.accepted = undefined;
        return reset;
    }
    clear() { this.generation++; this.context = 0; this.revision = 0; this.accepted = undefined; }
    matches(token) {
        return token.generation === this.generation && token.context === this.context && token.revision === this.revision;
    }
}
/** The caller supplies all drafts for the current identity, not just the selected Work/Session. */
export function hasUnsentDrafts({ texts, imageGroups = [], pending = [] }) {
    for (const text of texts)
        if (text.length > 0)
            return true;
    // An image still being validated is already a selected, unsent draft.
    for (const images of imageGroups)
        if (images.length > 0)
            return true;
    for (const submission of pending)
        if (submission.text?.length || submission.images?.length)
            return true;
    return false;
}
/** Keep an unknown creation locked while allowing the upstream explicit new-name flow. */
export function createSubmissionBlocked(records, name) {
    for (const record of records)
        if (record.action === 'create-work' && (record.blocked || record.pending && record.resource === name.trim()))
            return true;
    return false;
}
//# sourceMappingURL=draft-revision.js.map