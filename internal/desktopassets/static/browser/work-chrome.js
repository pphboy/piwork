export function menuCommands(context) {
    if (context.identity !== context.currentIdentity)
        return [];
    if (context.scope === 'global-account') {
        return context.hosted && context.administrator
            ? [
                { action: 'quick-setup', icon: 'settings', labelKey: 'account.quickSetup', href: '/admin/setup' },
                { action: 'administration', icon: 'grid', labelKey: 'account.administration', href: '/admin' },
            ]
            : [];
    }
    const workId = context.targetWorkId;
    if (!workId)
        return [];
    if (context.scope !== 'work-row' && workId !== context.openedWorkId)
        return [];
    if (context.scope === 'service') {
        return context.targetServiceId ? [{ action: 'copy-local', icon: 'copy', labelKey: 'service.copyAccessLink', workId, serviceId: context.targetServiceId }] : [];
    }
    const entries = [
        { action: 'settings', icon: 'settings', labelKey: 'workMenu.settings', workId },
        { action: 'work-info', icon: 'info', labelKey: 'workMenu.info', workId },
        { action: 'export', icon: 'download', labelKey: 'workMenu.export', workId, separatorBefore: true },
    ];
    if (context.canStop)
        entries.push({ action: 'stop-work', icon: 'stop', labelKey: 'workMenu.stop', workId });
    entries.push({ action: 'delete-work', icon: 'trash', labelKey: 'workMenu.delete', workId, danger: true, separatorBefore: true });
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
/** Header display only. Original controls, recovery entries and locks remain owned elsewhere. */
export function workHeaderStatusPresentation(input) {
    const { control, operation } = input;
    if (control) {
        const confirmedReceipt = control.phase === 'accepted' && !control.error
            && operation?.id === control.operationId && operation?.workId === input.workId
            && operation?.checkedWorkId === input.workId
            && ['succeeded', 'superseded'].includes(operation.state)
            && !operation.observationError && !operation.error && operation.localRecordSaved !== false;
        if (!confirmedReceipt)
            return 'control';
    }
    return input.synchronizationPending ? 'reading' : 'observed';
}
//# sourceMappingURL=work-chrome.js.map