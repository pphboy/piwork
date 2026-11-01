function owner(identity, resource) {
    return { identity, object: resource, task: resource, generation: 0 };
}
/** Only a completed preference read/write can confirm this resource's own uncertainty. */
export function preferenceFeedback(facts, identity, recovery) {
    const target = owner(identity, 'default-core-preferences');
    const busy = facts.reading || ['loading', 'saving', 'clearing'].includes(facts.phase);
    if (busy)
        return { owner: target, recovered: false };
    const recovered = facts.phase === 'idle' && !facts.error && !facts.notice && facts.confirmedRevision === facts.revision;
    const tone = facts.phase === 'unconfirmed' ? 'unknown' : facts.error ? 'error' : facts.notice ? 'success' : undefined;
    return { owner: target, recovered, event: tone ? {
            ...target, key: `${facts.revision}:${tone}`, tone,
            message: () => String(facts.error || facts.notice), recovery: tone === 'success' ? undefined : recovery,
        } : undefined };
}
/** Session read failure is not a login mutation and never offers automatic login replay. */
export function sessionFeedback(facts, identity, recovery) {
    const target = owner(identity, 'desktop-session');
    return { owner: target, recovered: facts.state === 'ready' && !facts.error,
        event: facts.error ? {
            ...target, key: `${facts.revision}:error`, tone: 'error',
            message: () => String(facts.error), recovery,
        } : undefined };
}
/** The original unresolved credential intent remains owned by DesktopAdapter. */
export function signInFeedback(facts, identity, message, recovery) {
    const target = owner(identity, 'desktop-sign-in');
    return { owner: target, recovered: !facts.unknown, event: facts.unknown ? {
            ...target, key: `${facts.revision}:${facts.readRevision}:unknown`, tone: 'unknown', message, recovery,
        } : undefined };
}
/** The adapter's unresolved intent remains visible even if another account is signed in. */
export function signInActionFeedbackVisible(record, unknown) {
    return record.action !== 'sign-in' || record.notificationProjection !== 'sign-in-owner' || unknown;
}
//# sourceMappingURL=admission-feedback.js.map