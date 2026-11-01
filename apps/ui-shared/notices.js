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

/** Display geometry only. Prefer a usable side gap; otherwise keep header/footer controls clear. */
export function noticeModalPlacement({ width, height, container, headerBottom, footerTop, viewportLeft = 0, viewportTop = 0, noticeHeight, pageHeaderBottom }) {
  const gap = 8;
  const minimumSideWidth = 240;
  // A nonmodal overlay must not cover still-active page navigation. Preserve the real bottom.
  if (Number.isFinite(pageHeaderBottom) && pageHeaderBottom > viewportTop) {
    const bottom = viewportTop + height;
    viewportTop = Math.min(pageHeaderBottom, bottom);
    height = bottom - viewportTop;
  }
  const viewportRight = viewportLeft + width, viewportBottom = viewportTop + height;
  const sides = [
    { left: Math.max(viewportLeft + gap, container.right + gap), right: viewportRight - gap },
    { left: viewportLeft + gap, right: Math.min(viewportRight - gap, container.left - gap) },
  ];
  const side = sides.find(candidate => candidate.right - candidate.left >= minimumSideWidth);
  if (side && height > gap * 2) {
    const noticeWidth = Math.min(380, side.right - side.left);
    const maxHeight = Math.min(320, height - gap * 2);
    return { left: side.left, top: Math.max(viewportTop + gap, Math.min(container.top + gap, viewportBottom - gap - maxHeight)),
      width: noticeWidth, maxHeight };
  }
  const left = Math.max(viewportLeft + gap, container.left + gap);
  const right = Math.min(viewportLeft + width - gap, container.right - gap);
  const start = Math.max(viewportTop + gap, container.top + gap, headerBottom + gap);
  const end = Math.min(viewportTop + height - gap, container.bottom - gap, footerTop - gap);
  const body = { top: start, bottom: end };
  const outside = [
    { top: viewportTop + gap, bottom: Math.min(viewportTop + height - gap, container.top - gap) },
    { top: Math.max(viewportTop + gap, container.bottom + gap), bottom: viewportTop + height - gap },
  ];
  if (Number.isFinite(noticeHeight) && noticeHeight > 0 && right > left) {
    const fittingOutside = outside.find(candidate => candidate.bottom - candidate.top >= noticeHeight);
    if (fittingOutside) {
      const noticeWidth = Math.min(380, right - left);
      const top = fittingOutside === outside[0] ? fittingOutside.bottom - noticeHeight : fittingOutside.top;
      return { left: right - noticeWidth, top, width: noticeWidth, maxHeight: noticeHeight };
    }
  }
  const candidates = end - start >= 44 ? [body] : [body, ...outside];
  const slot = candidates.reduce((best, next) => next.bottom - next.top > best.bottom - best.top ? next : best);
  if (right <= left || slot.bottom <= slot.top) return null;
  const noticeWidth = Math.min(380, right - left);
  return { left: right - noticeWidth, top: slot.top, width: noticeWidth, maxHeight: slot.bottom - slot.top };
}

/** Global positioning changes only when a real notice intersects a visible page boundary. */
export function noticePagePlacement({ notice, header, toolbars = [], footers = [], viewportTop = 0, viewportHeight }) {
  const visible = rect => rect && rect.right > rect.left && rect.bottom > rect.top
    && rect.bottom > viewportTop && rect.top < viewportTop + viewportHeight;
  const overlaps = rect => visible(rect) && notice.left < rect.right && notice.right > rect.left
    && notice.top < rect.bottom && notice.bottom > rect.top;
  const topRows = [header, ...toolbars].filter(visible);
  const bottomRows = footers.filter(visible);
  const headerHit = topRows.some(overlaps), footerHit = bottomRows.some(overlaps);
  if (!headerHit && !footerHit) return null;
  const start = Math.max(viewportTop + 8, ...topRows.map(rect => rect.bottom + 8));
  const end = Math.min(viewportTop + viewportHeight - 8, ...bottomRows.map(rect => rect.top - 8));
  if (end <= start) return null;
  const maxHeight = Math.min(notice.bottom - notice.top, end - start);
  if (maxHeight <= 0) return null;
  return { top: headerHit ? start : end - maxHeight, maxHeight };
}

/** One DOM host; textContent only. Updating language never republishes an event. */
export function createNoticeHost(store, { document, closeLabel }) {
  const element = document.createElement('aside');
  element.className = 'notice-host';
  element.setAttribute('aria-live', 'polite');
  element.setAttribute('aria-relevant', 'additions');
  const nodes = new Map();
  const window = document.defaultView;
  let modalRegion = null;
  let pageRegion = null;
  let frame;
  const resizeObserver = window?.ResizeObserver ? new window.ResizeObserver(schedulePlacement) : null;
  function boundaryRect(node) {
    if (!node || node.isConnected === false || node.closest?.('[inert]')) return null;
    const box = node.getBoundingClientRect();
    const rect = { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    for (let current = node; current; current = current.parentElement) {
      const style = window?.getComputedStyle?.(current);
      if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return null;
      if (current === node || !style) continue;
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX || style.overflow);
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY || style.overflow);
      if (!clipsX && !clipsY) continue;
      const clip = current.getBoundingClientRect();
      if (clipsX) {
        rect.left = Math.max(rect.left, clip.left);
        rect.right = Math.min(rect.right, clip.right);
      }
      if (clipsY) {
        rect.top = Math.max(rect.top, clip.top);
        rect.bottom = Math.min(rect.bottom, clip.bottom);
      }
    }
    return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
  }
  function place() {
    // Measure the actual global CSS position, not a hard-coded bottom or a previous avoidance result.
    element.removeAttribute('data-page-region');
    for (const key of ['top', 'max-height']) element.style.removeProperty(`--notice-page-${key}`);
    if (pageRegion && (pageRegion.header && !pageRegion.header.isConnected || pageRegion.footers?.some(node => !node.isConnected) || pageRegion.toolbars?.some(node => !node.isConnected))) {
      pageRegion = { header: pageRegion.header?.isConnected ? pageRegion.header : null,
        footers: pageRegion.footers?.filter(node => node.isConnected),
        toolbars: pageRegion.toolbars?.filter(node => node.isConnected) };
      observeBoundaries();
    }
    if (modalRegion && (!modalRegion.container.isConnected || modalRegion.container.matches('dialog:not([open])'))) {
      setModalRegion(null);
      return;
    }
    if (!modalRegion) {
      element.removeAttribute('data-modal-region');
      element.removeAttribute('data-modal-placement-constrained');
      for (const key of ['left', 'top', 'width', 'max-height']) element.style.removeProperty(`--notice-modal-${key}`);
      if (pageRegion && !element.hidden) {
        const placement = noticePagePlacement({ notice: element.getBoundingClientRect(),
          header: boundaryRect(pageRegion.header), toolbars: pageRegion.toolbars?.map(boundaryRect), footers: pageRegion.footers?.map(boundaryRect),
          viewportTop: window.visualViewport?.offsetTop || 0, viewportHeight: window.visualViewport?.height || window.innerHeight });
        if (placement) {
          element.setAttribute('data-page-region', '');
          element.style.setProperty('--notice-page-top', `${placement.top}px`);
          element.style.setProperty('--notice-page-max-height', `${placement.maxHeight}px`);
        }
      }
      return;
    }
    const container = modalRegion.container.getBoundingClientRect();
    const header = modalRegion.header?.getBoundingClientRect();
    const footer = modalRegion.footer?.getBoundingClientRect();
    const viewportTop = window.visualViewport?.offsetTop || 0;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const pageRows = !modalRegion.container.matches(':modal') ? [pageRegion?.header, ...(pageRegion?.toolbars || [])]
      .filter(Boolean).map(boundaryRect).filter(Boolean)
      .filter(rect => rect.right > rect.left && rect.bottom > rect.top && rect.bottom > viewportTop && rect.top < viewportTop + viewportHeight) : [];

    const facts = {
      pageHeaderBottom: pageRows.length ? Math.max(...pageRows.map(rect => rect.bottom)) : undefined,
      width: window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth,
      height: window.visualViewport?.height || window.innerHeight,
      viewportLeft: window.visualViewport?.offsetLeft || 0, viewportTop: window.visualViewport?.offsetTop || 0,
      container, headerBottom: header?.bottom ?? container.top, footerTop: footer?.top ?? container.bottom,
    };
    let placement = noticeModalPlacement(facts);
    if (placement) {
      // Measure full content at the candidate width, not a previous clipped rectangle.
      // The host itself is never observed, so this display-only measurement cannot loop observers.
      const pixels = `${placement.width}px`;
      if (element.style.getPropertyValue('--notice-modal-width') !== pixels) element.style.setProperty('--notice-modal-width', pixels);
      element.setAttribute('data-modal-region', '');
      placement = noticeModalPlacement({ ...facts, noticeHeight: element.scrollHeight });
    }
    if (!placement) {
      // No positive body or outside gap exists. Keep the notice visible under global placement,
      // rather than silently hiding an unresolved result in a zero-height container.
      element.removeAttribute('data-modal-region');
      element.setAttribute('data-modal-placement-constrained', '');
      return;
    }
    element.removeAttribute('data-modal-placement-constrained');
    element.setAttribute('data-modal-region', '');
    for (const [key, value] of Object.entries(placement)) {
      const name = `--notice-modal-${key === 'maxHeight' ? 'max-height' : key}`;
      const pixels = `${value}px`;
      if (element.style.getPropertyValue(name) !== pixels) element.style.setProperty(name, pixels);
    }
  }
  function schedulePlacement() {
    if (frame !== undefined) return;
    frame = window?.requestAnimationFrame(() => { frame = undefined;
    place(); });
  }
  function observeBoundaries() {
    resizeObserver?.disconnect();
    listen(false);
    if (frame !== undefined) window?.cancelAnimationFrame(frame);
    frame = undefined;
    const boundaries = modalRegion ? [modalRegion.container, modalRegion.header, modalRegion.footer] : [pageRegion?.header, ...(pageRegion?.toolbars || []), ...(pageRegion?.footers || [])];
    if (modalRegion && !modalRegion.container.matches(':modal')) boundaries.push(pageRegion?.header, ...(pageRegion?.toolbars || []));
    for (const node of new Set(boundaries)) if (node) resizeObserver?.observe(node);
    if (boundaries.some(Boolean)) listen(true);
  }
  function setModalRegion(region) {
    if (modalRegion?.container !== region?.container || modalRegion?.header !== region?.header || modalRegion?.footer !== region?.footer) {
      modalRegion = region;
      observeBoundaries();
    }
    place();
  }
  function setPageRegion(region) {
    if (pageRegion?.header !== region?.header
      || (pageRegion?.footers?.length || 0) !== (region?.footers?.length || 0)
      || (region?.footers || []).some((node, index) => node !== pageRegion?.footers?.[index])
      || (pageRegion?.toolbars?.length || 0) !== (region?.toolbars?.length || 0)
      || (region?.toolbars || []).some((node, index) => node !== pageRegion?.toolbars?.[index])) {
      pageRegion = region ? { ...region, toolbars: [...(region.toolbars || [])], footers: [...(region.footers || [])] } : null;
      observeBoundaries();
    }
    place();
  }
  function listen(active) {
    const method = active ? 'addEventListener' : 'removeEventListener';
    window?.[method]('resize', schedulePlacement);
    document[method]('scroll', schedulePlacement, true);
    window?.visualViewport?.[method]('resize', schedulePlacement);
    window?.visualViewport?.[method]('scroll', schedulePlacement);
  }

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
    place();
  }

  return {
    element,
    render,
    setModalRegion,
    setPageRegion,
    destroy() {
      resizeObserver?.disconnect();
      if (frame !== undefined) window?.cancelAnimationFrame(frame);
      listen(false);
      element.remove();
      nodes.clear();
    },
  };
}
