export type CorePhase = 'checking' | 'recovering' | 'ready' | 'unconfigured' | 'failed' | 'unreachable' | 'unconfirmed' | 'paused';
export interface CoreAdmission { phase: CorePhase; blocked: boolean }
/** Aggregate readiness supplies the default gate; a current Work may also admit its workspace. */
export function coreAdmission(status: Record<string, any>, admitted: boolean, held: boolean, checking: boolean, error: string, paused: boolean): CoreAdmission {
  let phase: CorePhase;
  const value = status.readiness?.value;
  if (paused) phase = 'paused';
  else if (error) phase = 'unconfirmed';
  else if (status.health?.available === false) phase = 'unreachable';
  else if (status.health?.available && status.readiness?.available && value?.ready === true) phase = 'ready';
  else if (status.health?.available && status.readiness?.available && value?.state === 'RECOVERING') phase = 'recovering';
  else if (['ADMIN_REQUIRED','RUNTIME_NOT_CONFIGURED'].includes(value?.state)) phase = 'unconfigured';
  else if (value?.state === 'RUNTIME_UNAVAILABLE' || value?.ready === false && status.readiness?.available) phase = 'failed';
  else phase = checking || !status.health ? 'checking' : 'unconfirmed';
  return { phase, blocked: !admitted || held };
}
