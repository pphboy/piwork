export function restoreSelection(previous) {
    return { area: previous && ['Services', 'Chat', 'Files'].includes(previous.area) ? previous.area : 'Services',
        path: previous?.path || '/', file: previous?.file || '', service: previous?.service || '',
        port: previous?.port || 0, session: previous?.session || '' };
}
export function parentDirectory(path) {
    return path.replace(/\/+$/, '').slice(0, path.replace(/\/+$/, '').lastIndexOf('/')) || '/';
}
export function missingFileTarget(status) { return status === 404 || status === 410; }
//# sourceMappingURL=work-navigation.js.map