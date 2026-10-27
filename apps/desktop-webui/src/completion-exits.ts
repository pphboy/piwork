import { operationKind } from './operation-recovery.js';

/** A terminal receipt alone is never a usable workspace. */
export function workCompletionReady(operation: { workId: string; state: string } | undefined, workId: string, usable: boolean): boolean {
  return !!operation && operation.workId === workId && operation.state === 'succeeded' && usable;
}
export function serviceCompletionReady(operation: { workId: string; state: string } | undefined, workId: string, usable: boolean,
  service: { enabled: boolean; observed: string; ports: readonly number[] } | undefined, port: number): boolean {
  return workCompletionReady(operation, workId, usable) && !!service && service.enabled && service.observed === 'Ready' && service.ports.includes(port);
}
export function importCanStart(operation: { workId: string; state: string; kind: string } | undefined,
  work: { id: string; status: string; desired: string } | undefined, currentAction: string, submitted: boolean): boolean {
  return !submitted && !!operation && operationKind(operation.kind) === 'transfer:import' && operation.state === 'succeeded' &&
    !!work && operation.workId === work.id && work.status === 'Stopped' && work.desired === 'stopped' && currentAction === 'start';
}
