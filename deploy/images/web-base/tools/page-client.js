/* Application-owned version adoption and explicitly supported nonsecret drafts. */
(() => {
  'use strict';
  const initial = window.piworkRuntime;
  if (!initial || window.piworkPageClient) return;
  window.piworkPageClient = true;
  const basePath = initial.basePath || '';
  const scope = initial.storageScope || 'local';
  const prefix = 'piwork:web:' + basePath + ':' + scope + ':';
  // These keys prevent ordinary app collisions, not malicious same-origin JS.
  const identityKey = 'piwork:web:identity:' + basePath;
  try {
    const previous = sessionStorage.getItem(identityKey);
    if (previous && previous !== scope) {
      const old = 'piwork:web:' + basePath + ':' + previous + ':';
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(old)) sessionStorage.removeItem(key);
    }
    sessionStorage.setItem(identityKey, scope);
  } catch {}
  window.piworkAppURL = path => {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Expected an application-root path');
    return basePath && (path === basePath || path.startsWith(basePath + '/')) ? path : basePath + path;
  };
  const pending = new Map();
  const restored = new WeakSet();
  let busy = false, reloading = false, needsReconnect = false;
  let feedbackEvent = '';

  function status(message) {
    const target = document.querySelector('[data-piwork-status]');
    if (target) target.textContent = message;
  }
  function save(name, value) {
    try { sessionStorage.setItem(prefix + 'draft:' + name, value); pending.delete(name); return true; }
    catch { pending.set(name, value); status('Update pending: keeping your unfinished input.'); return false; }
  }
  function field(input) {
    if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement)) return null;
    if (['password', 'hidden', 'file'].includes(input.type)) return null;
    return input.closest('[data-piwork-draft]')?.getAttribute('data-piwork-draft');
  }
  function restore() {
    for (const input of document.querySelectorAll('[data-piwork-draft] input,[data-piwork-draft] textarea,input[data-piwork-draft]')) {
      const name = field(input);
      if (!name || restored.has(input)) continue;
      restored.add(input);
      try {
        const value = sessionStorage.getItem(prefix + 'draft:' + name);
        if (value !== null && input.value === '') {
          const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      } catch { status('Draft storage unavailable. Current input is kept.'); }
    }
  }
  function persist() {
    let success = true;
    for (const [name, value] of [...pending]) success = save(name, value) && success;
    for (const input of document.querySelectorAll('[data-piwork-draft] input,[data-piwork-draft] textarea,input[data-piwork-draft]')) {
      const name = field(input);
      if (name) success = save(name, input.value) && success;
    }
    try { sessionStorage.setItem(prefix + 'return-path', location.pathname + location.search + location.hash); }
    catch { success = false; }
    if (!success) status('Update pending: keeping your unfinished input.');
    return success;
  }
  window.piworkClearDraft = name => { save(name, ''); };
  window.piworkSaveFeedback = id => {
    feedbackEvent = id;
    try { sessionStorage.setItem(prefix + 'feedback-event', id); } catch {}
    void feedback();
  };
  document.addEventListener('input', event => {
    const name = field(event.target);
    if (name) save(name, event.target.value);
  }, true);

  async function read(path) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(window.piworkAppURL(path), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Service unavailable');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function feedback() {
    if (!feedbackEvent || reloading) return;
    const target = document.querySelector('[data-piwork-feedback]');
    if (!target) return;
    try {
      const receipt = await read('/ui/receipts/' + encodeURIComponent(feedbackEvent));
      let message = `Feedback ${receipt.delivery} · event ${feedbackEvent}`;
      if (receipt.receipt?.requestId) {
        const next = await read('/ui/requests/' + encodeURIComponent(receipt.receipt.requestId));
        message += ` · Pi request ${next.request.requestId} · ${next.request.state}`;
        if (next.request.result) message += ` · ${next.request.result}`;
      }
      target.textContent = message;
    } catch { target.textContent = 'Pi status unavailable; checking automatically.'; }
  }
  async function check() {
    if (busy || reloading || document.visibilityState === 'hidden') return;
    busy = true;
    try {
      const next = await read('/api/runtime-version');
      if (!next.ready || !/^[a-f0-9]{64}$/.test(next.codeVersion) || !/^[a-f0-9]{64}$/.test(next.frontendVersion)) return;
      if (needsReconnect || next.codeVersion !== initial.codeVersion || next.frontendVersion !== initial.frontendVersion || next.mode !== initial.mode) {
        if (!persist()) return;
        reloading = true;
        location.reload();
        return;
      }
      status('');
      window.dispatchEvent(new Event('piwork:data-refresh'));
      void feedback();
    } catch { status('Connection interrupted. Updates resume automatically.'); }
    finally { busy = false; }
  }
  const reconnect = () => { needsReconnect = true; void check(); };
  function guard(socket) {
    if (!socket || socket.piworkGuarded) return;
    socket.piworkGuarded = true;
    const on = socket.on, emit = socket.emit;
    socket.on = function (event, callback) {
      if (event === 'try_reconnect') return on.call(this, event, reconnect);
      if (event === 'connect_error') return on.call(this, event, error => {
        if (error.message === 'Implicit handshake failed') reconnect();
        else if (error.message === 'timeout') {
          socket.io.opts.transports = ['polling', 'websocket'];
          status('Connection interrupted. Updates resume automatically.');
          void check();
        } else callback(error);
      });
      return on.call(this, event, callback);
    };
    socket.emit = function (event, ...args) {
      if (event === 'handshake' && typeof args.at(-1) === 'function') {
        const callback = args.pop();
        args.push(ok => { if (ok) callback(ok); else reconnect(); });
      }
      return emit.call(this, event, ...args);
    };
  }
  let socket = window.socket;
  guard(socket);
  Object.defineProperty(window, 'socket', {
    configurable: true,
    get: () => socket,
    set: value => { socket = value; guard(value); },
  });
  function start() {
    try { feedbackEvent = sessionStorage.getItem(prefix + 'feedback-event') || ''; } catch {}
    restore();
    new MutationObserver(restore).observe(document.body, { childList: true, subtree: true });
    setInterval(() => { void check(); }, 2000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
    window.addEventListener('online', () => { void check(); });
    void check();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
