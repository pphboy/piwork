interface DialogRecoveryFacts {
  readonly identity: number;
  readonly view: string;
  readonly current: boolean;
  readonly failed: boolean;
  readonly otherDialog: boolean;
}
/** Admission only: the feature supplies safe context and owns restoration, never a saved request. */
export function createKnownDialogRecovery(
  original: { readonly identity: number; readonly view: string },
  read: () => DialogRecoveryFacts,
  restore: () => void,
  focusCurrent: () => void,
): () => void {
  const identity = original.identity, view = original.view;
  return () => {
    const current = read();
    if (!current.current || !current.failed || current.identity !== identity || current.view !== view) return;
    if (current.otherDialog) { focusCurrent();
    return; }
    restore();
  };
}
/** Retention allowlist, not package admission validation. URLs, credentials and arbitrary specs are omitted. */
export function safePackageRecoverySource(kind: string, source: string): string {
  return kind === 'npm' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(source)
    ? source : '';
}
