/** A terminal receipt alone is never a usable workspace. */
export function workCompletionReady(operation, workId, usable) {
    return !!operation && operation.workId === workId && operation.state === 'succeeded' && usable;
}
export function serviceCompletionReady(operation, workId, usable, service, port) {
    return workCompletionReady(operation, workId, usable) && !!service && service.enabled && service.observed === 'Ready' && service.ports.includes(port);
}
export function importCanStart(operation, work, currentAction, submitted) {
    return !submitted && !!operation && operation.kind === 'Import Work' && operation.state === 'succeeded' &&
        !!work && operation.workId === work.id && work.status === 'Stopped' && work.desired === 'stopped' && currentAction === 'start';
}
//# sourceMappingURL=completion-exits.js.map