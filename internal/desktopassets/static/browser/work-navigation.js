export function restoreSelection(previous) {
    return { area: previous && ['Services', 'Chat', 'Files'].includes(previous.area) ? previous.area : 'Services',
        path: previous?.path || '/', file: previous?.file || '', service: previous?.service || '',
        port: previous?.port || 0, session: previous?.session || '' };
}
export function parentDirectory(path) {
    return path.replace(/\/+$/, '').slice(0, path.replace(/\/+$/, '').lastIndexOf('/')) || '/';
}
export function missingFileTarget(status) { return status === 404 || status === 410; }
/** Choose only after real reads; never replace an explicit restored area. */
export function initialWorkArea(previous, work, usable, chatReady) {
    if (previous && ['Services', 'Chat', 'Files'].includes(previous.area))
        return previous.area;
    const confirmed = !!work.resourceChecked?.services && !!work.resourceChecked?.agent && !work.resourceErrors?.services && !work.resourceErrors?.agent;
    return usable && chatReady && confirmed && !work.services.some(service => service.enabled && service.observed === 'Ready' && service.ports.length) ? 'Chat' : 'Services';
}
export function unavailableServicesReason(work) {
    if (!work.resourceChecked?.services || work.resourceErrors?.services || work.services.some(service => service.enabled && service.observed === 'Ready' && service.ports.length))
        return '';
    if (!work.services.length)
        return 'This Work has no Services. You can ask the Agent to build an application.';
    return 'No Web Service is ready. ' + work.services.map(service => `${service.name}: ${!service.enabled ? 'disabled' : service.observed.toLowerCase()}${!service.ports.length ? ' · no declared Web entry' : ''}${service.error ? ` · ${service.error}` : ''}`).join('; ');
}
//# sourceMappingURL=work-navigation.js.map