import { pendingDots } from './pending.js';
import { t } from './locale.js';
/** In-memory request coordination; never a queue or a remote task cancellation API. */
export class ActionState {
    changed;
    now;
    records = new Map();
    generation = 0;
    sequence = 0;
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
        record.phaseKey = undefined;
        this.changed();
    } }
    confirm(record, result) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.result = result;
        record.phase = result;
        record.phaseKey = undefined;
        record.checkedAt = new Date(this.now()).toISOString();
        this.changed();
    }
    finish(record) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.checkedAt = new Date(this.now()).toISOString();
        if (!record.result && !record.error)
            record.phaseKey = 'action.checked';
        this.changed();
    }
    fail(record, error) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.errorText = () => error instanceof Error ? error.message : String(error);
        record.error = record.errorText();
        record.phaseKey = 'common.notConfirmed';
        const code = error?.code;
        record.blocked = record.kind !== 'read' && record.kind !== 'identity' && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(code || '');
        this.changed();
    }
    reviewed(work, kinds, view) {
        for (const record of this.records.values())
            if (record.work === work && (!view || record.view === view) && kinds.includes(record.kind) && record.blocked) {
                record.blocked = false;
                record.phaseKey = 'action.previousResultUnknown';
            }
        this.changed();
    }
    async refresh(record, read) {
        if (!this.current(record))
            return;
        record.refresh = 'refreshing';
        record.refreshError = undefined;
        record.refreshErrorText = undefined;
        this.tick();
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
                record.refreshErrorText = () => error instanceof Error ? error.message : String(error);
                record.refreshError = record.refreshErrorText();
            }
        }
        finally {
            if (this.current(record))
                this.changed();
        }
    }
    message(record) {
        const elapsed = Math.floor((this.now() - record.started) / 1000);
        const phase = record.phaseKey ? t(record.phaseKey) : record.resultText && record.phase === record.result ? record.resultText() : record.phase;
        const error = record.errorText?.() ?? record.error;
        return `${record.target} · ${phase}${(record.pending || record.refresh === 'refreshing') && elapsed >= 10 ? ` · ${t('action.stillWaiting', { seconds: elapsed })}` : ''}${error ? ` · ${error}` : ''}${record.refresh === 'refreshing' ? ` · ${t('action.refreshing')}` : record.refresh === 'failed' ? ` · ${t('action.refreshFailed', { error: record.refreshErrorText?.() ?? record.refreshError ?? '' })}` : ''}${!record.pending && record.checkedAt ? ` · ${record.checkedAt}` : ''}`;
    }
    clear() { this.generation++; this.records.clear(); clearTimeout(this.timer); this.timer = undefined; this.changed(); }
    tick() {
        if (this.timer)
            return;
        this.timer = setTimeout(() => { this.timer = undefined; if ([...this.records.values()].some(record => record.pending || record.refresh === 'refreshing')) {
            this.changed();
            this.tick();
        } }, 1000);
    }
}
/** Safe DOM text and local status regions, without replacing input/iframe nodes. */
export function renderActionStates(root, actions, view, intentFor, visibleRecord = () => true) {
    const retained = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let pageText = '';
    while (walker.nextNode())
        if (!walker.currentNode.parentElement?.closest('[data-action-status]'))
            pageText += walker.currentNode.textContent || '';
    for (const button of root.querySelectorAll('button[data-action]')) {
        if (button.dataset.actionLocked) {
            button.disabled = button.dataset.actionBaseDisabled === 'true';
            delete button.dataset.actionLocked;
            delete button.dataset.actionBaseDisabled;
            button.removeAttribute('aria-busy');
        }
        const intent = intentFor(button);
        if (!intent)
            continue;
        const conflict = actions.conflict(intent);
        if (conflict) {
            button.dataset.actionBaseDisabled = String(button.disabled);
            button.dataset.actionLocked = 'true';
            button.disabled = true;
            button.setAttribute('aria-busy', String(conflict.pending));
        }
    }
    for (const record of actions.records.values()) {
        if (record.view && record.view !== view || !visibleRecord(record))
            continue;
        const anchor = record.anchor ? root.querySelector(record.anchor) : null;
        const region = anchor?.closest('.dialog-body, .dialog-footer, .modal-body, .modal-footer, .work-card, .work-row, .main-panel, .agent-panel, .service-controls, .composer, .auth-card, .file-detail, .settings-content, main') ??
            root.querySelector('main, .main-panel, .agent-panel') ?? root;
        if (!region)
            continue;
        const node = [...root.querySelectorAll('[data-action-status]')].find(node => node.dataset.actionStatus === record.key) || document.createElement('div');
        node.dataset.actionStatus = record.key;
        retained.add(node);
        node.className = `feedback ${record.error || record.refresh === 'failed' ? 'warning' : 'info'} action-status`;
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        node.setAttribute('aria-busy', String(record.pending || record.refresh === 'refreshing'));
        const visible = { ...record };
        const error = record.errorText?.() ?? record.error, result = record.resultText?.() ?? record.result;
        if (error && pageText.includes(error)) {
            visible.error = undefined;
            visible.errorText = undefined;
        }
        if (result && pageText.includes(result)) {
            visible.result = undefined;
            visible.phaseKey = 'action.confirmed';
        }
        if (!visible.phaseKey && record.phase === record.label && anchor)
            visible.phase = intentFor(anchor)?.label ?? record.phase;
        const pending = record.pending || record.refresh === 'refreshing';
        const message = actions.message(visible);
        if (node.dataset.pending !== String(pending)) {
            node.innerHTML = `${pending ? pendingDots() : ''}<span data-action-message></span>`;
            node.dataset.pending = String(pending);
        }
        const text = node.querySelector('[data-action-message]');
        if (text && text.textContent !== message)
            text.textContent = message;
        if (!node.isConnected) {
            const slot = record.kind === 'read' && !anchor?.closest('dialog') ? root.querySelector('#page-read-status') : null;
            if (slot)
                slot.append(node);
            else if (region.querySelector('iframe'))
                region.append(node);
            else
                region.prepend(node);
        }
    }
    for (const node of root.querySelectorAll('[data-action-status]'))
        if (!retained.has(node))
            node.remove();
}
//# sourceMappingURL=action-state.js.map