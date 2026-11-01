/** Only safe fields survive a dismissed failed form; no credential or request is retained. */
export function createUserRecovery(draft, original, read, reopen, focusCurrentDialog) {
    const safe = Object.freeze({ account: draft.account, role: draft.role });
    const identity = original.identity, view = original.view;
    return () => {
        const current = read();
        if (!current.current || current.identity !== identity || current.view !== view)
            return;
        if (current.otherDialog) {
            focusCurrentDialog();
            return;
        }
        reopen(safe);
    };
}
//# sourceMappingURL=user-recovery.js.map