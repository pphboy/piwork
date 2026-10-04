/** Browser view models mapped from the existing Go Desktop API. */
export type WorkStatus =
  | "Preparing"
  | "Deleted"
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
export interface RunModel { modelRef: string | null; label: string; provider: string; model: string }
export interface Session {
  id: string;
  title: string;
  messages: Message[];
  legacy?: boolean;
  modelPreference?: (RunModel & { availability: "available" | "unavailable" }) | null;
  source?: { kind: "chat" | "service"; requestId?: string; serviceName?: string; phase?: string };
  runs?: Run[];
}
export interface Run {
  actualModel?: RunModel | null;
  source?: Session["source"];
  adoptedExperienceVersion?: number;
  cancellationRequested?: boolean;
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
  resourceLoading?: Record<string, boolean>;
  resourceChecked?: Record<string, string>;
  id: string;
  network: string;
  name: string;
  description: string;
  status: WorkStatus;
  desired: "running" | "stopped" | "deleted";
  observed?: string;
  controlVersion?: number;
  checkedAt?: string;
  statusError?: string;
  lifecycleIntent?: { action: LifecycleAction; operationId: string; sequence: number; baseVersion?: number };
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
  action?: LifecycleAction;
  observationError?: string;
  localRecordSaved?: boolean;
  id: string;
  workId: string;
  checkedWorkId?: string;
  kind: string;
  state:
    | "accepted"
    | "pending"
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

export type LifecycleAction = 'create' | 'start' | 'stop' | 'retry' | 'delete';
export interface Snapshot {
  id: string;
  workId: string;
  operationId: string;
  status: "preparing" | "validating" | "verified" | "expired" | "failed";
  filename: string;
  size: string;
}

export type Scenario = string;
