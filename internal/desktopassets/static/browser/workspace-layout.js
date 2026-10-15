export class WorkspacePanelsStore {
    values = new Map();
    get(workId) {
        let value = this.values.get(workId);
        if (!value) {
            value = { ratio: .7, collapsed: false, narrowChat: false };
            this.values.set(workId, value);
        }
        return value;
    }
    clear() { this.values.clear(); }
}
export const SPLIT_GUTTER = 12;
export function splitGeometry(width, ratio) {
    const available = Math.max(0, width - SPLIT_GUTTER), minimum = 400, maximum = available - 320;
    const narrow = width < 900 || maximum < minimum;
    const service = narrow ? available : Math.max(minimum, Math.min(maximum, available * (Number.isFinite(ratio) ? ratio : .7)));
    return { narrow, available, minimum, maximum, service, ratio: available ? service / available : .7 };
}
export function keyboardSplit(key, shift, width, ratio) {
    const geometry = splitGeometry(width, ratio);
    if (geometry.narrow)
        return;
    const step = shift ? 64 : 16;
    const pixels = key === 'ArrowLeft' ? geometry.service - step : key === 'ArrowRight' ? geometry.service + step
        : key === 'Home' ? geometry.minimum : key === 'End' ? geometry.maximum : key === 'Enter' ? geometry.available * .7 : undefined;
    if (pixels === undefined)
        return;
    return splitGeometry(width, pixels / geometry.available).ratio;
}
/** Place an execution once, at the final real message/activity belonging to it. */
export function executionAnchors(groups) {
    const last = new Map();
    groups.forEach((group, index) => group.messages.forEach(message => { if (message.runId)
        last.set(message.runId, index); }));
    const result = new Map();
    for (const [runId, index] of last)
        result.set(index, [...(result.get(index) || []), runId]);
    return result;
}
//# sourceMappingURL=workspace-layout.js.map