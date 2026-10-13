/** Page-local preferences. The owner clears the store at identity boundaries. */
export interface WorkspacePanels { ratio: number; collapsed: boolean; narrowChat: boolean }
export class WorkspacePanelsStore {
  private values = new Map<string, WorkspacePanels>();
  get(workId: string): WorkspacePanels {
    let value = this.values.get(workId);
    if (!value) { value = { ratio: .7, collapsed: false, narrowChat: false }; this.values.set(workId, value); }
    return value;
  }
  clear() { this.values.clear(); }
}
export const SPLIT_GUTTER = 8;
export function splitGeometry(width: number, ratio: number) {
  const available = Math.max(0, width - SPLIT_GUTTER), minimum = 400, maximum = available - 320;
  const narrow = width < 900 || maximum < minimum;
  const service = narrow ? available : Math.max(minimum, Math.min(maximum, available * (Number.isFinite(ratio) ? ratio : .7)));
  return { narrow, available, minimum, maximum, service, ratio: available ? service / available : .7 };
}
export function keyboardSplit(key: string, shift: boolean, width: number, ratio: number): number | undefined {
  const geometry = splitGeometry(width, ratio);
  if (geometry.narrow) return;
  const step = shift ? 64 : 16;
  const pixels = key === 'ArrowLeft' ? geometry.service - step : key === 'ArrowRight' ? geometry.service + step
    : key === 'Home' ? geometry.minimum : key === 'End' ? geometry.maximum : key === 'Enter' ? geometry.available * .7 : undefined;
  if (pixels === undefined) return;
  return splitGeometry(width, pixels / geometry.available).ratio;
}
/** Place an execution once, at the final real message/activity belonging to it. */
export function executionAnchors(groups: Array<{ messages: Array<{ runId?: string }> }>): Map<number, string[]> {
  const last = new Map<string, number>();
  groups.forEach((group, index) => group.messages.forEach(message => { if (message.runId) last.set(message.runId, index); }));
  const result = new Map<number, string[]>();
  for (const [runId, index] of last) result.set(index, [...(result.get(index) || []), runId]);
  return result;
}
