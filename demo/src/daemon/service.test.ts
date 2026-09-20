import assert from "node:assert/strict";
import { status, type ServiceError } from "@grpc/grpc-js";
import { describe, it } from "node:test";
import { createDaemonClient, askStream } from "../cli/client.js";
import { createLogger } from "../common/logger.js";
import type { AskEvent } from "../generated/piwork.js";
import {
  BackendError,
  type AgentBackend,
  type AskEventSink,
  type AskInput,
  type AskOutcome,
  type BackendHealth,
} from "./agent-backend.js";
import { sessionStartedEvent, textDeltaEvent } from "./event-mapper.js";
import { startServer } from "./server.js";
import { createPiDaemonService } from "./service.js";

const HEALTH: BackendHealth = {
  model: "test-model",
  provider: "test",
  authenticated: true,
  authSource: "test",
  baseUrl: "https://example.invalid",
  sessionCount: 0,
  agentDir: "/tmp/agent",
};

const SILENT = createLogger("error", { write: () => true } as unknown as NodeJS.WritableStream);

function backendWith(ask: AgentBackend["ask"]): AgentBackend {
  return {
    ask,
    health: async () => HEALTH,
    dispose: async () => {},
  };
}

/** Boots a real server on an ephemeral port so the gRPC semantics are exercised for real. */
async function withServer(backend: AgentBackend, run: (client: ReturnType<typeof createDaemonClient>) => Promise<void>): Promise<void> {
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    implementation: createPiDaemonService({ backend, version: "test", startedAt: Date.now(), log: SILENT }),
    log: SILENT,
  });
  const client = createDaemonClient(`127.0.0.1:${server.port}`);
  try {
    await run(client);
  } finally {
    client.close();
    await server.shutdown();
  }
}

async function collect(
  client: ReturnType<typeof createDaemonClient>,
  prompt: string,
): Promise<{ events: AskEvent[]; error: ServiceError | undefined }> {
  const events: AskEvent[] = [];
  try {
    for await (const event of askStream(client, { sessionId: "", prompt, cwd: "" }, new AbortController().signal)) {
      events.push(event);
    }
    return { events, error: undefined };
  } catch (error) {
    return { events, error: error as ServiceError };
  }
}

/** Mirrors PiBackend: the backend emits progress, the service appends the result. */
function successfulAsk(text: string): AgentBackend["ask"] {
  return async (input: AskInput, sink: AskEventSink): Promise<AskOutcome> => {
    sink(sessionStartedEvent({ sessionId: "s1", model: "test-model", cwd: input.cwd ?? "/tmp", resumed: false }));
    for (const chunk of text.split(" ")) {
      sink(textDeltaEvent(`${chunk} `));
    }
    return { text, turns: 1, aborted: false, durationMs: 1 };
  };
}

describe("PiDaemon Ask", () => {
  it("streams session start, deltas and a result on success", async () => {
    await withServer(backendWith(successfulAsk("hello world")), async (client) => {
      const { events, error } = await collect(client, "hi");

      assert.equal(error, undefined);
      assert.equal(events[0]?.sessionStarted?.sessionId, "s1");
      assert.equal(
        events
          .map((event) => event.textDelta?.delta ?? "")
          .join(""),
        "hello world ",
      );
      assert.equal(events.at(-1)?.result?.text, "hello world");
      assert.equal(events.at(-1)?.result?.turns, 1);
    });
  });

  it("reports a pre-acceptance failure as a gRPC status, not an in-band event", async () => {
    // Regression: this used to hang forever because the service failed the call
    // with call.destroy(), which never lets grpc-js send the status.
    const backend = backendWith(async () => {
      throw new BackendError("NO_CREDENTIALS", "no credentials configured");
    });

    await withServer(backend, async (client) => {
      const { events, error } = await collect(client, "hi");

      assert.equal(events.length, 0);
      assert.equal(error?.code, status.UNAUTHENTICATED);
      assert.match(error?.details ?? "", /no credentials configured/);
    });
  });

  it("maps a busy session to FAILED_PRECONDITION", async () => {
    const backend = backendWith(async () => {
      throw new BackendError("SESSION_BUSY", "still answering");
    });

    await withServer(backend, async (client) => {
      const { error } = await collect(client, "hi");
      assert.equal(error?.code, status.FAILED_PRECONDITION);
    });
  });

  it("rejects an empty prompt before reaching the backend", async () => {
    let called = false;
    const backend = backendWith(async () => {
      called = true;
      throw new Error("should not be called");
    });

    await withServer(backend, async (client) => {
      const { error } = await collect(client, "   ");
      assert.equal(error?.code, status.INVALID_ARGUMENT);
      assert.equal(called, false);
    });
  });

  it("delivers a post-acceptance failure in-band, because the status is already committed", async () => {
    const backend = backendWith(async (_input, sink) => {
      sink(sessionStartedEvent({ sessionId: "s1", model: "test-model", cwd: "/tmp", resumed: false }));
      sink(textDeltaEvent("partial answer"));
      throw new BackendError("INTERNAL", "model exploded");
    });

    await withServer(backend, async (client) => {
      const { events, error } = await collect(client, "hi");

      assert.equal(error, undefined, "the stream must end normally once deltas were sent");
      assert.equal(events[0]?.sessionStarted?.sessionId, "s1");
      assert.equal(events[1]?.textDelta?.delta, "partial answer");
      assert.equal(events.at(-1)?.error?.code, "INTERNAL");
      assert.match(events.at(-1)?.error?.message ?? "", /model exploded/);
    });
  });
});

describe("PiDaemon Health", () => {
  it("reports the backend's runtime facts", async () => {
    await withServer(backendWith(successfulAsk("unused")), async (client) => {
      const health = await new Promise<import("../generated/piwork.js").HealthResponse>((resolveHealth, rejectHealth) => {
        client.health({}, (error, response) => (error !== null ? rejectHealth(error) : resolveHealth(response)));
      });

      assert.equal(health.status, "ok");
      assert.equal(health.authenticated, true);
      assert.equal(health.model, "test-model");
      assert.equal(health.authSource, "test");
      assert.equal(health.baseUrl, "https://example.invalid");
    });
  });
});
