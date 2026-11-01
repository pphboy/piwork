export function menuCommands(context) {
    if (context.identity !== context.currentIdentity)
        return [];
    if (context.scope === 'global-account') {
        return context.hosted && context.administrator
            ? [{ action: 'administration', icon: 'grid', labelKey: 'account.administration', href: '/admin' }]
            : [];
    }
    const workId = context.targetWorkId;
    if (!workId)
        return [];
    if (context.scope !== 'work-row' && workId !== context.openedWorkId)
        return [];
    if (context.scope === 'service') {
        return context.targetServiceId ? [{ action: 'service-requests', icon: 'note', labelKey: 'service.agentRequests', workId, serviceId: context.targetServiceId }] : [];
    }
    const entries = [
        { action: 'work-history', icon: 'clock', labelKey: 'history.title', workId },
        { action: 'work-info', icon: 'info', labelKey: 'workMenu.info', workId },
        { action: 'settings', icon: 'settings', labelKey: 'workMenu.settings', workId },
        { action: 'export', icon: 'download', labelKey: 'workMenu.export', workId },
        { action: 'find-previous-export', icon: 'clock', labelKey: 'recovery.previousExport', workId },
    ];
    if (context.scope === 'work-header')
        entries.push({ action: 'pi-requests', icon: 'note', labelKey: 'work.piRequestsAria', workId });
    if (context.canStop)
        entries.push({ action: 'stop-work', icon: 'stop', labelKey: 'workMenu.stop', workId });
    entries.push({ action: 'delete-work', icon: 'trash', labelKey: 'workMenu.delete', workId, danger: true });
    return entries;
}
export function workHeaderModel(input) {
    return {
        ...input,
        backAction: input.standalone ? 'back-work' : 'back-works',
        backLabelKey: input.standalone ? 'work.backToWork' : 'work.backToWorks',
        menuScope: 'work-header',
    };
}
export function serviceToolbarModel(input) {
    return { ...input, status: input.enabled ? input.observed : 'Disabled', menuScope: 'service' };
}
//# sourceMappingURL=work-chrome.js.map