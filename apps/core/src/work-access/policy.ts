export type WorkResourceKind = "work" | "run" | "service" | "operation" | "retained-volume";
export type WorkAction = "read-metadata" | "control" | "cleanup" | "read-content" | "interact";

export interface UserPrincipal {
  readonly userId: string;
  readonly role: "admin" | "user";
}

export interface WorkResource {
  readonly id: string;
  readonly kind: WorkResourceKind;
  readonly workId: string;
  readonly ownerUserId: string;
}

export class InvisibleResourceError extends Error {
  readonly code = "NOT_FOUND";

  constructor() {
    super("resource was not found");
    this.name = "InvisibleResourceError";
  }
}

export class ConversationAccessDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";

  constructor() {
    super("conversation content is available only to the Work owner");
    this.name = "ConversationAccessDeniedError";
  }
}

export function authorizeWorkResource<T extends WorkResource>(
  principal: UserPrincipal,
  resource: T | undefined,
  action: WorkAction,
): T {
  if (resource === undefined) throw new InvisibleResourceError();
  const owns = resource.ownerUserId === principal.userId;
  if (owns) return resource;

  if (principal.role !== "admin") throw new InvisibleResourceError();
  if (action === "read-content" || action === "interact") throw new ConversationAccessDeniedError();
  return resource;
}

export function filterVisibleResources<T extends WorkResource>(
  principal: UserPrincipal,
  resources: readonly T[],
  action: WorkAction,
): T[] {
  if (principal.role === "admin" && action !== "read-content" && action !== "interact") return [...resources];
  return resources.filter((resource) => resource.ownerUserId === principal.userId);
}
