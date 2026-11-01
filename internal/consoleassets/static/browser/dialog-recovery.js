/** Admission only: the feature supplies safe context and owns restoration, never a saved request. */
export function createKnownDialogRecovery(original, read, restore, focusCurrent) {
    const identity = original.identity, view = original.view;
    return () => {
        const current = read();
        if (!current.current || !current.failed || current.identity !== identity || current.view !== view)
            return;
        if (current.otherDialog) {
            focusCurrent();
            return;
        }
        restore();
    };
}
/** Retention allowlist, not package admission validation. URLs, credentials and arbitrary specs are omitted. */
export function safePackageRecoverySource(kind, source) {
    return kind === 'npm' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*@(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(source)
        ? source : '';
}
//# sourceMappingURL=dialog-recovery.js.map