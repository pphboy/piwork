import { ConsoleError } from './adapter.js';
import { LocalizedMessage } from './locale.js';
import type { ActionRecord } from './action-state.js';
import type { FeedbackOwner } from './feedback-policy.js';

export interface LoginFailurePresentation {
  readonly record: Readonly<ActionRecord>;
  readonly account: string;
  readonly notice: FeedbackOwner;
}
interface LoginFeedbackOwners {
  readonly current: (record: Readonly<ActionRecord>) => boolean;
  readonly retire: (record: Readonly<ActionRecord>) => void;
  readonly resolve: (owner: FeedbackOwner) => void;
}
/** A successful session read resolves presentation, not a credential write or another task's lock. */
export function retireConfirmedLoginFailure(
  original: LoginFailurePresentation,
  receipt: { readonly authenticated: boolean; readonly account: string },
  owners: LoginFeedbackOwners,
): boolean {
  const record = original.record;
  if (record.kind !== 'identity' || record.key !== 'login'
    || !['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(record.errorCode || '')
    || !owners.current(record)) return false;
  if (receipt.authenticated && receipt.account !== original.account) return false;
  owners.retire(record);
  owners.resolve(original.notice);
  return true;
}

/** Preserve uncertain transport outcomes; only known failures use the existing failed copy. */
export function signOutFailure(error: unknown): ConsoleError {
  if (error instanceof ConsoleError && ['RESULT_UNKNOWN', 'INVALID_RESPONSE'].includes(error.code)) return error;
  return new ConsoleError('SIGNOUT_FAILED', new LocalizedMessage('login.signOutFailed'));
}

/** Supersede only this feature's signed-out guidance after a confirmed new session. */
export function retireLoginReadbackInfo(
  owner: FeedbackOwner | null,
  receipt: { readonly authenticated: boolean; readonly account: string },
  resolve: (owner: FeedbackOwner) => void,
): boolean {
  if (!owner || !receipt.authenticated || !receipt.account) return false;
  resolve(owner);
  return true;
}

/** A newer successful sign-in supersedes the same account's earlier admission failure. */
export function retirePreviousLoginFailure(
  original: LoginFailurePresentation | null,
  receipt: { readonly authenticated: boolean; readonly account: string; readonly identity: string },
  resolve: (owner: FeedbackOwner) => void,
): boolean {
  if (!original || original.record.kind !== 'identity' || original.record.key !== 'login'
    || !receipt.authenticated || receipt.account !== original.account
    || receipt.identity !== original.notice.identity) return false;
  resolve(original.notice);
  return true;
}
