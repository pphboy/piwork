/** Browser view models mapped from the existing Go Desktop API. */
export type WorkStatus =
  | "Ready"
  | "Stopped"
  | "Degraded"
  | "Starting"
  | "Stopping"
  | "Failed"
  | "Unknown";
export type ServiceStatus =
  | "Ready"
  | "Stopped"
  | "Failed"
  | "Starting"
  | "Removed";
export type RunStatus =
  | "accepted"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface Service {
  id: string;
  name: string;
  domain: string;
  ports: number[];
  enabled: boolean;
  observed: ServiceStatus;
  error?: string;
  operationId?: string;
}
export interface WorkspaceFile {
  path: string;
  name: string;
  kind: "directory" | "file" | "text" | "binary" | "special";
  size: number;
  modified: string;
  content?: string;
}
export interface Message {
  role: "user" | "assistant";
  text: string;
  source?: string;
  tool?: { name: string; status: string; content: string };
}
export interface Session {
  id: string;
  title: string;
  messages: Message[];
  legacy?: boolean;
}
export interface Run {
  id: string;
  sessionId: string;
  status: RunStatus;
  cursor: number;
  historyRecovery?: boolean;
  created: string;
  error?: string;
}
export interface Configuration {
  skills: string[];
  packages: { name: string; enabled: boolean; source: string }[];
  agents: string;
  advanced: string;
  advancedDirty?: boolean;
  validationError?: string;
  revision: number;
  activeRevision: number;
  active?: Record<string, any> | null;
  pendingApply?: boolean;
  runtime?: Record<string, any>;
  loaded: boolean;
  modelVisible: boolean;
}
export interface Work {
  id: string;
  network: string;
  name: string;
  description: string;
  status: WorkStatus;
  desired: "running" | "stopped";
  updated: string;
  color: string;
  icon: string;
  error?: string;
  operationId?: string;
  services: Service[];
  files: WorkspaceFile[];
  sessions: Session[];
  run?: Run;
  config: Configuration;
  packageEntries?: Record<string, any>[];
  resourceErrors?: Record<string, string>;
}
export interface Operation {
  id: string;
  workId: string;
  kind: string;
  state:
    | "accepted"
    | "preparing"
    | "running"
    | "succeeded"
    | "failed"
    | "unknown"
    | "superseded";
  phase: string;
  created: string;
  updated: string;
  error?: string;
  snapshotId?: string;
  scope: string;
}
export interface Snapshot {
  id: string;
  workId: string;
  operationId: string;
  status: "preparing" | "validating" | "verified" | "expired" | "failed";
  filename: string;
  size: string;
}

export type Scenario = string;
