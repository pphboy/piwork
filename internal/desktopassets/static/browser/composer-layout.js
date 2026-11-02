/** View geometry only; drafts, submissions and admission stay with their owners. */
export function composerEditorGeometry(scrollHeight, viewportHeight, expanded) {
    const maximum = Math.max(150, Math.min(expanded ? 390 : 216, viewportHeight * (expanded ? .46 : .28)));
    const minimum = expanded ? Math.min(180, maximum) : 42;
    return { height: Math.round(Math.max(minimum, Math.min(scrollHeight, maximum))), overflow: scrollHeight > maximum ? 'auto' : 'hidden' };
}
//# sourceMappingURL=composer-layout.js.map