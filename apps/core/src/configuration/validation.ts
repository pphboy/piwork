import { Check } from "typebox/value";
import { BUILT_IN_WORK_TOOLS, normalizeAgentsMd, parsePiPackageToolPolicyKey, sortPiPackageSelection, validateResourcePolicy, WorkConfigSchema, type McpServer, type WorkConfig } from "@piwork/contracts";
import { CoreStore, type CatalogKind } from "@piwork/core-store";

export type ConfigurationValidationCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REFERENCE"
  | "UNSUPPORTED_LIMIT"
  | "SECRET_OWNERSHIP";

export class ConfigurationValidationError extends Error {
  constructor(
    readonly code: ConfigurationValidationCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ConfigurationValidationError";
  }
}

export interface ConfigurationValidationContext {
  readonly workOwnerUserId: string;
  /** Existing Work scope; never supplied from the configuration document. */
  readonly workId?: string;
  readonly reselectSkills?: boolean;
  readonly configuration: unknown;
  /** Service identities already accepted for this Work, used by required MCP dependencies. */
  readonly availableServiceIds?: ReadonlySet<string>;
}

export class WorkConfigurationValidator {
  constructor(private readonly store: CoreStore) {}

  validate(context: ConfigurationValidationContext): WorkConfig {
    rejectUnsupportedLimits(context.configuration);
    if (!Check(WorkConfigSchema, context.configuration)) {
      throw new ConfigurationValidationError(
        "INVALID_CONFIGURATION",
        "configuration does not match the supported WorkConfig schema",
      );
    }
    const config = context.configuration;
    let packages: WorkConfig["packages"];
    try {
      packages = sortPiPackageSelection(config.packages);
    } catch (error) {
      throw new ConfigurationValidationError("INVALID_CONFIGURATION", error instanceof Error ? error.message : "packages is invalid", "packages");
    }
    try {
      validateResourcePolicy(config.resources);
    } catch (error) {
      throw new ConfigurationValidationError("INVALID_CONFIGURATION", error instanceof Error ? error.message : "resource allocation is invalid", "resources");
    }
    try {
      normalizeAgentsMd(config.agentsMd);
    } catch (error) {
      throw new ConfigurationValidationError("INVALID_CONFIGURATION", error instanceof Error ? error.message : "agentsMd is invalid", "agentsMd");
    }
    const state = context.workId === undefined ? undefined : this.store.getWorkConfiguration(context.workId);
    const ownWork = state?.ownerUserId === context.workOwnerUserId;
    const ownedImage = ownWork ? this.store.snapshots.getOwnedImage(context.workId!, config.agentImage.catalogId) : undefined;
    if (ownedImage === undefined) this.catalog(config.agentImage.catalogId, "agent_image", "agentImage.catalogId");
    const previous = ownWork && state?.desiredContextId !== null ? JSON.parse(state!.desiredConfigJson) as WorkConfig : undefined;
    const retainSkills = !context.reselectSkills && previous !== undefined
      && JSON.stringify(previous.skills) === JSON.stringify(config.skills);
    const skillIds = new Set<string>();
    config.skills.forEach((skillName, index) => {
      if (skillIds.has(skillName)) {
        throw new ConfigurationValidationError("INVALID_CONFIGURATION", `duplicate Skill ${skillName}`, `skills.${index}`);
      }
      skillIds.add(skillName);
      const skill = this.store.getManagedSkill(skillName);
      if (!retainSkills && (skill === undefined || !skill.enabled)) {
        throw new ConfigurationValidationError(
          "INVALID_REFERENCE",
          `Skill ${skillName} is unavailable`,
          `skills.${index}`,
        );
      }
    });
    this.catalog(config.modelRef, "model", "modelRef");

    const serverIds = new Set<string>();
    for (const [index, server] of config.mcpServers.entries()) {
      if (serverIds.has(server.serverId)) {
        throw new ConfigurationValidationError(
          "INVALID_CONFIGURATION",
          `duplicate MCP server_id ${server.serverId}`,
          `mcpServers.${index}.serverId`,
        );
      }
      serverIds.add(server.serverId);
      validateReservedMcpServer(server, index);
      if (server.requiredServiceId !== undefined && context.availableServiceIds !== undefined && !context.availableServiceIds.has(server.requiredServiceId)) {
        throw new ConfigurationValidationError("INVALID_REFERENCE", `required service ${server.requiredServiceId} does not exist`, `mcpServers.${index}.requiredServiceId`);
      }
      validateMcpTransport(server, index);
      for (const [secretIndex, reference] of (server.secretRefs ?? []).entries()) {
        const secret = this.store.getSecretReference(reference.secretId);
        if (secret === undefined) {
          throw new ConfigurationValidationError(
            "INVALID_REFERENCE",
            `secret ${reference.secretId} does not exist`,
            `mcpServers.${index}.secretRefs.${secretIndex}.secretId`,
          );
        }
        if (secret.ownerUserId !== null && secret.ownerUserId !== context.workOwnerUserId) {
          throw new ConfigurationValidationError(
            "SECRET_OWNERSHIP",
            `secret ${reference.secretId} is not owned by the Work owner`,
            `mcpServers.${index}.secretRefs.${secretIndex}.secretId`,
          );
        }
      }
    }
    const mcpToolPrefixes = new Set(config.mcpServers.map((server) => server.serverId));
    const selectedPackageNames = new Set(packages.map((item) => item.name));
    if (context.workId === undefined) for (const [index, selected] of packages.entries()) {
      const entry = this.store.packages.getCatalog(selected.name);
      if (entry === undefined || !entry.enabled) {
        throw new ConfigurationValidationError("INVALID_REFERENCE", `package ${selected.name} is unavailable`, `packages.${index}.name`);
      }
    }
    if (context.workId !== undefined && previous !== undefined) {
      const installed = new Set(previous.packages.map((item) => item.name));
      for (const [index, selected] of packages.entries()) {
        if (!installed.has(selected.name)) {
          throw new ConfigurationValidationError("INVALID_REFERENCE", `package ${selected.name} is not installed in this Work`, `packages.${index}.name`);
        }
      }
    }
    for (const [field, names] of [["tools.allowed", config.tools.allowed], ["tools.denied", config.tools.denied] ] as const) {
      for (const [index, name] of names.entries()) {
        const packageTool = parsePiPackageToolPolicyKey(name);
        const valid = (BUILT_IN_WORK_TOOLS as readonly string[]).includes(name)
          || name.includes(".") && mcpToolPrefixes.has(name.split(".", 1)[0]!)
          || packageTool !== undefined && selectedPackageNames.has(packageTool.packageName);
        if (!valid) throw new ConfigurationValidationError("INVALID_CONFIGURATION", `unsupported tool ${name}`, `${field}.${index}`);
      }
    }
    return { ...config, packages };
  }

  async validateBeforeRuntime<T>(
    context: ConfigurationValidationContext,
    createRuntime: (configuration: WorkConfig) => Promise<T>,
  ): Promise<T> {
    return createRuntime(this.validate(context));
  }

  private catalog(id: string, kind: CatalogKind, field: string): void {
    const entry = this.store.getCatalogEntry(id);
    if (entry === undefined || !entry.enabled || entry.kind !== kind) {
      throw new ConfigurationValidationError(
        "INVALID_REFERENCE",
        `${kind} catalog entry ${id} is unavailable`,
        field,
      );
    }
  }
}

export class ServiceDependencyCycleError extends Error {
  constructor(readonly cycle: readonly string[]) {
    super(`service dependency cycle: ${cycle.join(" -> ")}`);
    this.name = "ServiceDependencyCycleError";
  }
}

/** Topologically order service/MCP startup dependencies and reject cycles. */
export function orderServiceDependencies(nodes: ReadonlyMap<string, readonly string[]>): string[] {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: string[] = [];
  const path: string[] = [];
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      const start = path.indexOf(id);
      throw new ServiceDependencyCycleError([...path.slice(start), id]);
    }
    visiting.add(id); path.push(id);
    for (const dependency of nodes.get(id) ?? []) {
      if (!nodes.has(dependency)) throw new ConfigurationValidationError("INVALID_REFERENCE", `required service ${dependency} does not exist`);
      visit(dependency);
    }
    path.pop(); visiting.delete(id); visited.add(id); ordered.push(id);
  };
  for (const id of nodes.keys()) visit(id);
  return ordered;
}

function rejectUnsupportedLimits(configuration: unknown): void {
  if (configuration === null || typeof configuration !== "object") return;
  const resources = (configuration as { resources?: unknown }).resources;
  if (resources !== null && typeof resources === "object" && "storageBytes" in resources) {
    throw new ConfigurationValidationError(
      "UNSUPPORTED_LIMIT",
      "this runtime cannot enforce a hard storage_bytes limit",
      "resources.storageBytes",
    );
  }
  if (resources !== null && typeof resources === "object" && "storage_bytes" in resources) {
    throw new ConfigurationValidationError(
      "UNSUPPORTED_LIMIT",
      "this runtime cannot enforce a hard storage_bytes limit",
      "resources.storage_bytes",
    );
  }
}

function validateMcpTransport(server: McpServer, index: number): void {
  if (server.transport === "stdio") {
    if (server.command === undefined || server.url !== undefined) {
      throw new ConfigurationValidationError(
        "INVALID_CONFIGURATION",
        `stdio MCP ${server.serverId} requires command and forbids url`,
        `mcpServers.${index}`,
      );
    }
    return;
  }
  if (server.url === undefined || server.command !== undefined || server.args !== undefined) {
    throw new ConfigurationValidationError(
      "INVALID_CONFIGURATION",
      `Streamable HTTP MCP ${server.serverId} requires url and forbids command/args`,
      `mcpServers.${index}`,
    );
  }
  let url: URL;
  try {
    url = new URL(server.url);
  } catch {
    throw new ConfigurationValidationError(
      "INVALID_CONFIGURATION",
      `MCP ${server.serverId} has an invalid URL`,
      `mcpServers.${index}.url`,
    );
  }
  if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new ConfigurationValidationError(
      "INVALID_CONFIGURATION",
      `remote MCP ${server.serverId} must use HTTPS`,
      `mcpServers.${index}.url`,
    );
  }
}

function validateReservedMcpServer(server: McpServer, index: number): void {
  if (server.serverId !== "work-services") return;
  const valid = server.transport === "stdio"
    && server.required
    && server.command === "/usr/local/bin/piwork-service-mcp"
    && (server.args?.length ?? 0) === 0
    && server.url === undefined
    && server.requiredServiceId === undefined
    && (server.secretRefs?.length ?? 0) === 0;
  if (!valid) {
    throw new ConfigurationValidationError(
      "INVALID_CONFIGURATION",
      "work-services is a reserved built-in MCP adapter and cannot be substituted",
      `mcpServers.${index}`,
    );
  }
}
