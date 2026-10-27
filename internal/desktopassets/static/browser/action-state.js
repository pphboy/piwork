import { pendingDots } from './pending.js';
import { t } from './locale.js';
/** In-memory request coordination; never a queue or a remote task cancellation API. */
export class ActionState {
    changed;
    now;
    records = new Map();
    generation = 0;
    sequence = 0;
    announced = new Set();
    timer;
    constructor(changed = () => { }, now = () => Date.now()) {
        this.changed = changed;
        this.now = now;
    }
    conflict(intent) {
        return [...this.records.values()].find(record => (record.pending || record.blocked) && (record.key === intent.key || record.pending && (((record.kind === 'identity' || intent.kind === 'identity') && record.kind !== 'read' && intent.kind !== 'read') ||
            (!!intent.work && intent.work === record.work && intent.kind !== 'read' && record.kind !== 'read' && (record.kind === 'lifecycle' || intent.kind === 'lifecycle' ||
                (intent.kind === record.kind && (intent.kind === 'files' || intent.kind === 'configuration' || intent.kind === 'agent' || intent.resource === record.resource)))))));
    }
    begin(intent) {
        if (this.conflict(intent))
            return;
        for (const [key, old] of this.records)
            if (!old.pending && old.refresh !== 'refreshing' && old.view === intent.view && old.anchor === intent.anchor && !old.blocked)
                this.records.delete(key);
        const record = { ...intent, token: ++this.sequence, generation: this.generation,
            started: this.now(), pending: true, phase: intent.label, refresh: '' };
        this.records.set(record.key, record);
        this.tick();
        this.changed();
        return record;
    }
    current(record) { return record.generation === this.generation && this.records.get(record.key) === record; }
    update(record, phase) { if (this.current(record)) {
        record.phase = phase;
        this.changed();
    } }
    confirm(record, result) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.result = result;
        record.phase = result;
        record.checkedAt = new Date(this.now()).toISOString();
        record.visibleUntil = this.now() + 3000;
        this.tick();
        this.changed();
    }
    finish(record) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.checkedAt = new Date(this.now()).toISOString();
        if (!record.result && !record.error) {
            record.phase = record.refresh === 'failed' ? t('d.action.readbackUnconfirmed') : record.kind === 'read' ? t('d.action.statusChecked') : t('d.action.confirmed');
            record.visibleUntil = record.kind === 'read' && !['refresh-files', 'refresh-config', 'check-work', 'check-operation', 'check-connection', 'check-preview', 'check-catalog'].includes(record.action || '') ? 0 : this.now() + 3000;
        }
        this.tick();
        this.changed();
    }
    fail(record, error) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.error = error instanceof Error ? error.message : String(error);
        record.phase = t('d.action.notConfirmed');
        const code = error?.code;
        record.blocked = record.kind !== 'read' && record.kind !== 'identity' && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(code || '');
        this.changed();
    }
    reviewed(work, kinds, view) {
        for (const record of this.records.values())
            if (record.work === work && (!view || record.view === view) && kinds.includes(record.kind) && record.blocked) {
                record.blocked = false;
                record.phase = t('d.action.previousUnknown');
            }
        this.changed();
    }
    review(record) {
        if (!this.current(record) || !record.blocked)
            return;
        record.blocked = false;
        record.phase = t('d.action.previousUnknown');
        record.checkedAt = new Date(this.now()).toISOString();
        this.changed();
    }
    async refresh(record, read) {
        if (!this.current(record))
            return;
        record.refresh = 'refreshing';
        record.refreshError = undefined;
        this.changed();
        try {
            await read();
            if (this.current(record)) {
                record.refresh = '';
                record.checkedAt = new Date(this.now()).toISOString();
            }
        }
        catch (error) {
            if (this.current(record)) {
                record.refresh = 'failed';
                record.refreshError = error instanceof Error ? error.message : String(error);
            }
        }
        finally {
            if (this.current(record))
                this.changed();
        }
    }
    message(record) {
        const elapsed = Math.floor((this.now() - record.started) / 1000);
        return `${record.target} · ${record.phase}${record.pending && elapsed >= 10 ? t('d.action.waitingSuffix', { seconds: elapsed }) : ''}${record.error ? ` · ${record.error}` : ''}${record.refresh === 'refreshing' ? t('d.action.refreshing') : record.refresh === 'failed' ? ` · ${record.result ? t('d.action.retainedPrefix') : ''}${record.refreshError ? t('d.action.refreshNotConfirmedDetail', { detail: record.refreshError }) : t('d.action.refreshNotConfirmed')}` : ''}`;
    }
    visible(record) { return record.pending || !!record.error || !!record.blocked || record.refresh !== '' || (record.visibleUntil || 0) > this.now(); }
    clear() { this.generation++; this.records.clear(); this.announced.clear(); clearTimeout(this.timer); this.timer = undefined; this.changed(); }
    tick() {
        clearTimeout(this.timer);
        this.timer = undefined;
        const deadlines = [...this.records.values()].flatMap(record => [
            ...(record.pending && !this.announced.has(record.token) ? [record.started + 10000] : []),
            ...(record.visibleUntil ? [record.visibleUntil] : []),
        ]);
        if (!deadlines.length)
            return;
        this.timer = setTimeout(() => {
            this.timer = undefined;
            let changed = false;
            for (const record of this.records.values()) {
                if (record.pending && this.now() - record.started >= 10000 && !this.announced.has(record.token)) {
                    this.announced.add(record.token);
                    changed = true;
                }
                if (record.visibleUntil && record.visibleUntil <= this.now()) {
                    record.visibleUntil = undefined;
                    changed = true;
                }
            }
            if (changed)
                this.changed();
            this.tick();
        }, Math.max(0, Math.min(...deadlines) - this.now()));
    }
}
/** Safe DOM text and local status regions, without replacing input/iframe nodes. */
export function renderActionStates(root, actions, view, intentFor, visibleRecord = () => true) {
    const previous = new Map([...root.querySelectorAll('[data-action-status]')].map(node => [node.dataset.actionStatus, node]));
    // Only independently rendered page content can suppress duplicate feedback.
    // Retained status text must not make its own error/result disappear on the next render.
    let pageText = root.textContent || '';
    if (previous.size) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        pageText = '';
        let text;
        while ((text = walker.nextNode()))
            if (!text.parentElement?.closest('[data-action-status]'))
                pageText += text.textContent || '';
    }
    const shown = (node) => !!node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
    const regions = [...root.querySelectorAll('main, .main-panel, .agent-panel')];
    for (const button of root.querySelectorAll('button[data-action]')) {
        if (button.dataset.actionLocked) {
            button.disabled = button.dataset.actionBaseDisabled === 'true';
            delete button.dataset.actionLocked;
            delete button.dataset.actionBaseDisabled;
            if (!button.dataset.readBusy)
                button.removeAttribute('aria-busy');
        }
        const intent = intentFor(button);
        if (!intent)
            continue;
        // Only the read-only Files refresh retains keyboard focus while locked.
        if (button.dataset.action === 'refresh-files' && intent.kind === 'read' && button.dataset.readBusy && button.getAttribute('aria-disabled') === 'true')
            continue;
        const conflict = actions.conflict(intent);
        if (conflict) {
            button.dataset.actionBaseDisabled = String(button.disabled);
            button.dataset.actionLocked = 'true';
            button.disabled = true;
            button.setAttribute('aria-busy', String(conflict.pending || conflict.refresh === 'refreshing'));
        }
    }
    for (const record of actions.records.values()) {
        if (record.key.startsWith('route:') && !record.error)
            continue;
        // Files owns busy/success in its fixed refresh button; errors and unknowns still use the local region.
        if (record.kind === 'read' && ['open-work', 'retry-work-read', 'retry-works', 'tab-Files', 'refresh-files', 'file-path', 'open-file', 'open-source', 'sessions', 'select-session', 'retry-conversation', 'check-active-run'].includes(record.action || '') && !record.error && !record.blocked && record.refresh !== 'failed')
            continue;
        // A confirmed file batch has a short toast; pending, unknown and readback failures remain local.
        if (record.kind === 'files' && record.successFeedback === 'toast' && !record.pending && !record.error && !record.blocked && record.refresh !== 'failed')
            continue;
        if (!actions.visible(record) || record.view && record.view !== view || !visibleRecord(record))
            continue;
        if (!record.pending && record.error && pageText.includes(record.error) && !record.blocked && record.refresh !== 'failed')
            continue;
        if (!record.pending && record.result && pageText.includes(record.result) && !record.error && !record.blocked && record.refresh === '')
            continue;
        const anchor = record.anchor ? [...root.querySelectorAll(record.anchor)].find(shown) : null;
        const anchored = anchor?.closest('.dialog-body, .dialog-footer, .modal-body, .modal-footer, .work-card, .work-row, .main-panel, .agent-panel, .service-controls, .composer, .auth-card, .file-detail, .settings-content, main') ?? null;
        const dialog = anchor?.closest('dialog');
        const dialogSlot = dialog && (dialog.classList.contains('modal-create') || anchored?.matches('.modal-footer,.dialog-footer')) ? dialog.querySelector('[data-action-status-slot]') : null;
        const region = dialogSlot || (shown(anchored) ? anchored : regions.find(shown) ?? root);
        if (!region)
            continue;
        // A module may already show this request in its own fixed slot. Other objects and
        // error/unknown feedback still retain their own local region.
        if (record.pending && !record.error && !record.blocked && record.refresh !== 'failed' && record.action &&
            [...root.querySelectorAll('[data-pending-action][aria-busy="true"]')].some(slot => shown(slot) && (slot.dataset.pendingAction || '').split(/\s+/).includes(record.action) &&
                (!anchored || anchored.contains(slot) || dialog?.contains(slot))))
            continue;
        const node = previous.get(record.key) || document.createElement('div');
        previous.delete(record.key);
        node.dataset.actionStatus = record.key;
        node.className = record.kind === 'read' && !record.error && record.refresh !== 'failed' ? 'local-read-status' : `feedback ${record.error || record.refresh === 'failed' ? 'warning' : 'info'} action-status`;
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        node.setAttribute('aria-busy', String(record.pending || record.refresh === 'refreshing'));
        const visible = { ...record };
        if (record.error && pageText.includes(record.error))
            visible.error = undefined;
        if (record.refreshError && pageText.includes(record.refreshError))
            visible.refreshError = undefined;
        if (record.result && pageText.includes(record.result)) {
            visible.result = undefined;
            visible.phase = t('d.action.confirmed');
        }
        const message = actions.message(visible);
        // Update the text node in place so phase/elapsed-time messages do not restart dots.
        if (node.firstChild?.nodeType === 3)
            node.firstChild.nodeValue = message;
        else
            node.textContent = message;
        const busy = record.pending || record.refresh === 'refreshing';
        const dots = node.querySelector?.('.pending-dots');
        if (busy && !dots) {
            const template = document.createElement('span');
            template.innerHTML = pendingDots();
            if (template.firstElementChild)
                node.append(template.firstElementChild);
        }
        else if (!busy)
            dots?.remove();
        const detailsId = record.businessId && ['new-session', 'send-message', 'cancel-run', 'resume-run'].includes(record.action || '') ? `${record.action}:${record.businessId}` : '';
        if (node.dataset.actionDetails !== detailsId) {
            node.querySelector?.('.action-details')?.remove();
            node.dataset.actionDetails = detailsId;
        }
        if (detailsId && !node.querySelector?.('.action-details')) {
            const details = document.createElement('details'), summary = document.createElement('summary'), identity = document.createElement('code');
            details.className = 'action-details';
            summary.textContent = record.action === 'new-session' ? t('d.action.sessionDetails') : t('d.action.runDetails');
            identity.textContent = record.businessId || '';
            details.append(summary, identity);
            node.append(details);
        }
        // Status changes must not move the top of an interactive application frame.
        if (node.parentElement !== region) {
            if (region.querySelector('iframe'))
                region.append(node);
            else
                region.prepend(node);
        }
    }
    previous.forEach(node => node.remove());
}
//# sourceMappingURL=action-state.js.map