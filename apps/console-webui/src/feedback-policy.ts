/** Administration presentation facts. Request locks stay with their feature owner. */
export interface FeedbackOwner {
  readonly identity: string;
  readonly object: string;
  readonly task: string;
  readonly generation: number;
}
export interface ResultFeedback extends FeedbackOwner {
  readonly key: string;
  readonly tone: 'success' | 'error' | 'unknown' | 'warning';
  readonly message: () => string;
  readonly recovery?: { readonly label: () => string; readonly run: () => void };
}
export type NoticeSink = (notice: ResultFeedback) => void;

/** Only explicit results notify; background observations and pending never do. */
export function resultNotice(
  owner: FeedbackOwner,
  result: {
    readonly phase: string;
    readonly pending?: boolean;
    readonly background?: boolean;
    readonly error?: boolean;
    readonly unknown?: boolean;
    readonly warning?: boolean;
    readonly message: () => string;
    readonly recovery?: ResultFeedback['recovery'];
  },
): ResultFeedback | undefined {
  if (result.pending || result.background) return;
  return {
    ...owner,
    key: `${owner.identity}:${owner.object}:${owner.task}:${owner.generation}:${result.phase}`,
    tone: result.unknown ? 'unknown' : result.error ? 'error' : result.warning ? 'warning' : 'success',
    message: result.message,
    ...(result.recovery ? { recovery: result.recovery } : {}),
  };
}

/** A notification cannot decide that a read resolved a write or release its lock. */
export function requiresOwnedRecovery(result: {
  readonly unknown?: boolean;
  readonly error?: boolean;
  readonly refreshFailed?: boolean;
  readonly restorableDetached?: boolean;
}): boolean {
  return !!(result.unknown || result.refreshFailed || (result.error && !result.restorableDetached));
}

/** A retry is another observation of the same view, not a new notice owner. */
export function readFailureNotice(
  owner: Omit<FeedbackOwner, 'task'>,
  code: string,
  message: () => string,
  recovery: ResultFeedback['recovery'],
): ResultFeedback {
  return resultNotice({ ...owner, task: 'read' }, {
    phase: `failed:${code}`,
    error: true,
    message,
    recovery,
  })!;
}
