declare const __PIWORK_FRONTEND_VERSION__: string;
const pendingDrafts = new Map<string, string>();
type Version = { codeVersion: string; frontendVersion: string; ready: boolean; mode?: 'development' | 'static' };

export function needsFrontendAdoption(next: Version, current: string, hot: boolean) {
  if (next.mode === 'development') return !hot;
  if (next.mode === 'static') return hot || next.frontendVersion !== current;
  return !hot && next.frontendVersion !== current;
}

export function watchVersion(onDataRefresh: () => void, onStatus: (message: string) => void) {
  let busy = false, disposed = false, reloading = false;
  const check = async () => {
    if (busy || disposed || reloading || document.visibilityState === 'hidden') return;
    busy = true;
    try {
      const response = await fetch('/api/runtime-version', { cache: 'no-store' });
      if (!response.ok) return;
      const next: Version = await response.json();
      if (!next.ready || typeof next.codeVersion !== 'string' || typeof next.frontendVersion !== 'string') return;
      if (needsFrontendAdoption(next, __PIWORK_FRONTEND_VERSION__, Boolean(import.meta.hot))) {
        // Drafts are saved on edit, before a Service restart can detach this page.
        for (const [key, value] of pendingDrafts) {
          try { sessionStorage.setItem(key, value); pendingDrafts.delete(key); }
          catch { onStatus('Update pending: keeping your unfinished input.'); return; }
        }
        sessionStorage.setItem('piwork:web:return-path', location.pathname + location.search + location.hash);
        reloading = true;
        location.reload();
        return;
      }
      // Regular reads also reflect Agent Actions without a code deployment.
      onDataRefresh();
      onStatus('');
    } catch {
      onStatus('Connection interrupted. Updates resume automatically.');
    } finally { busy = false; }
  };
  const visible = () => { if (document.visibilityState !== 'hidden') void check(); };
  const timer = setInterval(() => { void check(); }, 5000);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('online', visible);
  void check();
  return () => { disposed = true; clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', visible); };
}

export function draft(name: string, fallback = '') {
  try { return sessionStorage.getItem('piwork:web:draft:' + name) ?? fallback; } catch { return fallback; }
}
export function saveDraft(name: string, value: string) {
  const key = 'piwork:web:draft:' + name;
  try { sessionStorage.setItem(key, value); pendingDrafts.delete(key); }
  catch { pendingDrafts.set(key, value); }
}

export function rememberPath() {
  try { sessionStorage.setItem('piwork:web:return-path', location.pathname + location.search + location.hash); } catch {}
}

export function restorePath() {
  try {
    const path = sessionStorage.getItem('piwork:web:return-path');
    if (location.pathname === '/' && path?.startsWith('/') && !path.startsWith('//')) history.replaceState({}, '', path);
  } catch {}
  rememberPath();
  return location.pathname;
}
