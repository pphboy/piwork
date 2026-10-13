export interface FilePathResult {
  readonly path: string;
  readonly status: 'succeeded' | 'failed' | 'unknown';
  readonly message: string;
  readonly httpStatus?: number;
  readonly modified?: string;
  readonly needsConsent?: boolean;
  readonly notSubmitted?: boolean;
}

export interface FileMutationTarget {
  readonly source: string;
  readonly destination?: string;
}

/** These are decoded workspace paths, never URLs. Do not URI-decode literal file names here. */
export function normalizeWorkspacePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(path))
    throw new Error('Expected a path inside this Work.');
  const parts = path.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) throw new Error('Workspace paths cannot traverse directories.');
  return '/' + parts.join('/');
}

export function fileParentDirectory(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized.slice(0, normalized.lastIndexOf('/')) || '/';
}

function targetSnapshot(target: FileMutationTarget): FileMutationTarget {
  const source = normalizeWorkspacePath(target.source);
  const destination = target.destination === undefined ? undefined : normalizeWorkspacePath(target.destination);
  if (source === '/' || destination === '/') throw new Error('The workspace root cannot be a mutation target.');
  return Object.freeze({ source, ...(destination === undefined ? {} : { destination }) });
}

function targetKey(target: FileMutationTarget): string { return JSON.stringify([target.source, target.destination ?? null]); }
function under(path: string, root: string): boolean { return path === root || path.startsWith(root + '/'); }
function overlap(a: string, b: string): boolean { return a === '/' || b === '/' || under(a, b) || under(b, a); }
function targetPaths(target: FileMutationTarget): string[] { return [...new Set([target.source, ...(target.destination ? [target.destination] : [])])]; }
function resultBelongs(result: FilePathResult, target: FileMutationTarget): boolean {
  try { const path = normalizeWorkspacePath(result.path); return targetPaths(target).some(root => under(path, root)); }
  catch { return false; }
}

export interface FileMutationAttempt {
  readonly id: number;
  readonly targets: readonly FileMutationTarget[];
  readonly results: readonly FilePathResult[];
}

/** Keeps an attempt's results after the modal closes; a retry is always an explicit subset. */
export class FileMutationResults {
  readonly targets: readonly FileMutationTarget[];
  private history: FileMutationAttempt[] = [];
  private latest = new Map<string, readonly FilePathResult[]>();
  constructor(targets: readonly FileMutationTarget[]) {
    this.targets = Object.freeze(targets.map(targetSnapshot));
    if (new Set(this.targets.map(targetKey)).size !== this.targets.length) throw new Error('Duplicate file mutation target.');
  }

  get attempts(): readonly FileMutationAttempt[] { return Object.freeze([...this.history]); }
  get hasResults(): boolean { return this.history.length > 0; }
  get results(): readonly FilePathResult[] {
    return Object.freeze([...new Set(this.targets.flatMap(target => [...(this.latest.get(targetKey(target)) ?? [])]))]);
  }

  /** Record business results before discarding a stale view. Targets are the exact submitted subset. */
  record(targets: readonly FileMutationTarget[], results: readonly FilePathResult[]): FileMutationAttempt {
    const submitted = targets.map(targetSnapshot);
    if (!submitted.length || submitted.some(target => !this.targets.some(original => targetKey(original) === targetKey(target))))
      throw new Error('Results must belong to this attempt’s original file targets.');
    const copied = Object.freeze(results.map(result => Object.freeze({ ...result })));
    const attempt = Object.freeze({ id: this.history.length + 1, targets: Object.freeze(submitted), results: copied });
    for (const target of submitted) {
      const own = copied.filter(result => resultBelongs(result, target));
      const unassociated = copied.filter(result => !submitted.some(candidate => resultBelongs(result, candidate)));
      const ambiguous = own.some(result => submitted.filter(candidate => resultBelongs(result, candidate)).length !== 1);
      // Missing, malformed or ambiguous rows cannot turn an uncertain write into a safe retry.
      const unknown: FilePathResult = Object.freeze({ path: target.source, status: 'unknown',
        message: 'The complete result for this original target is unknown. Reread its source and destination before a new action.' });
      this.latest.set(targetKey(target), Object.freeze([...own, ...unassociated, ...(!own.length || unassociated.length || ambiguous ? [unknown] : [])]));
    }
    this.history.push(attempt);
    return attempt;
  }

  retryTargets(selectedSources: readonly string[]): FileMutationTarget[] {
    const selected = new Set(selectedSources.map(normalizeWorkspacePath));
    return this.targets.filter(target => {
      if (!selected.has(target.source)) return false;
      const own = this.latest.get(targetKey(target));
      // A recursive parent with child results may already have changed unlisted children.
      // It must never be replayed as a whole merely because its failed child was selected.
      if (!own?.length || own.some(result => result.status !== 'failed')) return false;
      if (own.some(result => {
        try { return !targetPaths(target).includes(normalizeWorkspacePath(result.path)); } catch { return true; }
      })) return false;
      return !this.results.some(result => result.status !== 'failed' && targetPaths(target).some(path => {
        try { return overlap(normalizeWorkspacePath(result.path), path); } catch { return true; }
      }));
    });
  }
}

export interface FileActionIdentity { readonly key: string; readonly token: number; readonly generation: number }
export interface UnknownFileLock extends FileMutationTarget {
  readonly id: string;
  readonly generation: number;
  readonly work: string;
  readonly paths: readonly string[];
  readonly directories: readonly string[];
  readonly action?: FileActionIdentity;
}
export interface FileReviewSnapshot {
  readonly identity: number;
  readonly work: string;
  readonly locks: readonly UnknownFileLock[];
  readonly directories: readonly string[];
}
export interface FileReviewCompletion {
  readonly released: readonly UnknownFileLock[];
  /** Only these exact action records have no associated unknown lock left. */
  readonly actions: readonly FileActionIdentity[];
}

function sameAction(a: FileActionIdentity | undefined, b: FileActionIdentity): boolean {
  return !!a && a.key === b.key && a.token === b.token && a.generation === b.generation;
}

/** Unknown results outlive view changes. This is an in-memory safety guard, not a permission grant. */
export class UnknownFileLocks {
  private locks = new Map<string, UnknownFileLock>();
  private sequence = 0;
  private identity = 0;

  add(work: string, target: FileMutationTarget, action?: FileActionIdentity): UnknownFileLock {
    const normalized = targetSnapshot(target);
    const id = JSON.stringify([work, normalized.source, normalized.destination ?? null]);
    const paths = Object.freeze(targetPaths(normalized));
    const lock: UnknownFileLock = Object.freeze({ ...normalized, id, work, generation: ++this.sequence, paths,
      directories: Object.freeze([...new Set(paths.map(fileParentDirectory))]),
      ...(action ? { action: Object.freeze({ key: action.key, token: action.token, generation: action.generation }) } : {}) });
    this.locks.set(id, lock);
    return lock;
  }

  conflict(work: string, targets: readonly FileMutationTarget[]): UnknownFileLock | undefined {
    const paths = targets.flatMap(target => targetPaths(targetSnapshot(target)));
    return [...this.locks.values()].find(lock => lock.work === work && lock.paths.some(path => paths.some(candidate => overlap(path, candidate))));
  }

  reviewSnapshot(work: string): FileReviewSnapshot {
    const locks = Object.freeze([...this.locks.values()].filter(lock => lock.work === work));
    return Object.freeze({ identity: this.identity, work, locks,
      directories: Object.freeze([...new Set(locks.flatMap(lock => [...lock.directories]))]) });
  }

  /** Pass only directories successfully reread after this snapshot, under the same identity. */
  completeReview(snapshot: FileReviewSnapshot, successfullyReadDirectories: readonly string[]): FileReviewCompletion {
    if (snapshot.identity !== this.identity) return { released: [], actions: [] };
    const read = new Set(successfullyReadDirectories.map(normalizeWorkspacePath));
    const released: UnknownFileLock[] = [];
    for (const original of snapshot.locks) {
      const current = this.locks.get(original.id);
      if (current !== original || current.work !== snapshot.work || current.generation !== original.generation || !current.directories.every(directory => read.has(directory))) continue;
      this.locks.delete(current.id); released.push(current);
    }
    const actions: FileActionIdentity[] = [];
    for (const lock of released) if (lock.action && !actions.some(action => sameAction(action, lock.action!))
      && ![...this.locks.values()].some(current => sameAction(current.action, lock.action!))) actions.push(lock.action);
    return { released, actions };
  }

  clear(): void { this.identity++; this.locks.clear(); }
}
