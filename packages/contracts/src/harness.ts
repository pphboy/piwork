import { Type } from "typebox";

// Shared wire values consumed by the retained Pi Agent harness. The host
// control-plane DTOs live in Go and are generated from native schemas.
export const BUILT_IN_WORK_TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls"] as const;
export type BuiltInWorkTool = typeof BUILT_IN_WORK_TOOLS[number];

export function resolveBuiltInWorkTools(policy: { readonly allowed: readonly string[]; readonly denied: readonly string[] }): BuiltInWorkTool[] {
  const allowed = new Set(policy.allowed);
  const denied = new Set(policy.denied);
  return BUILT_IN_WORK_TOOLS.filter((name) => (allowed.size === 0 || allowed.has(name)) && !denied.has(name));
}

export interface McpServer {
  readonly serverId: string;
  readonly transport: "stdio" | "streamable-http";
  readonly required: boolean;
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly secretRefs?: readonly { readonly secretId: string; readonly key?: string }[];
  readonly requiredServiceId?: string;
}

export const PiPackageNameSchema = Type.String({
  minLength: 1,
  maxLength: 214,
  pattern: "^(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*$",
});

export const PiPackagePreparedEnvironmentSchema = Type.Object({
  os: Type.Literal("linux"),
  architecture: Type.String({ minLength: 1, maxLength: 64 }),
  variant: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  nodeAbi: Type.String({ minLength: 1, maxLength: 64 }),
  piSdkVersion: Type.String({ minLength: 1, maxLength: 64 }),
}, { additionalProperties: false });

export type PiPackagePreparedEnvironment = Type.Static<typeof PiPackagePreparedEnvironmentSchema>;
export type PiPackageSourceKind = "npm" | "git" | "local" | "zip";
export interface PiPackageSelectionEntry { readonly name: string; readonly enabled: boolean }
export interface PiPackageArtifactMetadata {
  readonly name: string;
  readonly version: string | null;
  readonly sourceKind: PiPackageSourceKind;
  readonly resolvedSource: string;
  readonly preparedEnvironment: PiPackagePreparedEnvironment;
  readonly resourceCounts: Readonly<Record<"extensions" | "skills" | "prompts" | "themes", number>>;
  readonly contentDigest: string;
}
