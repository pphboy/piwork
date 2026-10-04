export const terminalOperation = (state) => ['succeeded', 'failed', 'superseded'].includes(state);
export function lifecycleAction(kind) {
    const value = kind.toLowerCase().replace(/[-_]/g, ' ').trim();
    const match = /^(create|start|stop|retry|delete) work$/.exec(value);
    return match?.[1];
}
export function workState(value) {
    return { provisioning: 'Preparing', starting: 'Starting', ready: 'Ready', running: 'Ready', degraded: 'Degraded', stopping: 'Stopping', stopped: 'Stopped', failed: 'Failed', deleted: 'Deleted' }[value] ?? 'Unknown';
}
/** The confirmed snapshot remains intact; an accepted intention is displayed separately. */
export function projectWork(work, operations) {
    const related = operations.filter(op => op.workId === work.id && (op.action ?? lifecycleAction(op.kind)));
    const intent = work.lifecycleIntent;
    const original = related.find(op => op.id === intent?.operationId);
    const outstanding = related.filter(op => !terminalOperation(op.state));
    const ids = intent ? [intent.operationId, ...outstanding.map(op => op.id).filter(id => id !== intent.operationId)] : outstanding.map(op => op.id);
    // A single matching known operation provides a details shortcut, never an inferred server target.
    if (!ids.length && work.operationId)
        ids.push(work.operationId);
    const accepting = intent && (!original || !terminalOperation(original.state) || !!work.statusError);
    const stopping = work.desired === 'deleted' || work.desired === 'stopped' && work.status !== 'Stopped' || accepting && ['stop', 'delete'].includes(intent.action);
    const starting = accepting && ['create', 'start', 'retry'].includes(intent.action);
    let label = work.status;
    let action = 'check';
    let explanation = work.statusError ? `Work status not confirmed. ${work.statusError}` : '';
    if (stopping) {
        const failed = work.status === 'Failed' || original?.state === 'failed';
        label = failed ? 'Stop not confirmed' : work.desired === 'deleted' || intent?.action === 'delete' ? 'Deleting Work' : work.status === 'Stopping' ? 'Stopping' : 'Stop accepted';
        explanation ||= failed ? original?.error || 'Check the original operation before continuing.' : `Last confirmed: ${work.status}. Waiting for the ${label === 'Deleting Work' ? 'deletion' : 'stop'} result.`;
    }
    else if (starting && !['Preparing', 'Starting'].includes(work.status)) {
        label = intent.action === 'create' ? 'Create accepted' : 'Start accepted';
        explanation ||= `Last confirmed: ${work.status}. Waiting for the start result.`;
        action = 'stop';
    }
    else if (['Preparing', 'Starting'].includes(work.status) && work.desired === 'running')
        action = 'stop';
    else if (work.status === 'Stopped' && work.desired === 'stopped')
        action = 'start';
    else if (work.status === 'Failed' && work.desired === 'running')
        action = 'retry';
    else if (['Ready', 'Degraded'].includes(work.status) && work.desired === 'running')
        action = 'stop';
    if (work.status === 'Failed' && !explanation)
        explanation = work.error || original?.error || 'Check related operations for confirmed failure details.';
    if (work.statusError && !stopping) {
        label = 'Work status not confirmed';
        action = 'check';
    }
    const usable = !stopping && !starting && !work.statusError && work.desired === 'running' && ['Ready', 'Degraded'].includes(work.status);
    return { label, explanation, action, usable,
        exportable: !stopping && !starting && !work.statusError && work.desired === 'stopped' && work.status === 'Stopped' && !outstanding.length,
        operationIds: ids };
}
//# sourceMappingURL=lifecycle.js.map