/** Readiness is observed business state, never elapsed time or a saved configuration. */
export const preparationComponents = ['docker', 'agent', 'packageHelper', 'defaultContext', 'fileHelper', 'snapshotHelper'] as const;
export interface PreparationSnapshot {
  status?: { ready?: boolean };
  preparation?: {
    ready?: boolean;
    components?: Partial<Record<typeof preparationComponents[number], { state?: string }>>;
  };
}
export function preparationIsReady(snapshot: PreparationSnapshot, currentReadFailed: boolean): boolean {
  return !currentReadFailed && snapshot.status?.ready === true && snapshot.preparation?.ready === true &&
    preparationComponents.every(name => snapshot.preparation?.components?.[name]?.state === 'ready');
}
