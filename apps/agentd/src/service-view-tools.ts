import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { SERVICE_VIEW_TOOLS, serviceViewRequest, type ServiceViewTool } from "@piwork/contracts";
import type { RunExecutionContext } from "./runs.js";

export function serviceViewToolNames(policy: { readonly allowed: readonly string[]; readonly denied: readonly string[] }): ServiceViewTool[] {
  return SERVICE_VIEW_TOOLS.filter(name => (!policy.allowed.length || policy.allowed.includes(name)) && !policy.denied.includes(name));
}

export function serviceViewTools(names: readonly ServiceViewTool[], run?: Pick<RunExecutionContext, "signal">): ToolDefinition[] {
  return names.map(name => defineTool({
    name,
    label: name,
    description: name === "service_select"
      ? "Request selection and display of a Service in the browser page that initiated this Run. Does not refresh an already displayed target. Returns a best-effort request, not browser confirmation."
      : "Request a direct page reload of the specified Service only if it is already displayed in the initiating browser page. May discard unsaved application input. Does not select another Service. Returns a best-effort request, not browser confirmation.",
    parameters: Type.Object({
      serviceId: Type.String({ pattern: "^service-[A-Za-z0-9-]{1,120}$" }),
      port: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
    }, { additionalProperties: false }),
    execute: async (_id, input) => {
      if (!run) throw new Error("Service view tools require an active Run.");
      run.signal.throwIfAborted();
      const request = serviceViewRequest(name === "service_select" ? "select" : "refresh", input);
      return { content: [{ type: "text", text: JSON.stringify(request) }], details: {} };
    },
  }));
}
