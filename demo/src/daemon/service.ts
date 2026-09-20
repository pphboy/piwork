import {
  Metadata,
  status,
  type sendUnaryData,
  type ServerWritableStream,
  type ServiceError,
} from "@grpc/grpc-js";
import { errorMessage, type Logger } from "../common/logger.js";
import type { AskEvent, AskRequest, HealthResponse, PiDaemonServer } from "../generated/piwork.js";
import {
  BackendError,
  type AgentBackend,
  type AskEventSink,
  type BackendErrorCode,
} from "./agent-backend.js";
import { errorEvent, resultEvent } from "./event-mapper.js";

const STATUS_BY_CODE: Record<BackendErrorCode, status> = {
  INVALID_ARGUMENT: status.INVALID_ARGUMENT,
  NO_CREDENTIALS: status.UNAUTHENTICATED,
  MODEL_NOT_FOUND: status.FAILED_PRECONDITION,
  SESSION_BUSY: status.FAILED_PRECONDITION,
  INTERNAL: status.INTERNAL,
};

export interface PiDaemonServiceDependencies {
  backend: AgentBackend;
  version: string;
  startedAt: number;
  log: Logger;
}

export function createPiDaemonService(deps: PiDaemonServiceDependencies): PiDaemonServer {
  return {
    health: (_call, callback) => {
      void handleHealth(deps, callback);
    },
    ask: (call) => {
      void handleAsk(deps, call);
    },
  };
}

async function handleHealth(
  deps: PiDaemonServiceDependencies,
  callback: sendUnaryData<HealthResponse>,
): Promise<void> {
  try {
    const health = await deps.backend.health();
    callback(null, {
      status: "ok",
      version: deps.version,
      model: health.model ?? "",
      provider: health.provider,
      authenticated: health.authenticated,
      authSource: health.authSource ?? "",
      baseUrl: health.baseUrl ?? "",
      sessionCount: health.sessionCount,
      uptimeMs: Date.now() - deps.startedAt,
      agentDir: health.agentDir,
    });
  } catch (error) {
    const backendError = asBackendError(error);
    deps.log.error("health failed", { code: backendError.code, error: backendError.message });
    callback(toServiceError(backendError));
  }
}

async function handleAsk(deps: PiDaemonServiceDependencies, call: ServerWritableStream<AskRequest, AskEvent>): Promise<void> {
  const request = call.request;
  const prompt = request.prompt.trim();
  if (prompt === "") {
    failCall(call, new BackendError("INVALID_ARGUMENT", "prompt must not be empty"));
    return;
  }

  const controller = new AbortController();
  call.on("cancelled", () => {
    controller.abort();
  });

  let wroteEvent = false;
  let sessionId = request.sessionId;
  const sink: AskEventSink = (event) => {
    if (call.destroyed || call.writableEnded) return;
    if (event.sessionStarted !== undefined) sessionId = event.sessionStarted.sessionId;
    wroteEvent = true;
    call.write(event);
  };

  deps.log.info("ask started", {
    sessionId: sessionId === "" ? undefined : sessionId,
    promptChars: prompt.length,
  });

  try {
    const outcome = await deps.backend.ask(
      {
        sessionId: request.sessionId === "" ? undefined : request.sessionId,
        prompt,
        cwd: request.cwd === "" ? undefined : request.cwd,
      },
      sink,
      controller.signal,
    );
    sink(
      resultEvent({
        text: outcome.text,
        turns: outcome.turns,
        aborted: outcome.aborted,
        durationMs: outcome.durationMs,
      }),
    );
    deps.log.info("ask finished", {
      sessionId,
      turns: outcome.turns,
      aborted: outcome.aborted,
      durationMs: outcome.durationMs,
    });
    call.end();
  } catch (error) {
    const backendError = asBackendError(error);
    deps.log.error("ask failed", {
      sessionId,
      code: backendError.code,
      error: backendError.message,
      wroteEvents: wroteEvent,
    });
    if (!wroteEvent) {
      // Nothing has been written yet, so the failure can still be a gRPC status.
      failCall(call, backendError);
      return;
    }
    // Deltas are already on the wire and the status is committed to OK, so the
    // failure has to travel in-band.
    sink(errorEvent(backendError.code, backendError.message));
    call.end();
  }
}

function asBackendError(error: unknown): BackendError {
  return error instanceof BackendError
    ? error
    : new BackendError("INTERNAL", errorMessage(error), { cause: error });
}

/**
 * Fails a server-streaming call with a gRPC status.
 *
 * Emitting 'error' is the mechanism grpc-js listens for: ServerWritableStreamImpl
 * registers an 'error' handler in its constructor that records the status and
 * ends the call. call.destroy(error) does not work here, because destroy() marks
 * the stream destroyed before emitting 'error' asynchronously, so the end() that
 * follows is a no-op and the status never reaches the client.
 */
function failCall(call: ServerWritableStream<AskRequest, AskEvent>, error: BackendError): void {
  call.emit("error", toServiceError(error));
}

function toServiceError(error: BackendError): ServiceError {
  return Object.assign(new Error(error.message), {
    code: STATUS_BY_CODE[error.code],
    details: error.message,
    metadata: new Metadata(),
  }) as ServiceError;
}
