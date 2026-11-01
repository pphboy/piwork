/** Display-only notices. Feature owners retain all requests, locks and recovery admission. */
export class NoticeStore {
  constructor({ now = () => Date.now(), onChange = () => {} } = {}) {
    this.now = now;
    this.onChange = onChange;
    this.identity = '';
    this.entries = new Map();
    this.seen = new Set();
    this.timer = undefined;
  }

  setIdentity(identity) {
    if (identity === this.identity) return;
    this.identity = identity;
    this.entries.clear();
    this.seen.clear();
    clearTimeout(this.timer);
    this.onChange();
  }

  publish(event) {
    if (event.identity !== this.identity) return false;
    const owner = JSON.stringify([event.object, event.task, event.generation]);
    const fingerprint = JSON.stringify([owner, event.key]);
    // A real state transition may return to an earlier state for this exact
    // task. Re-rendering or dismissal alone must never replay that event.
    const transitioning = [...this.entries.values()].some(prior => prior.owner === owner && prior.id !== fingerprint);
    if (this.seen.has(fingerprint) && !transitioning) return false;
    this.seen.add(fingerprint);
    // Only a confirmation from the same task generation replaces its unknown.
    for (const [key, prior] of this.entries) {
      if (prior.owner === owner) this.entries.delete(key);
    }
    this.entries.set(fingerprint, {
      ...event, owner, id: fingerprint,
      expires: event.tone === 'success' ? this.now() + 3000 : undefined,
    });
    this.schedule();
    this.onChange();
    return true;
  }

  /** A feature confirmed the original task by reading; no success toast is required. */
  resolve({ identity, object, task, generation }) {
    if (identity !== this.identity) return;
    const owner = JSON.stringify([object, task, generation]);
    // Confirmation closes this observation episode. A later failure may use the
    // same logical read owner; dismissal alone deliberately does not reset seen.
    for (const fingerprint of this.seen) {
      if (JSON.parse(fingerprint)[0] === owner) this.seen.delete(fingerprint);
    }
    let changed = false;
    for (const [id, item] of this.entries) {
      if (item.owner === owner) {
        this.entries.delete(id);
        changed = true;
      }
    }
    if (changed) {
      this.schedule();
      this.onChange();
    }
  }

  dismiss(id) {
    if (!this.entries.delete(id)) return;
    this.schedule();
    this.onChange();
  }

  items() {
    const rank = { unknown: 0, error: 1, warning: 2, success: 3 };
    return [...this.entries.values()].sort((a, b) => rank[a.tone] - rank[b.tone]);
  }

  schedule() {
    clearTimeout(this.timer);
    const expires = this.items().flatMap(item => item.expires === undefined ? [] : [item.expires]);
    if (!expires.length) return;
    this.timer = setTimeout(() => {
      for (const [key, item] of this.entries) {
        if (item.expires !== undefined && item.expires <= this.now()) this.entries.delete(key);
      }
      this.schedule();
      this.onChange();
    }, Math.max(0, Math.min(...expires) - this.now()));
    this.timer.unref?.();
  }

  destroy() {
    clearTimeout(this.timer);
    this.entries.clear();
    this.seen.clear();
  }
}

/** One DOM host; textContent only. Updating language never republishes an event. */
export function createNoticeHost(store, { document, closeLabel }) {
  const element = document.createElement('aside');
  element.className = 'notice-host';
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-relevant', 'additions');
  const nodes = new Map();

  function render() {
    const items = store.items();
    const live = new Set(items.map(item => item.id));
    for (const [id, node] of nodes) {
      if (!live.has(id)) {
        node.remove();
        nodes.delete(id);
      }
    }
    for (const item of items) {
      let node = nodes.get(item.id);
      if (!node) {
        node = document.createElement('section');
        node.className = `notice notice-${item.tone}`;
        const message = document.createElement('p');
        message.className = 'notice-message';
        const actions = document.createElement('div');
        actions.className = 'notice-actions';
        if (item.recovery) {
          const recover = document.createElement('button');
          recover.type = 'button';
          recover.className = 'notice-recovery';
          recover.addEventListener('click', () => {
            if (item.identity === store.identity && store.entries.has(item.id)) item.recovery.run();
          });
          actions.append(recover);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'notice-close';
        close.addEventListener('click', () => store.dismiss(item.id));
        actions.append(close);
        node.append(message, actions);
        nodes.set(item.id, node);
        element.append(node);
      }
      node.querySelector('.notice-message').textContent = item.message();
      const recovery = node.querySelector('.notice-recovery');
      if (recovery) recovery.textContent = item.recovery.label();
      node.querySelector('.notice-close').textContent = closeLabel();
    }
    element.hidden = !items.length;
  }

  return {
    element,
    render,
    destroy() {
      element.remove();
      nodes.clear();
    },
  };
}
