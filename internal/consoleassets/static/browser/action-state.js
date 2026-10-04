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
        this.changed();
    } }
    confirm(record, result) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.result = result;
        record.phase = result;
        record.checkedAt = new Date(this.now()).toISOString();
        this.changed();
    }
    finish(record) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.checkedAt = new Date(this.now()).toISOString();
        if (!record.result && !record.error)
            record.phase = 'Checked';
        this.changed();
    }
    fail(record, error) {
        if (!this.current(record))
            return;
        record.pending = false;
        record.error = error instanceof Error ? error.message : String(error);
        record.phase = 'Not confirmed';
        const code = error?.code;
        record.blocked = record.kind !== 'read' && record.kind !== 'identity' && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(code || '');
        this.changed();
    }
    reviewed(work, kinds, view) {
        for (const record of this.records.values())
            if (record.work === work && (!view || record.view === view) && kinds.includes(record.kind) && record.blocked) {
                record.blocked = false;
                record.phase = 'Previous result unknown; current object checked';
            }
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
        return `${record.target} · ${record.phase}${record.pending && elapsed >= 10 ? ` · Still waiting (${elapsed}s)` : ''}${record.error ? ` · ${record.error}` : ''}${record.refresh === 'refreshing' ? ' · Refreshing' : record.refresh === 'failed' ? ` · Confirmed result retained; refresh not confirmed: ${record.refreshError}` : ''}${!record.pending && record.checkedAt ? ` · ${record.checkedAt}` : ''}`;
    }
    clear() { this.generation++; this.records.clear(); clearTimeout(this.timer); this.timer = undefined; this.changed(); }
    tick() {
        if (this.timer)
            return;
        this.timer = setTimeout(() => { this.timer = undefined; if ([...this.records.values()].some(record => record.pending)) {
            this.changed();
            this.tick();
        } }, 1000);
    }
}
/** Safe DOM text and local status regions, without replacing input/iframe nodes. */
export function renderActionStates(root, actions, view, intentFor, visibleRecord = () => true) {
    root.querySelectorAll('[data-action-status]').forEach(node => node.remove());
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
        if (actions.conflict(intent)) {
            button.dataset.actionBaseDisabled = String(button.disabled);
            button.dataset.actionLocked = 'true';
            button.disabled = true;
            button.setAttribute('aria-busy', 'true');
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
        const node = document.createElement('div');
        node.dataset.actionStatus = record.key;
        node.className = `feedback ${record.error || record.refresh === 'failed' ? 'warning' : 'info'} action-status`;
        node.setAttribute('role', 'status');
        node.setAttribute('aria-live', 'polite');
        node.setAttribute('aria-busy', String(record.pending || record.refresh === 'refreshing'));
        const visible = { ...record };
        if (record.error && root.textContent?.includes(record.error))
            visible.error = undefined;
        if (record.result && root.textContent?.includes(record.result)) {
            visible.result = undefined;
            visible.phase = 'Confirmed';
        }
        node.textContent = actions.message(visible);
        // Status changes must not move the top of an interactive application frame.
        if (region.querySelector('iframe'))
            region.append(node);
        else
            region.prepend(node);
    }
}
//# sourceMappingURL=action-state.js.map