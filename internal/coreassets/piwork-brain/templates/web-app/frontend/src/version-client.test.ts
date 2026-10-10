import { describe, expect, it, vi } from 'vitest';
import { draft, saveDraft, watchVersion, needsFrontendAdoption } from './version-client';

describe('application version observation', () => {
  it('adopts the correct runtime mode while leaving development updates to HMR', () => {
    const same = { ready: true, codeVersion: 'code', frontendVersion: 'ui' };
    expect(needsFrontendAdoption({ ...same, mode: 'development' }, 'ui', false)).toBe(true);
    expect(needsFrontendAdoption({ ...same, mode: 'development', frontendVersion: 'hmr-change' }, 'ui', true)).toBe(false);
    expect(needsFrontendAdoption({ ...same, mode: 'static' }, 'ui', true)).toBe(true);
    expect(needsFrontendAdoption({ ...same, mode: 'static' }, 'ui', false)).toBe(false);
    expect(needsFrontendAdoption({ ...same, mode: 'static', frontendVersion: 'new-environment' }, 'ui', false)).toBe(true);
  });
  it('retains recoverable drafts across a new component/page instance', () => {
    saveDraft('title-test', 'unfinished work');
    expect(draft('title-test')).toBe('unfinished work');
  });
  it('keeps business reads current on each ready observation without reloading', async () => {
    vi.useFakeTimers();
    const versions = ['v1', 'v2', 'v2'];
    const fetcher = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => ({ ready: true, frontendVersion: 'development', codeVersion: versions.shift() || 'v2' }) }));
    vi.stubGlobal('fetch', fetcher);
    const update = vi.fn();
    const stop = watchVersion(update, vi.fn());
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(update).toHaveBeenCalledTimes(3);
    stop(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
  it('does not adopt unavailable/failed versions and resumes after a connection loss', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: true, frontendVersion: 'development', codeVersion: 'v1' }) })
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ready: false, frontendVersion: 'development', codeVersion: 'v2' }) })
      .mockResolvedValue({ ok: true, json: async () => ({ ready: true, frontendVersion: 'development', codeVersion: 'v2' }) });
    vi.stubGlobal('fetch', fetcher);
    const update = vi.fn(), status = vi.fn();
    const stop = watchVersion(update, status);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(10000);
    expect(update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(update).toHaveBeenCalledTimes(3);
    expect(status).toHaveBeenCalledWith('Connection interrupted. Updates resume automatically.');
    stop(); vi.useRealTimers(); vi.unstubAllGlobals();
  });
});
