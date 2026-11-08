/** Browser-only decoding and ephemeral authority for this page's own submissions. */
export interface ServiceViewTarget { serviceId: string; port?: number }
export interface ServiceViewRequest extends ServiceViewTarget {
  kind: 'piwork.service-view'; version: 1; status: 'requested'; action: 'select' | 'refresh';
}
export interface ServiceViewAttempt {
  request: ServiceViewRequest;
  workId: string;
  sessionId: string;
  current(): boolean;
}

export function decodeServiceViewRequest(toolName: string, value: unknown): ServiceViewRequest | undefined {
  const action = toolName === 'service_select' ? 'select' : toolName === 'service_refresh' ? 'refresh' : '';
  if (!action || !value || typeof value !== 'object') return;
  const preview = value as Record<string, unknown>;
  if (preview.kind !== 'text' || preview.isError !== false || preview.truncated !== false || typeof preview.text !== 'string') return;
  if (new TextEncoder().encode(preview.text).length > 1024) return;
  try {
    const request = JSON.parse(preview.text);
    if (!request || typeof request !== 'object' || Array.isArray(request)
      || Object.keys(request).some(key => !['kind', 'version', 'status', 'action', 'serviceId', 'port'].includes(key))
      || request.kind !== 'piwork.service-view' || request.version !== 1 || request.status !== 'requested' || request.action !== action
      || typeof request.serviceId !== 'string' || !/^service-[A-Za-z0-9-]{1,120}$/.test(request.serviceId)
      || request.port !== undefined && (!Number.isInteger(request.port) || request.port < 1 || request.port > 65535)) return;
    return request;
  } catch { return; }
}

export function resolveServiceViewTarget<T extends { id: string; ports: number[]; observed: string }>(
  request: ServiceViewTarget, services: readonly T[], selected: { serviceId: string; port: number },
): { service: T; port: number } | undefined {
  const service = services.find(item => item.id === request.serviceId && item.observed !== 'Removed');
  if (!service?.ports.length) return;
  const port = request.port ?? (selected.serviceId === service.id && service.ports.includes(selected.port) ? selected.port : service.ports[0]);
  return service.ports.includes(port) ? { service, port } : undefined;
}

interface Origin { workId: string; sessionId: string; generation: number }
interface RunOrigin extends Origin { consumed: Set<string> }

export class ServiceViewControls {
  private identity = -1;
  private workId = '';
  private generation = 0;
  private pending = new Map<string, Origin>();
  private runs = new Map<string, RunOrigin>();
  private listeners = new Set<(attempt: ServiceViewAttempt) => void>();

  observePage(identity: number, workId: string) {
    if (identity === this.identity && workId === this.workId) return;
    this.reset();
    this.identity = identity;
    this.workId = workId;
  }

  reset() {
    this.generation++;
    this.pending.clear();
    this.runs.clear();
  }

  subscribe(listener: (attempt: ServiceViewAttempt) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  begin(key: string, workId: string, sessionId: string) {
    if (workId !== this.workId) return;
    this.pending.clear();
    this.pending.set(key, { workId, sessionId, generation: this.generation });
  }

  accept(key: string, workId: string, sessionId: string, runId: string) {
    const origin = this.pending.get(key);
    if (!origin || origin.workId !== workId || origin.sessionId !== sessionId || origin.generation !== this.generation) return;
    this.pending.delete(key);
    this.runs.set(runId, { ...origin, consumed: new Set() });
  }

  finish(runId: string) { this.runs.delete(runId); }

  consume(event: { workId?: string; sessionId?: string; runId?: string; sequence?: unknown; kind?: any }) {
    const origin = this.runs.get(event.runId || '');
    if (!origin || origin.workId !== event.workId || origin.sessionId !== event.sessionId || origin.generation !== this.generation) return;
    if (event.kind?.$case !== 'tool') return;
    const tool = event.kind.tool;
    if (tool?.phase !== 'tool-end' || tool.isError !== false || typeof tool.toolCallId !== 'string'
      || !tool.toolCallId.length || tool.toolCallId.length > 1024 || origin.consumed.has(tool.toolCallId)) return;
    const sequence = Number(event.sequence);
    if (!Number.isSafeInteger(sequence) || sequence < 1) return;
    const request = decodeServiceViewRequest(tool.toolName, tool.result);
    if (!request) return;
    origin.consumed.add(tool.toolCallId);
    const attempt = { request, workId: origin.workId, sessionId: origin.sessionId,
      current: () => origin.generation === this.generation && origin.workId === this.workId };
    for (const listener of this.listeners) listener(attempt);
  }
}
