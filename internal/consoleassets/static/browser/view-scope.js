/** Capture the original owner. The caller alone chooses whether to apply a result. */
export function captureViewGuard(read, options = {}) {
    const original = { ...read() };
    return () => {
        const current = read();
        return original.path === current.path
            && original.load === current.load
            && (options.includeDialog === false || original.dialog === current.dialog)
            && (options.allowIdentityChange === true || original.identity === current.identity);
    };
}
//# sourceMappingURL=view-scope.js.map