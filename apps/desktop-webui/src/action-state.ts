import { pendingDots } from './pending.js';
import { t } from './locale.js';

export type ActionKind = 'identity' | 'lifecycle' | 'files' | 'configuration' | 'service' | 'agent' | 'transfer' | 'read';
export interface ActionIntent {
  key: string; kind: ActionKind; work?: string; resource?: string; action?: string;
  label: string; target: string; anchor?: string; owner?: HTMLElement; view?: string; origin?: string; sourceContext?: string;
  /**
   * The originating control or the owning object's existing state slot already
   * shows this request. Always set this at intent time from a module fact (the
   * trigger renders its own wait, the object slot renders its own phase) — never
   * from "I want less UI". It only suppresses the generic region block; failure,
   * unknown writes, and a failed readback always fall back to the local region.
   */
  projected?: boolean;
}
export interface ActionRecord extends ActionIntent {
  token: number; generation: number; started: number; checkedAt?: string;
  pending: boolean; phase: string; result?: string; error?: string;
  blocked?: boolean;
  businessId?: string;
  visibleUntil?: number;
  successFeedback?: 'toast';
  refresh: '' | 'refreshing' | 'failed'; refreshError?: string;
  ownerPosition?: { left: number; top: number; bottom: number; scrollX: number; scrollY: number };
  ownerDialog?: HTMLDialogElement;
}

/** In-memory request coordination; never a queue or a remote task cancellation API. */
export class ActionState {
  records = new Map<string, ActionRecord>();
  private generation = 0;
  private sequence = 0;
  private announced = new Set<number>();
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private changed: () => void = () => {}, private now = () => Date.now()) {}
  conflict(intent: ActionIntent): ActionRecord | undefined {
    return [...this.records.values()].find(record => (record.pending || record.blocked) && (
      record.key === intent.key || record.pending && (
      ((record.kind === 'identity' || intent.kind === 'identity') && record.kind !== 'read' && intent.kind !== 'read') ||
      (!!intent.work && intent.work === record.work && intent.kind !== 'read' && record.kind !== 'read' && (
        record.kind === 'lifecycle' || intent.kind === 'lifecycle' ||
        (intent.kind === record.kind && (intent.kind === 'files' || intent.kind === 'configuration' || intent.kind === 'agent' || intent.resource === record.resource))
      ))
    )));
  }
  begin(intent: ActionIntent): ActionRecord | undefined {
    if (this.conflict(intent)) return;
    for (const [key, old] of this.records) if (!old.pending && old.refresh !== 'refreshing' && old.view === intent.view && old.anchor === intent.anchor && !old.blocked) this.records.delete(key);
    const record: ActionRecord = { ...intent, token: ++this.sequence, generation: this.generation,
      started: this.now(), pending: true, phase: intent.label, refresh: '' };
    if (intent.owner?.isConnected) {
      const box = intent.owner.getBoundingClientRect();
      record.ownerPosition = { left: box.left, top: box.top, bottom: box.bottom, scrollX: window.scrollX, scrollY: window.scrollY };
      record.ownerDialog = intent.owner.closest('dialog') ?? undefined;
    }
    this.records.set(record.key, record); this.tick(); this.changed(); return record;
  }
  current(record: ActionRecord) { return record.generation === this.generation && this.records.get(record.key) === record; }
  update(record: ActionRecord, phase: string) { if (this.current(record)) { record.phase = phase; this.changed(); } }
  confirm(record: ActionRecord, result: string) {
    if (!this.current(record)) return;
    record.pending = false; record.result = result; record.phase = result; record.checkedAt = new Date(this.now()).toISOString(); record.visibleUntil = this.now() + 3000; this.tick(); this.changed();
  }
  finish(record: ActionRecord) {
    if (!this.current(record)) return;
    record.pending = false; record.checkedAt = new Date(this.now()).toISOString();
    if (!record.result && !record.error) { record.phase = record.refresh === 'failed' ? t('d.action.readbackUnconfirmed') : record.kind === 'read' ? t('d.action.statusChecked') : t('d.action.confirmed'); record.visibleUntil = record.kind === 'read' && !['refresh-files', 'refresh-config', 'check-work', 'check-operation', 'check-connection', 'check-preview', 'check-catalog'].includes(record.action || '') ? 0 : this.now() + 3000; } this.tick(); this.changed();
  }
  fail(record: ActionRecord, error: unknown) {
    if (!this.current(record)) return;
    record.pending = false; record.error = error instanceof Error ? error.message : String(error); record.phase = t('d.action.notConfirmed');
    const code = (error as { code?: string })?.code;
    record.blocked = record.kind !== 'read' && record.kind !== 'identity' && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(code || ''); this.changed();
  }
  reviewed(work: string | undefined, kinds: ActionKind[], view?: string) {
    for (const record of this.records.values()) if (record.work === work && (!view || record.view === view) && kinds.includes(record.kind) && record.blocked) { record.blocked = false; record.phase = t('d.action.previousUnknown'); }
    this.changed();
  }
  review(record: ActionRecord) {
    if (!this.current(record) || !record.blocked) return;
    record.blocked = false; record.phase = t('d.action.previousUnknown');
    record.checkedAt = new Date(this.now()).toISOString(); this.changed();
  }
  async refresh(record: ActionRecord, read: () => Promise<unknown>) {
    if (!this.current(record)) return;
    record.refresh = 'refreshing'; record.refreshError = undefined; this.changed();
    try { await read(); if (this.current(record)) { record.refresh = ''; record.checkedAt = new Date(this.now()).toISOString(); } }
    catch (error) { if (this.current(record)) { record.refresh = 'failed'; record.refreshError = error instanceof Error ? error.message : String(error); } }
    finally { if (this.current(record)) this.changed(); }
  }
  message(record: ActionRecord) {
    const elapsed = Math.floor((this.now() - record.started) / 1000);
    return `${record.target} · ${record.phase}${record.pending && elapsed >= 10 ? t('d.action.waitingSuffix', { seconds: elapsed }) : ''}${record.error ? ` · ${record.error}` : ''}${record.refresh === 'refreshing' ? t('d.action.refreshing') : record.refresh === 'failed' ? ` · ${record.result ? t('d.action.retainedPrefix') : ''}${record.refreshError ? t('d.action.refreshNotConfirmedDetail', { detail: record.refreshError }) : t('d.action.refreshNotConfirmed')}` : ''}`;
  }
  slow(record: ActionRecord) { return record.pending && this.now() - record.started >= 10000; }
  visible(record: ActionRecord) { return record.pending || !!record.error || !!record.blocked || record.refresh !== '' || (record.visibleUntil || 0) > this.now(); }
  clear() { this.generation++; this.records.clear(); this.announced.clear(); clearTimeout(this.timer); this.timer = undefined; this.changed(); }
  private tick() {
    clearTimeout(this.timer); this.timer = undefined;
    const deadlines = [...this.records.values()].flatMap(record => [
      ...(record.pending && !this.announced.has(record.token) ? [record.started + 10000] : []),
      ...(record.visibleUntil ? [record.visibleUntil] : []),
    ]);
    if (!deadlines.length) return;
    this.timer = setTimeout(() => {
      this.timer = undefined; let changed = false;
      for (const record of this.records.values()) {
        if (record.pending && this.now() - record.started >= 10000 && !this.announced.has(record.token)) { this.announced.add(record.token); changed = true; }
        if (record.visibleUntil && record.visibleUntil <= this.now()) { record.visibleUntil = undefined; changed = true; }
      }
      if (changed) this.changed(); this.tick();
    }, Math.max(0, Math.min(...deadlines) - this.now()));
  }
}

/** Safe DOM text and local status regions, without replacing input/iframe nodes. */
export function renderActionStates(root: HTMLElement, actions: ActionState, view: string, intentFor: (element: HTMLElement) => ActionIntent | undefined, visibleRecord: (record: ActionRecord) => boolean = () => true) {
  const previous = new Map([...root.querySelectorAll<HTMLElement>('[data-action-status]')].map(node => [node.dataset.actionStatus!, node]));
  const pendingOwners = new Set<HTMLElement>();
  // Only independently rendered page content can suppress duplicate feedback.
  // Retained status text must not make its own error/result disappear on the next render.
  let pageText = root.textContent || '';
  if (previous.size) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    pageText = ''; let text: Node | null;
    while ((text = walker.nextNode())) if (!text.parentElement?.closest('[data-action-status]')) pageText += text.textContent || '';
  }
  const shown = (node: HTMLElement | null): node is HTMLElement => !!node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  const regions = [...root.querySelectorAll<HTMLElement>('main, .main-panel, .agent-panel')];
  for (const button of root.querySelectorAll<HTMLButtonElement>('button[data-action]')) {
    if (button.dataset.actionLocked) { button.disabled = button.dataset.actionBaseDisabled === 'true'; delete button.dataset.actionLocked; delete button.dataset.actionBaseDisabled; if (!button.dataset.readBusy) button.removeAttribute('aria-busy'); }
    const intent = intentFor(button); if (!intent) continue;
    // Only the read-only Files refresh retains keyboard focus while locked.
    if (button.dataset.action === 'refresh-files' && intent.kind === 'read' && button.dataset.readBusy && button.getAttribute('aria-disabled') === 'true') continue;
    const conflict = actions.conflict(intent);
    if (conflict) { button.dataset.actionBaseDisabled = String(button.disabled); button.dataset.actionLocked = 'true'; button.disabled = true; button.setAttribute('aria-busy', String(conflict.pending || conflict.refresh === 'refreshing')); }
  }
  for (const record of actions.records.values()) {
    if(record.key.startsWith('route:') && !record.error)continue;
    // Files owns busy/success in its fixed refresh button; errors and unknowns still use the local region.
    if(record.kind==='read' && ['open-work','retry-work-read','retry-works','tab-Files','refresh-files','file-path','open-file','open-source','sessions','select-session','retry-conversation','check-active-run'].includes(record.action || '') && !record.error && !record.blocked && record.refresh!=='failed')continue;
    // A confirmed file batch has a short toast; pending, unknown and readback failures remain local.
    if(record.kind==='files' && record.successFeedback==='toast' && !record.pending && !record.error && !record.blocked && record.refresh!=='failed')continue;
    if(record.action==='check-catalog' && !record.pending && !record.error && !record.blocked && record.refresh==='')continue;
    if (!actions.visible(record) || record.view && record.view !== view || !visibleRecord(record)) continue;
    const matches = record.anchor ? [...root.querySelectorAll<HTMLElement>(record.anchor)] : [];
    // A position in a selector result is not an identity: siblings can be
    // inserted or removed while the request is pending. Never transfer a
    // captured control's request to another matching element.
    const equivalent = record.owner && !root.contains(record.owner) ? matches.filter(node => intentFor(node)?.key === record.key) : [];
    const candidate = record.owner ? (root.contains(record.owner) ? record.owner : equivalent.length === 1 ? equivalent[0] : null) : matches.length === 1 ? matches[0] : null;
    const owner = shown(candidate ?? null) ? candidate! : null;
    if (owner) {
      const box = owner.getBoundingClientRect();
      record.ownerPosition = { left: box.left, top: box.top, bottom: box.bottom, scrollX: window.scrollX, scrollY: window.scrollY };
      record.ownerDialog = owner.closest('dialog') ?? undefined;
    }
    // A shared container or dialog is not proof that a slot belongs to this
    // request. A slot must be the trigger itself, or explicitly identify it.
    const ownsSlot = (slot: HTMLElement) => !!owner && (slot === owner || owner.contains(slot) || slot.dataset.pendingKey === record.key);
    if (record.pending && !record.error && !record.blocked && record.refresh !== 'failed' && record.action &&
      [...root.querySelectorAll<HTMLElement>('[data-pending-action][aria-busy="true"]')].some(slot =>
        shown(slot) && (slot.dataset.pendingAction || '').split(/\s+/).includes(record.action!) &&
        ownsSlot(slot))) continue;
    if (record.pending && !record.error && !record.blocked && record.refresh !== 'failed' && owner?.tagName === 'BUTTON' && owner.querySelector('.pending-dots') && !owner.querySelector(':scope > .action-pending-content')) continue;
    if (record.pending && !record.error && !record.blocked && record.refresh !== 'failed' && owner?.tagName === 'BUTTON' && (!owner.querySelector('.pending-dots') || owner.querySelector(':scope > .action-pending-content'))) {
      pendingOwners.add(owner);
      if (!owner.querySelector(':scope > .action-pending-content')) {
        owner.dataset.pendingOriginalTitle = owner.getAttribute('title') ?? '';
        if (!owner.hasAttribute('aria-label')) { owner.dataset.pendingGeneratedLabel = 'true'; owner.setAttribute('aria-label', (owner.textContent || '').trim()); }
        const content = document.createElement('span'), label = document.createElement('span'), indicator = document.createElement('span'), status = document.createElement('span');
        content.className = 'action-pending-content'; label.className = 'action-pending-label'; indicator.className = 'action-pending-indicator'; status.className = 'sr-only'; status.setAttribute('role', 'status');
        while (owner.firstChild) label.append(owner.firstChild);
        indicator.innerHTML = pendingDots(); content.append(label, indicator, status); owner.append(content);
      }
      const status = owner.querySelector<HTMLElement>(':scope > .action-pending-content > [role="status"]');
      if (status) {
        const slow = actions.slow(record);
        status.className = slow ? 'action-slow-status' : 'sr-only';
        status.textContent = actions.message(record) + (slow ? ` · ${t('d.action.waitingHint')}` : '');
        if (slow) positionSlowStatus(status, owner);
      }
      owner.title = actions.message(record); owner.setAttribute('aria-busy', 'true');
      continue;
    }
    // The originating control or the object's own state slot already shows this
    // request. Only the ordinary wait is suppressed: a real error, an unknown
    // write, or a failed readback must still surface in the local region, and a
    // vanished anchor (searched away, navigated) must fall back rather than lose
    // the feedback silently.
    if (record.projected && !record.error && !record.blocked && record.refresh !== 'failed') {
      if (owner) continue;
    }
    if (!record.pending && record.error && pageText.includes(record.error) && !record.blocked && record.refresh !== 'failed') continue;
    if (!record.pending && record.result && pageText.includes(record.result) && !record.error && !record.blocked && record.refresh === '') continue;
    const anchor = owner;
    const anchored = anchor?.closest<HTMLElement>('.dialog-body, .dialog-footer, .modal-body, .modal-footer, .work-card, .work-row, .main-panel, .agent-panel, .service-controls, .composer, .auth-card, .file-detail, .settings-content, main') ?? null;
    const dialog=anchor?.closest('dialog');
    const dialogSlot=dialog && (dialog.classList.contains('modal-create') || anchored?.matches('.modal-footer,.dialog-footer'))?dialog.querySelector<HTMLElement>('[data-action-status-slot]'):null;
    const originalDialog = !anchor && record.ownerDialog && root.contains(record.ownerDialog) && shown(record.ownerDialog) ? record.ownerDialog : null;
    const region = dialogSlot || originalDialog?.querySelector<HTMLElement>('[data-action-status-slot]') || originalDialog || (shown(anchored) ? anchored : regions.find(shown) ?? root);
    if (!region) continue;
    // A module may already show this request in its own fixed slot. Other objects and
    // error/unknown feedback still retain their own local region.
    if (record.pending && !record.error && !record.blocked && record.refresh !== 'failed' && record.action &&
      [...root.querySelectorAll<HTMLElement>('[data-pending-action][aria-busy="true"]')].some(slot =>
        shown(slot) && (slot.dataset.pendingAction || '').split(/\s+/).includes(record.action!) &&
        ownsSlot(slot))) continue;
    const node = previous.get(record.key) || document.createElement('div');
    previous.delete(record.key); node.dataset.actionStatus = record.key;
    node.className = record.kind==='read' && !record.error && record.refresh!=='failed' ? 'local-read-status' : `feedback ${record.error || record.refresh === 'failed' ? 'warning' : 'info'} action-status`;
    const floating = !anchor && record.pending && !record.error && !record.blocked && record.refresh !== 'failed';
    if (floating) node.className += ' action-orphan-status';
    node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite'); node.setAttribute('aria-busy', String(record.pending || record.refresh === 'refreshing'));
    const visible = { ...record };
    if (record.error && pageText.includes(record.error)) visible.error = undefined;
    if (record.refreshError && pageText.includes(record.refreshError)) visible.refreshError = undefined;
    if (record.result && pageText.includes(record.result)) { visible.result = undefined; visible.phase = t('d.action.confirmed'); }
    const message = actions.message(visible);
    // Update the text node in place so phase/elapsed-time messages do not restart dots.
    if (node.firstChild?.nodeType === 3) node.firstChild.nodeValue = message;
    else node.textContent = message;
    const busy = record.pending || record.refresh === 'refreshing';
    const dots = node.querySelector?.('.pending-dots');
    if (busy && !dots) {
      const template = document.createElement('span'); template.innerHTML = pendingDots();
      if (template.firstElementChild) node.append(template.firstElementChild);
    } else if (!busy) dots?.remove();
    const detailsId = record.businessId && ['new-session','send-message','cancel-run','resume-run'].includes(record.action || '') ? `${record.action}:${record.businessId}` : '';
    if (node.dataset.actionDetails !== detailsId) {
      node.querySelector?.('.action-details')?.remove(); node.dataset.actionDetails = detailsId;
    }
    if (detailsId && !node.querySelector?.('.action-details')) {
      const details = document.createElement('details'), summary = document.createElement('summary'), identity = document.createElement('code');
      details.className='action-details'; summary.textContent=record.action==='new-session'?t('d.action.sessionDetails'):t('d.action.runDetails'); identity.textContent=record.businessId || '';
      details.append(summary,identity); node.append(details);
    }
    // Status changes must not move the top of an interactive application frame.
    if (node.parentElement !== region) {
      if (region.querySelector('iframe')) region.append(node); else region.prepend(node);
    }
    if (floating) {
      const position = record.ownerPosition;
      const box = node.getBoundingClientRect();
      const left = position ? position.left + position.scrollX - window.scrollX : region.getBoundingClientRect().left;
      const top = position ? position.bottom + position.scrollY - window.scrollY + 6 : region.getBoundingClientRect().top + 6;
      node.style.left = `${Math.max(8, Math.min(left, window.innerWidth - box.width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(top, window.innerHeight - box.height - 8))}px`;
      node.dataset.actionFloating = 'true';
    } else if (node.dataset.actionFloating) { node.style.removeProperty('left'); node.style.removeProperty('top'); delete node.dataset.actionFloating; }
  }
  for (const owner of root.querySelectorAll<HTMLElement>('button:has(> .action-pending-content)')) {
    if (pendingOwners.has(owner)) continue;
    const content = owner.querySelector<HTMLElement>(':scope > .action-pending-content'), label = content?.querySelector<HTMLElement>(':scope > .action-pending-label');
    if (content && label) content.replaceWith(...label.childNodes);
    if (owner.dataset.pendingGeneratedLabel) { owner.removeAttribute('aria-label'); delete owner.dataset.pendingGeneratedLabel; }
    if (owner.dataset.pendingOriginalTitle) owner.title = owner.dataset.pendingOriginalTitle; else owner.removeAttribute('title');
    delete owner.dataset.pendingOriginalTitle;
    if (!owner.dataset.actionLocked && !owner.dataset.readBusy) owner.removeAttribute('aria-busy');
  }
  for (const owner of root.querySelectorAll<HTMLElement>('button[data-pending-generated-label]')) {
    if (pendingOwners.has(owner) || owner.querySelector(':scope > .action-pending-content')) continue;
    owner.removeAttribute('aria-label'); delete owner.dataset.pendingGeneratedLabel;
    if (owner.dataset.pendingOriginalTitle) owner.title = owner.dataset.pendingOriginalTitle; else owner.removeAttribute('title');
    delete owner.dataset.pendingOriginalTitle;
  }
  previous.forEach(node => node.remove());
  pruneSlowStatuses();
}

const slowStatuses = new Map<HTMLElement, HTMLElement>();
function repositionSlowStatuses() {
  if (!slowStatuses.size) return;
  for (const [status, owner] of slowStatuses) {
    if (!status.isConnected || !owner.isConnected || !status.classList.contains('action-slow-status')) { slowStatuses.delete(status); continue; }
    placeSlowStatus(status, owner);
  }
  if (!slowStatuses.size) { window.removeEventListener('scroll', repositionSlowStatuses, true); window.removeEventListener('resize', repositionSlowStatuses); }
}
export function pruneSlowStatuses() { repositionSlowStatuses(); }
export function positionSlowStatus(status: HTMLElement, owner: HTMLElement) {
  if (!slowStatuses.size) { window.addEventListener('scroll', repositionSlowStatuses, true); window.addEventListener('resize', repositionSlowStatuses); }
  slowStatuses.set(status, owner); placeSlowStatus(status, owner);
}
function placeSlowStatus(status: HTMLElement, owner: HTMLElement) {
  const anchor = owner.getBoundingClientRect(), box = status.getBoundingClientRect();
  status.style.visibility = anchor.bottom <= 0 || anchor.top >= window.innerHeight || anchor.right <= 0 || anchor.left >= window.innerWidth ? 'hidden' : '';
  status.style.left = `${Math.max(8, Math.min(anchor.left, window.innerWidth - box.width - 8))}px`;
  status.style.top = `${Math.max(8, anchor.top >= box.height + 8 ? anchor.top - box.height - 6 : Math.min(anchor.bottom + 6, window.innerHeight - box.height - 8))}px`;
}
