import type { User } from './models.js';
export interface UserRecoveryDraft {
  readonly account: string;
  readonly role: User['role'];
}
interface RecoveryFacts {
  readonly identity: number;
  readonly view: string;
  readonly current: boolean;
  readonly otherDialog: boolean;
}
/** Only safe fields survive a dismissed failed form; no credential or request is retained. */
export function createUserRecovery(
  draft: UserRecoveryDraft,
  original: { readonly identity: number; readonly view: string },
  read: () => RecoveryFacts,
  reopen: (draft: UserRecoveryDraft) => void,
  focusCurrentDialog: () => void,
): () => void {
  const safe = Object.freeze({ account: draft.account, role: draft.role });
  const identity = original.identity, view = original.view;
  return () => {
    const current = read();
    if (!current.current || current.identity !== identity || current.view !== view) return;
    if (current.otherDialog) {
      focusCurrentDialog();
      return;
    }
    reopen(safe);
  };
}
