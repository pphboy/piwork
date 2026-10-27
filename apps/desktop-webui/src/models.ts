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
  | "Recovering"
  | "Running"
  | "Completed"
  | "Unknown"
  | "Removed";
export type RunStatus =
  | "accepted"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted";
/** The safe subset of the Core Service diagnostic; unknown fields are never copied. */
export interface ServiceDiagnostic {
  code: string;
  stage: string;
  message: string;
  remediation: string;
  retryable?: boolean;
  exitCode?: number;
  correlationId?: string;
  cause?: ServiceDiagnostic;
}
export interface Service {
  id: string;
  name: string;
  domain: string;
  ports: number[];
  enabled: boolean;
  observed: ServiceStatus;
  error?: string;
  /** A correlation id is diagnostic text only: it never implies a navigable Operation. */
  diagnostic?: ServiceDiagnostic;
  temporary?: { mode: 'once' | 'listener'; state: string; exitCode?: number; cleanupState?: string };
}
export interface TemporaryCleanup {
  workId: string; serviceId: string; runId: string; createOperationId: string; operationId?: string;
  state: string; stage: string; trigger: string; errorCode?: string; logState?: string; updatedAt: string; truncated: boolean;
  events: Array<{ at: string; stage: string; outcome: string; code?: string }>;
}
import type { ImageMime } from './image-content.js';
export type WorkspaceFileKind = "directory" | "file" | "special";
/** Confirmed current preview only; a listing or metadata read never proves content. */
export type FilePreview =
  | { kind: "text"; content: string }
  | { kind: "image"; mimeType: ImageMime; url: string; width: number; height: number }
  | { kind: "download-only"; reason: "binary" | "oversized" | "unsupported" | "document" };
export interface WorkspaceFile {
  path: string;
  name: string;
  kind: WorkspaceFileKind;
  size: number;
  modified: string;
  preview?: FilePreview;
}
export interface Message {
  historyStored?: boolean;
  historyIncomplete?: boolean;
  images?: import('./images.js').HistoryImage[];
  id?: string;
  runId?: string;
  role: "user" | "assistant";
  text: string;
  source?: string;
  tool?: { id?: string; name: string; status: string; content: string; isError?: boolean };
}
export interface RunModel { modelRef: string | null; label: string; provider: string; model: string; thinkingLevels?: string[]; defaultThinkingLevel?: string | null; thinkingAvailability?: "unknown" }
export interface Session {
  history?: { loading: boolean; error: string; cursor: string | null; snapshot: string; hasMore: boolean; expired?: boolean };
  imageProfile?: boolean;
  thinkingLevel?: string | null;
  loading?: boolean;
  checkedAt?: string;
  error?: string;
  id: string;
  title: string;
  messages: Message[];
  legacy?: boolean;
  modelPreference?: (RunModel & { availability: "available" | "unavailable" }) | null;
  source?: { kind: "chat" | "service"; requestId?: string; serviceName?: string; phase?: string };
  runs?: Run[];
}
export interface Run {
  resultRef?: {workId:string;sessionId:string;runId:string;content:'result';snapshot?:string;entryId?:string;blockId?:string}|null;
  thinkingLevel?: string | null;
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
  finished?: string;
  finalText?: string;
  error?: string;
  executionError?: string;
  errorCode?: string;
  errorRetryable?: boolean;
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
  /** A trusted Work denial or unavailability is recovered only by a fresh matching Work read. */
  accessRevoked?: boolean;
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
/** Only public, typed fields from a Core Operation diagnostic. */
export interface OperationDiagnostic {
  code?: string;
  stage?: string;
  message?: string;
  remediation?: string;
  retryable?: boolean;
  correlationId?: string;
  serviceId?: string;
  skillName?: string;
  field?: string;
  exitCode?: number;
}
export interface OperationDiagnosticStage {
  timestamp?: string;
  component?: string;
  stage?: string;
  outcome?: string;
  code?: string;
  message?: string;
  serviceId?: string;
  skillName?: string;
}
export interface OperationDiagnostics {
  stages: OperationDiagnosticStage[];
  truncated?: boolean;
  rollback?: { state?: string; error?: OperationDiagnostic };
  diagnosticCollection?: { state?: string; code?: string };
}
export interface Operation {
  importName?: string;
  importSourceName?: string;
  action?: LifecycleAction;
  observationError?: string;
  localRecordSaved?: boolean;
  id: string;
  workId: string;
  checkedWorkId?: string;
  /** Service identity retained from the accepted response or local record. */
  serviceId?: string;
  /** Identity and kind confirmed by a matching original Operation response. */
  checkedServiceId?: string;
  checkedKind?: string;
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
  diagnostic?: OperationDiagnostic;
  diagnostics?: OperationDiagnostics;
  correlationId?: string;
  snapshotId?: string;
  scope: string;
}

export type LifecycleAction = 'create' | 'start' | 'stop' | 'retry' | 'delete';
export interface Snapshot {
  id: string;
  workId: string;
  operationId: string;
  status: "preparing" | "validating" | "verified" | "expired" | "failed" | "unavailable";
  filename: string;
  size: string;
  packageSize?: number | null;
  digest?: string | null;
  expiresAt?: string | null;
  error?: string;
}

export type Scenario = string;
