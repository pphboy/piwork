/** View requests travel inside an ordinary public tool-result preview. */
export const SERVICE_VIEW_TOOLS = ["service_select", "service_refresh"] as const;
export type ServiceViewTool = typeof SERVICE_VIEW_TOOLS[number];
export type ServiceViewAction = "select" | "refresh";
export interface ServiceViewTarget { serviceId: string; port?: number }
export interface ServiceViewRequest extends ServiceViewTarget {
  kind: "piwork.service-view";
  version: 1;
  status: "requested";
  action: ServiceViewAction;
}

export function isServiceViewTarget(value: unknown): value is ServiceViewTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const target = value as Record<string, unknown>;
  return Object.keys(target).every(key => key === "serviceId" || key === "port")
    && typeof target.serviceId === "string" && /^service-[A-Za-z0-9-]{1,120}$/.test(target.serviceId)
    && (target.port === undefined || typeof target.port === "number" && Number.isInteger(target.port) && target.port >= 1 && target.port <= 65535);
}

export function serviceViewRequest(action: ServiceViewAction, target: unknown): ServiceViewRequest {
  if (action !== "select" && action !== "refresh") throw new Error("Invalid Service view action.");
  if (!isServiceViewTarget(target)) throw new Error("Invalid Service view target.");
  return { kind: "piwork.service-view", version: 1, status: "requested", action,
    serviceId: target.serviceId, ...(target.port === undefined ? {} : { port: target.port }) };
}

export function isServiceViewRequest(value: unknown): value is ServiceViewRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const request = value as Record<string, unknown>;
  const { kind, version, status, action, ...target } = request;
  return kind === "piwork.service-view" && version === 1 && status === "requested"
    && (action === "select" || action === "refresh") && isServiceViewTarget(target);
}
