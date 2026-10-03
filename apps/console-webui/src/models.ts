/** Public Console view models mapped from native administrator DTOs. */
export type User = {
  id: string;
  account: string;
  role: "Administrator" | "User";
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};
export type Skill = {
  name: string;
  enabled: boolean;
  source: string;
  updatedAt: string;
  files: number;
  bytes: number;
};
export type Package = {
  name: string;
  enabled: boolean;
  version: string | null;
  sourceKind: "npm" | "Git" | "Local directory" | "ZIP";
  resolvedSource: string;
  updatedAt: string;
  resources: number | null;
};
export type Runtime = {
  agentImage: string;
  provider: string;
  modelId: string;
  baseUrl: string;
  credentialAvailable: boolean;
  updatedAt: string;
};
export type Defaults = {
  publicConfiguration?: Record<string, unknown>;
  agentImage: string;
  skills: string[];
  packages: string[];
  agentsMd: string;
  networkMode: string;
  workspacePolicy: string;
  updatedAt: string;
};
export type Operation = {
  id: string;
  packageName: string;
  state: "running" | "succeeded" | "failed" | "superseded";
  packagePhase: string;
  createdAt: string;
  updatedAt: string;
  result: string | null;
  diagnostic?: {
    stage: string;
    code: string;
    message: string;
  };
  polls: number;
  sourceKind: Package["sourceKind"];
  source: string;
  addDefault: boolean;
  target?: string;
};
export type Store = {
  users: User[];
  skills: Skill[];
  packages: Package[];
  runtime: Runtime | null;
  defaults: Defaults | null;
  operations: Operation[];
};
