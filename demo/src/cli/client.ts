import { credentials, type ServiceError } from "@grpc/grpc-js";
import {
  PiDaemonClient,
  type AskEvent,
  type AskRequest,
  type HealthResponse,
} from "../generated/piwork.js";

export function createDaemonClient(address: string): PiDaemonClient {
  return new PiDaemonClient(address, credentials.createInsecure());
}

export function callHealth(client: PiDaemonClient): Promise<HealthResponse> {
  return new Promise((resolveHealth, rejectHealth) => {
    client.health({}, (error: ServiceError | null, response: HealthResponse) => {
      if (error !== null) {
        rejectHealth(error);
        return;
      }
      resolveHealth(response);
    });
  });
}

/**
 * Adapts the gRPC readable stream to an async iterator so the REPL can consume
 * answers with for-await. Stopping early (abort) cancels the call, which the
 * daemon turns into session.abort().
 */
export async function* askStream(
  client: PiDaemonClient,
  request: AskRequest,
  signal: AbortSignal,
): AsyncGenerator<AskEvent> {
  const call = client.ask(request);
  const pending: AskEvent[] = [];
  let finished = false;
  let failure: Error | undefined;
  let wake: (() => void) | undefined;

  const notify = (): void => {
    const resume = wake;
    wake = undefined;
    resume?.();
  };

  call.on("data", (event: AskEvent) => {
    pending.push(event);
    notify();
  });
  call.on("error", (error: Error) => {
    failure = error;
    finished = true;
    notify();
  });
  call.on("end", () => {
    finished = true;
    notify();
  });

  const onAbort = (): void => {
    call.cancel();
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    for (;;) {
      while (pending.length > 0) {
        const event = pending.shift();
        if (event !== undefined) yield event;
      }
      if (finished) break;
      await new Promise<void>((resolveWait) => {
        wake = resolveWait;
        // Re-check after registering: events can arrive in between.
        if (pending.length > 0 || finished) {
          wake = undefined;
          resolveWait();
        }
      });
    }
    if (failure !== undefined) throw failure;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!finished) call.cancel();
  }
}
