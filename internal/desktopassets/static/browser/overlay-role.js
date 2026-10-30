/** Presentation only: action admission, object identity and write locks stay in their owners. */
export function overlayRole(name) {
    if (['account', 'work-menu', 'agent-menu', 'service-menu', 'file-menu'].includes(name))
        return 'menu';
    // The Works task list is a non-modal disclosure of the current identity's own
    // outstanding tasks, not a global operations centre.
    if (name === 'works-tasks')
        return 'drawer';
    if (['chat-history-status', 'chat-submission', 'service-picker', 'sessions', 'chat-response-settings', 'chat-input-options', 'connection', 'work-info', 'skill-detail'].includes(name))
        return 'popover';
    if (['manage-services', 'service-details', 'operations', 'operation', 'run-details', 'package-detail'].includes(name))
        return 'drawer';
    return 'modal';
}
export function anchoredOverlay(name) { return ['menu', 'popover'].includes(overlayRole(name)); }
export function overlayPlacement(anchor, size, viewport) {
    const margin = 8, gap = 6, width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
    const below = viewport.height - anchor.bottom - gap - margin, above = anchor.top - gap - margin;
    const upward = below < Math.min(size.height, 240) && above > below;
    const maxHeight = Math.max(0, (upward ? above : below));
    const height = Math.min(size.height, maxHeight);
    return { left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)), top: Math.max(margin, upward ? anchor.top - gap - height : anchor.bottom + gap), maxHeight };
}
export function menuDestination(key, index, count) {
    if (!count)
        return -1;
    if (key === 'Home')
        return 0;
    if (key === 'End')
        return count - 1;
    if (key === 'ArrowDown')
        return (index + 1 + count) % count;
    if (key === 'ArrowUp')
        return (index - 1 + count) % count;
    return -1;
}
export function overlayForAction(action) { return action === 'open-chat-settings' ? 'chat-response-settings' : action; }
//# sourceMappingURL=overlay-role.js.map