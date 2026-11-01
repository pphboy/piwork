/** Only explicit results notify; background observations and pending never do. */
export function resultNotice(owner, result) {
    if (result.pending || result.background)
        return;
    return {
        ...owner,
        key: `${owner.identity}:${owner.object}:${owner.task}:${owner.generation}:${result.phase}`,
        tone: result.unknown ? 'unknown' : result.error ? 'error' : result.warning ? 'warning' : 'success',
        message: result.message,
        ...(result.recovery ? { recovery: result.recovery } : {}),
    };
}
/** A notification cannot decide that a read resolved a write or release its lock. */
export function requiresOwnedRecovery(result) {
    return !!(result.unknown || result.refreshFailed || (result.error && !result.restorableDetached));
}
/** A retry is another observation of the same view, not a new notice owner. */
export function readFailureNotice(owner, code, message, recovery) {
    return resultNotice({ ...owner, task: 'read' }, {
        phase: `failed:${code}`,
        error: true,
        message,
        recovery,
    });
}
//# sourceMappingURL=feedback-policy.js.map