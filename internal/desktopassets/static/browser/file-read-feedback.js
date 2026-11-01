/** The actual directory or preview read owns truth; this projection never reads or changes a file. */
export function fileReadFeedback(input, identity, recovery) {
    if (!input.active || !input.workId || !input.path)
        return;
    const owner = { identity, object: input.workId, task: `files:${input.kind}:${input.path}`, generation: 0 };
    const error = input.kind === 'directory' ? input.directory?.error
        : ['missing', 'unavailable', 'error'].includes(input.status) ? input.error : undefined;
    const recovered = input.kind === 'directory'
        ? !!input.directory?.checkedAt && !input.directory.loading && !error
        : input.status === 'ready';
    return {
        owner, workId: input.workId, path: input.path, kind: input.kind, error, recovered,
        event: error ? {
            ...owner, tone: 'error', key: 'read-error',
            message: () => `${input.path} · ${String(error)}`, recovery,
        } : undefined,
    };
}
export function fileReadOwnsAction(feedback, action) {
    const error = action.errorMessage?.() || action.error;
    if (!feedback?.event || action.kind !== 'read' || action.work !== feedback.workId || action.resource !== feedback.path || !error || String(feedback.error) !== error)
        return false;
    const actions = feedback.kind === 'directory'
        ? ['tab-Files', 'refresh-files', 'file-path', 'open-file', 'open-source']
        : ['open-file', 'open-source', 'retry-file-preview', 'refresh-files'];
    return actions.includes(action.action || '');
}
/** Remember only records already attributed to an actual file read error, not their requests or locks. */
export class FileReadNoticeOwners {
    owned = new WeakMap();
    has(action) { return this.owned.has(action); }
    get(action) { return this.owned.get(action); }
    owns(feedback, action) {
        if (!this.owned.has(action) && fileReadOwnsAction(feedback, action))
            this.owned.set(action, Object.freeze({ ...feedback.owner }));
        return this.owned.has(action);
    }
    recoveredOwner(feedback, action) {
        const owner = this.owned.get(action);
        if (!owner || action.kind !== 'read' || !feedback?.recovered || feedback.event)
            return;
        const current = feedback.owner;
        return owner.identity === current.identity && owner.object === current.object && owner.task === current.task && owner.generation === current.generation ? owner : undefined;
    }
}
//# sourceMappingURL=file-read-feedback.js.map