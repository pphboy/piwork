import type { LocalizedMessage } from './locale.js';
import type { NoticeEvent } from './notices.js';

type FileReadError = string | LocalizedMessage;
type FileReadOwner = Pick<NoticeEvent, 'identity' | 'object' | 'task' | 'generation'>;
interface FileReadTarget {
  readonly active: boolean;
  readonly workId: string;
  readonly path: string;
}
export interface DirectoryReadFeedbackInput extends FileReadTarget {
  readonly kind: 'directory';
  readonly directory?: {
    readonly loading: boolean;
    readonly checkedAt?: string;
    readonly error?: FileReadError;
  };
}
export interface PreviewReadFeedbackInput extends FileReadTarget {
  readonly kind: 'preview';
  readonly status: 'idle' | 'loading' | 'ready' | 'missing' | 'unavailable' | 'error';
  readonly error?: FileReadError;
}
export type FileReadFeedbackInput = DirectoryReadFeedbackInput | PreviewReadFeedbackInput;
export interface FileReadFeedback {
  readonly owner: FileReadOwner;
  readonly workId: string;
  readonly path: string;
  readonly kind: FileReadFeedbackInput['kind'];
  readonly error?: FileReadError;
  readonly event?: NoticeEvent;
  readonly recovered: boolean;
}

/** The actual directory or preview read owns truth; this projection never reads or changes a file. */
export function fileReadFeedback(input: FileReadFeedbackInput, identity: string, recovery: NoticeEvent['recovery']): FileReadFeedback | undefined {
  if (!input.active || !input.workId || !input.path) return;
  const owner = { identity, object: input.workId, task: `files:${input.kind}:${input.path}`, generation: 0 };
  const error = input.kind === 'directory' ? input.directory?.error
    : ['missing', 'unavailable', 'error'].includes(input.status) ? input.error : undefined;
  const recovered = input.kind === 'directory'
    ? !!input.directory?.checkedAt && !input.directory.loading && !error
    : input.status === 'ready';
  return {
    owner, workId: input.workId, path: input.path, kind: input.kind, error, recovered,
    event: error ? {
      ...owner, tone: 'error', key: 'read-error',
      message: () => `${input.path} · ${String(error)}`, recovery,
    } : undefined,
  };
}

/** Coalesce only the exact failed read, never writes or another directory's unknown-write review. */
export interface FileReadAction {
  readonly kind: string;
  readonly work?: string;
  readonly resource?: string;
  readonly action?: string;
  readonly error?: string;
  readonly errorMessage?: () => string;
}
export function fileReadOwnsAction(feedback: FileReadFeedback | undefined, action: FileReadAction): boolean {
  const error = action.errorMessage?.() || action.error;
  if (!feedback?.event || action.kind !== 'read' || action.work !== feedback.workId || action.resource !== feedback.path || !error || String(feedback.error) !== error) return false;
  const actions = feedback.kind === 'directory'
    ? ['tab-Files', 'refresh-files', 'file-path', 'open-file', 'open-source']
    : ['open-file', 'open-source', 'retry-file-preview', 'refresh-files'];
  return actions.includes(action.action || '');
}

/** Remember only records already attributed to an actual file read error, not their requests or locks. */
export class FileReadNoticeOwners {
  private owned = new WeakMap<FileReadAction, FileReadOwner>();
  has(action: FileReadAction): boolean { return this.owned.has(action); }
  get(action: FileReadAction): FileReadOwner | undefined { return this.owned.get(action); }
  owns(feedback: FileReadFeedback | undefined, action: FileReadAction): boolean {
    if (!this.owned.has(action) && fileReadOwnsAction(feedback, action)) this.owned.set(action, Object.freeze({ ...feedback!.owner }));
    return this.owned.has(action);
  }
  recoveredOwner(feedback: FileReadFeedback | undefined, action: FileReadAction): FileReadOwner | undefined {
    const owner = this.owned.get(action);
    if (!owner || action.kind !== 'read' || !feedback?.recovered || feedback.event) return;
    const current = feedback.owner;
    return owner.identity === current.identity && owner.object === current.object && owner.task === current.task && owner.generation === current.generation ? owner : undefined;
  }
}
