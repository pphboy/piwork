/** Raw Core phases are never replaced by these presentation labels. */
export const packageSteps = ['Accepted', 'Resolving', 'Preparing', 'Validating', 'Publishing', 'Published'];
const phases = ['queued', 'source', 'prepare', 'validate', 'publish', 'succeeded'];
export function packagePhaseView(raw, state) {
    const index = phases.indexOf(raw);
    const terminalError = state === 'failed' || state === 'superseded' || raw === 'failed' || raw === 'superseded';
    return {
        index: terminalError ? -1 : index,
        label: raw === '' ? 'Submission accepted' : raw === 'cleanup-pending' ? 'Cleanup pending' : raw === 'failed' ? 'Operation failed' : raw === 'superseded' ? 'Operation superseded' : index >= 0 ? packageSteps[index] : `Unrecognized phase: ${raw}`,
        cleanupPending: raw === 'cleanup-pending',
    };
}
//# sourceMappingURL=package-phase.js.map