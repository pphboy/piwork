/** Readiness is observed business state, never elapsed time or a saved configuration. */
export const preparationComponents = ['docker', 'agent', 'packageHelper', 'defaultContext', 'fileHelper', 'snapshotHelper'];
export function preparationIsReady(snapshot, currentReadFailed) {
    return !currentReadFailed && snapshot.status?.ready === true && snapshot.preparation?.ready === true &&
        preparationComponents.every(name => snapshot.preparation?.components?.[name]?.state === 'ready');
}
//# sourceMappingURL=setup-readiness.js.map