export function sameFileDropTarget(left, right) {
    return left.epoch === right.epoch && left.workId === right.workId &&
        left.directory === right.directory && left.view === right.view;
}
export function droppedFiles(items) {
    const entries = Array.from(items).filter(item => item.kind === 'file');
    if (!entries.length)
        return undefined;
    const files = [];
    for (const item of entries) {
        try {
            const entry = item.webkitGetAsEntry?.() ?? null;
            if (!entry?.isFile)
                return undefined;
            const file = item.getAsFile();
            if (!file)
                return undefined;
            files.push(file);
        }
        catch {
            return undefined;
        }
    }
    return files;
}
//# sourceMappingURL=file-drop.js.map