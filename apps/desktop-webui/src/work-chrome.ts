/** Read-only chrome contracts. Rendering never selects a Work or starts a request. */
export type MenuScope = 'global-account' | 'work-row' | 'work-header' | 'service';
export interface MenuContext {
  readonly scope: MenuScope;
  readonly identity: number;
  readonly currentIdentity: number;
  readonly targetWorkId?: string;
  readonly openedWorkId?: string;
  readonly targetServiceId?: string;
  readonly hosted?: boolean;
  readonly administrator?: boolean;
  readonly canStop?: boolean;
}
export interface MenuCommand {
  readonly action: string;
  readonly icon: string;
  readonly labelKey: string;
  readonly danger?: boolean;
  readonly href?: string;
  readonly workId?: string;
  readonly serviceId?: string;
}

export function menuCommands(context: MenuContext): readonly MenuCommand[] {
  if (context.identity !== context.currentIdentity) return [];
  if (context.scope === 'global-account') {
    return context.hosted && context.administrator
      ? [{ action: 'administration', icon: 'grid', labelKey: 'account.administration', href: '/admin' }]
      : [];
  }
  const workId = context.targetWorkId;
  if (!workId) return [];
  if (context.scope !== 'work-row' && workId !== context.openedWorkId) return [];
  if (context.scope === 'service') {
    return context.targetServiceId ? [{ action: 'service-requests', icon: 'note', labelKey: 'service.agentRequests', workId, serviceId: context.targetServiceId }] : [];
  }
  const entries: MenuCommand[] = [
    { action: 'work-history', icon: 'clock', labelKey: 'history.title', workId },
    { action: 'work-info', icon: 'info', labelKey: 'workMenu.info', workId },
    { action: 'settings', icon: 'settings', labelKey: 'workMenu.settings', workId },
    { action: 'export', icon: 'download', labelKey: 'workMenu.export', workId },
    { action: 'find-previous-export', icon: 'clock', labelKey: 'recovery.previousExport', workId },
  ];
  if (context.scope === 'work-header') entries.push({ action: 'pi-requests', icon: 'note', labelKey: 'work.piRequestsAria', workId });
  if (context.canStop) entries.push({ action: 'stop-work', icon: 'stop', labelKey: 'workMenu.stop', workId });
  entries.push({ action: 'delete-work', icon: 'trash', labelKey: 'workMenu.delete', workId, danger: true });
  return entries;
}

export interface WorkHeaderInput {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly standalone: boolean;
}
export function workHeaderModel(input: WorkHeaderInput) {
  return {
    ...input,
    backAction: input.standalone ? 'back-work' : 'back-works',
    backLabelKey: input.standalone ? 'work.backToWork' : 'work.backToWorks',
    menuScope: 'work-header' as const,
  };
}

export function serviceToolbarModel(input: {
  readonly workId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly observed: string;
  readonly hasRequests: boolean;
}) {
  return { ...input, status: input.enabled ? input.observed : 'Disabled', menuScope: 'service' as const };
}

/** Header display only. Original controls, recovery entries and locks remain owned elsewhere. */
export function workHeaderStatusPresentation(input: {
  readonly workId: string;
  readonly control?: {
    readonly phase: string;
    readonly operationId?: string;
    readonly error?: string;
  };
  readonly operation?: {
    readonly id: string;
    readonly workId: string;
    readonly checkedWorkId?: string;
    readonly state: string;
    readonly observationError?: string;
    readonly error?: string;
    readonly localRecordSaved?: boolean;
  };
  readonly synchronizationPending: boolean;
}): 'control' | 'reading' | 'observed' {
  const { control, operation } = input;
  if (control) {
    const confirmedReceipt = control.phase === 'accepted' && !control.error
      && operation?.id === control.operationId && operation?.workId === input.workId
      && operation?.checkedWorkId === input.workId
      && ['succeeded', 'superseded'].includes(operation.state)
      && !operation.observationError && !operation.error && operation.localRecordSaved !== false;
    if (!confirmedReceipt) return 'control';
  }
  return input.synchronizationPending ? 'reading' : 'observed';
}
