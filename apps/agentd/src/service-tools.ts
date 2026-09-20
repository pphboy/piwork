import { Type } from "typebox";
import { defineTool } from "@earendil-works/pi-coding-agent";
import type { ServiceDefinitionInput } from "@piwork/contracts";

/** The only capability an agent receives for service mutations. */
export interface ServiceResourceClient {
  create(workId: string, identity: RuntimeServiceIdentity, definition: ServiceDefinitionInput, idempotencyKey: string): Promise<unknown>;
  list(workId: string, identity: RuntimeServiceIdentity): Promise<unknown>;
  update(workId: string, identity: RuntimeServiceIdentity, serviceId: string, expectedRevision: number, definition: ServiceDefinitionInput, idempotencyKey: string): Promise<unknown>;
  action(workId: string, identity: RuntimeServiceIdentity, serviceId: string, action: "restart" | "enable" | "disable" | "remove", idempotencyKey: string): Promise<unknown>;
}

export interface RuntimeServiceIdentity {
  readonly workId: string;
  readonly generation: number;
  readonly instanceId: string;
}

export function createServiceTools(client: ServiceResourceClient, identity: RuntimeServiceIdentity) {
  const common = { workId: Type.String({ minLength: 1 }), idempotencyKey: Type.String({ minLength: 1 }) };
  const definition = Type.Record(Type.String(), Type.Unknown());
  const call = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], details: {} });
  return [
    defineTool({ name: "service_create", label: "Create service", description: "Declare a Work-scoped container service.", parameters: Type.Object({ ...common, definition }), execute: async (_id, p) => call(await client.create(p.workId, identityFor(identity, p.workId), p.definition as ServiceDefinitionInput, p.idempotencyKey)) }),
    defineTool({ name: "service_list", label: "List services", description: "List services visible to this Work.", parameters: Type.Object({ workId: common.workId }), execute: async (_id, p) => call(await client.list(p.workId, identityFor(identity, p.workId))) }),
    defineTool({ name: "service_update", label: "Update service", description: "Create a new immutable service definition revision.", parameters: Type.Object({ ...common, serviceId: Type.String(), expectedRevision: Type.Integer({ minimum: 1 }), definition }), execute: async (_id, p) => call(await client.update(p.workId, identityFor(identity, p.workId), p.serviceId, p.expectedRevision, p.definition as ServiceDefinitionInput, p.idempotencyKey)) }),
    ...(["restart", "enable", "disable", "remove"] as const).map((action) => defineTool({ name: `service_${action}`, label: `${action[0]!.toUpperCase()}${action.slice(1)} service`, description: ` ${action} a Work-scoped service.`, parameters: Type.Object({ ...common, serviceId: Type.String() }), execute: async (_id, p) => call(await client.action(p.workId, identityFor(identity, p.workId), p.serviceId, action, p.idempotencyKey)) })),
  ];
}

function identityFor(identity: RuntimeServiceIdentity, workId: string): RuntimeServiceIdentity {
  if (identity.workId !== workId) throw new Error("service tool Work identity mismatch");
  return identity;
}
