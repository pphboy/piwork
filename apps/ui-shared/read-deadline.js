// A read deadline covers both headers and response-body decoding. It does not
// imply that a remote operation was cancelled or may be submitted again.
export class ReadTimeout extends Error {
  constructor() {
    super('Read timed out');
    this.name = 'ReadTimeout';
  }
}

export function readWithDeadline(run, options = {}) {
  const controller = new AbortController();
  const outer = options.signal;
  const timeoutMs = options.timeoutMs ?? 10000;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outer?.removeEventListener('abort', cancel);
      if (error) reject(error); else resolve(value);
    };
    const cancel = () => {
      controller.abort();
      finish(new DOMException('Read cancelled', 'AbortError'));
    };
    if (outer?.aborted) { cancel(); return; }
    outer?.addEventListener('abort', cancel, { once: true });
    timer = setTimeout(() => {
      controller.abort();
      finish(new ReadTimeout());
    }, timeoutMs);
    // Capture the requesting identity and view before either can change.
    let pending;
    try { pending = run(controller.signal); }
    catch (error) { finish(error); return; }
    Promise.resolve(pending).then(value => finish(null, value), error => finish(error));
  });
}
