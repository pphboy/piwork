/* Application-owned display refresh. Form requests are handled by htmx. */
(() => {
  const runtime = JSON.parse(document.querySelector('#piwork-runtime').textContent);
  const page = document.body.dataset.page;
  const url = path => runtime.basePath + path;
  window.piworkAppURL = url;
  window.piworkRuntime = runtime;
  const key = `piwork:fastapi:${runtime.storageScope}:${runtime.basePath}:`;
  const notice = message => { document.querySelector('#notice').textContent = message; };
  const status = message => { document.querySelector('[data-piwork-status]').textContent = message; };
  const stale = () => { document.querySelector('[data-piwork-data-status]').textContent = 'Unable to refresh data. Displayed data may be outdated; retrying automatically.'; };
  let seen = BigInt(document.body.dataset.stateVersion);
  let epoch = 0;
  let polling = false;
  let checking = false;
  let reloading = false;
  let feedbackEvent = '';
  const requests = new WeakMap();

  // Retire the old form draft only. Feedback receipts retain their own scope.
  try {
    sessionStorage.removeItem(key + 'todo-title');
    feedbackEvent = sessionStorage.getItem(key + 'feedback') || '';
  } catch { /* Form submission does not depend on browser storage. */ }
  for (const input of document.querySelectorAll('[data-clear-on-submit]')) input.value = '';

  async function read(path, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(url(path), { cache: 'no-store', ...options, signal: controller.signal });
      if (!response.ok) throw new Error('Request unavailable');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (polling || reloading || document.hidden || document.querySelector('form.htmx-request')) return;
    polling = true;
    try {
      await htmx.ajax('GET', url('/fragments/business?page=' + encodeURIComponent(page)), { target: '#business', swap: 'outerHTML' });
    } catch { stale(); }
    finally { polling = false; }
  }
  document.addEventListener('htmx:configRequest', event => {
    if (!event.detail.elt.closest('form')) return;
    event.detail.parameters.actionId = 'user-' + Array.from(crypto.getRandomValues(new Uint8Array(16)),
      byte => byte.toString(16).padStart(2, '0')).join('');
  });
  document.addEventListener('htmx:beforeRequest', event => {
    const form = event.detail.elt.closest('form');
    if (form) {
      epoch++;
      // htmx has captured request parameters before this event.
      for (const input of form.querySelectorAll('[data-clear-on-submit]')) input.value = '';
    }
    requests.set(event.detail.xhr, { epoch, form });
  });
  document.addEventListener('htmx:beforeSwap', event => {
    const { xhr } = event.detail;
    const request = requests.get(xhr);
    if ([400, 409, 422].includes(xhr.status)) {
      event.detail.shouldSwap = true;
      event.detail.isError = false;
    }
    const version = xhr.getResponseHeader('X-Piwork-State-Version');
    if (version && /^\d+$/.test(version)) {
      const next = BigInt(version);
      if ((!request?.form && request?.epoch !== epoch) || next < seen) {
        event.detail.shouldSwap = false;
        return;
      }
      seen = next;
      for (const field of document.querySelectorAll('[name="expectedStateVersion"]')) field.value = version;
      document.querySelector('[data-piwork-data-status]').textContent = '';
    }
  });
  document.addEventListener('piwork:action', () => {
    notice('');
    epoch++;
  });
  document.addEventListener('htmx:afterRequest', event => {
    const { xhr } = event.detail;
    if (!requests.get(xhr)?.form) {
      if (xhr.status < 200 || xhr.status >= 300) stale();
      return;
    }
    if (!xhr.status || xhr.status >= 500) notice('Submission not confirmed. Checking the list; no automatic retry.');
    if (xhr.status < 200 || xhr.status >= 300) void refresh();
  });

  async function feedback() {
    if (!feedbackEvent) return;
    const target = document.querySelector('[data-piwork-feedback]');
    if (!target) return;
    try {
      const receipt = await read('/ui/receipts/' + encodeURIComponent(feedbackEvent));
      let message = `Feedback ${receipt.delivery} · event ${feedbackEvent}`;
      if (receipt.receipt?.requestId) {
        const result = await read('/ui/requests/' + encodeURIComponent(receipt.receipt.requestId));
        message += ` · Pi request ${result.request.requestId} · ${result.request.state}`;
        if (result.request.result) message += ` · ${result.request.result}`;
      }
      target.textContent = message;
    } catch { target.textContent = 'Pi status unavailable; checking automatically.'; }
  }
  document.querySelector('#feedback')?.addEventListener('click', async () => {
    try {
      const result = await read('/ui/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'review_missing', goal: 'The personal review omits completed Todos. Verify and repair the original review.' }) });
      feedbackEvent = result.eventId;
      try { sessionStorage.setItem(key + 'feedback', feedbackEvent); } catch { /* Current receipt remains visible. */ }
      await feedback();
    } catch { notice('Feedback could not be confirmed.'); }
  });
  async function check() {
    if (checking || reloading || document.hidden) return;
    checking = true;
    try {
      const next = await read('/api/runtime-version');
      if (!next.ready || !/^[a-f0-9]{64}$/.test(next.codeVersion) || !/^[a-f0-9]{64}$/.test(next.frontendVersion)) return;
      if (next.frontendVersion !== runtime.frontendVersion) {
        if (document.querySelector('form.htmx-request')) return;
        reloading = true;
        location.reload();
        return;
      }
      runtime.codeVersion = next.codeVersion;
      status('');
      await refresh();
      await feedback();
    } catch { status('Connection interrupted. Updates resume automatically.'); }
    finally { checking = false; }
  }
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  setInterval(() => { void check(); }, 1500);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void check(); });
  window.addEventListener('online', () => { void check(); });
  void check();
})();
