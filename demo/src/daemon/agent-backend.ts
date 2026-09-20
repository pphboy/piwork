import type { AskEvent } from "../generated/piwork.js";

/** Receives events destined for the client, in order. */
export type AskEventSink = (event: AskEvent) => void;

export interface AskInput {
  /** Undefined asks the backend to create a new session. */
  sessionId: string | undefined;
  prompt: string;
  /** Undefined falls back to the daemon's default workspace. */
  cwd: string | undefined;
}

export interface AskOutcome {
  text: string;
  turns: number;
  aborted: boolean;
  durationMs: number;
}

export interface BackendHealth {
  model: string | undefined;
  provider: string;
  authenticated: boolean;
  authSource: string | undefined;
  baseUrl: string | undefined;
  sessionCount: number;
  agentDir: string;
}

export type BackendErrorCode =
  | "INVALID_ARGUMENT"
  | "NO_CREDENTIALS"
  | "MODEL_NOT_FOUND"
  | "SESSION_BUSY"
  | "INTERNAL";

export class BackendError extends Error {
  constructor(
    readonly code: BackendErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "BackendError";
  }
}

/**
 * The agent side of the daemon. One implementation today (pi-backend), but the
 * seam keeps the pi SDK out of the transport layer.
 *
 * Emission contract: ask() emits SessionStarted and progress events (deltas,
 * tool lifecycle) through the sink, and returns the outcome. The service appends
 * the terminal event - AskResult on success, AskError when the failure happens
 * after the first event was already on the wire. Throwing before emitting
 * anything lets the service report a gRPC status instead.
 */
export interface AgentBackend {
  ask(input: AskInput, sink: AskEventSink, signal: AbortSignal): Promise<AskOutcome>;
  health(): Promise<BackendHealth>;
  dispose(): Promise<void>;
}
