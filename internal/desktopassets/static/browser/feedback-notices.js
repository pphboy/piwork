/** Projection only: the ActionState remains the sole request/unknown-lock owner. */
export function actionNotice(record, identity, message, recovery) {
    if (record.pending || record.notificationProjection)
        return;
    const tone = record.blocked || record.resultTone === 'unknown' ? 'unknown' : record.error || record.refresh === 'failed' ? 'error' : record.result && record.kind !== 'read' ? record.resultTone || 'success' : undefined;
    if (!tone || tone === 'success' && !!record.successFeedback)
        return;
    return {
        identity,
        object: record.work || record.resource || 'identity',
        task: record.key,
        generation: `${record.generation}:${record.token}`,
        key: tone === 'success' ? 'success' : `${tone}:${record.refresh}`,
        tone,
        message,
        recovery,
    };
}
/** Only a confirmed read of the same key can retire its earlier read failure. */
export function confirmedReadRecovery(record) {
    return record.kind === 'read' && !record.pending && !record.error && !record.blocked &&
        record.refresh !== 'failed' && !!record.checkedAt ? record.key : undefined;
}
/** Preserve message identity until display time; no view or request state is captured. */
export function noticeMessage(value) {
    return typeof value === 'function' ? value : () => String(value);
}
//# sourceMappingURL=feedback-notices.js.map