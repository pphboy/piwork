import type { AskEvent } from "../generated/piwork.js";

export interface CliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export interface AskRendererOptions {
  showThinking: boolean;
  json: boolean;
  io: CliIo;
}

function supportsColor(stream: NodeJS.WritableStream): boolean {
  return (stream as { isTTY?: boolean }).isTTY === true;
}

/**
 * Turns an AskEvent stream into terminal output while capturing the facts the
 * caller reports at the end. Kept separate from the REPL so the one-shot `ask`
 * command renders identically.
 */
export class AskRenderer {
  sessionId: string | undefined;
  model: string | undefined;
  turns = 0;
  aborted = false;
  durationMs = 0;
  failure: { code: string; message: string } | undefined;
  readonly text: string[] = [];

  constructor(private readonly options: AskRendererOptions) {}

  handle(event: AskEvent): void {
    this.capture(event);
    if (this.options.json) {
      this.options.io.stdout.write(`${JSON.stringify(event)}\n`);
      return;
    }
    this.render(event);
  }

  /** True when the daemon reported a failure in-band, after streaming started. */
  get failed(): boolean {
    return this.failure !== undefined;
  }

  fullText(): string {
    return this.text.join("");
  }

  private capture(event: AskEvent): void {
    if (event.sessionStarted !== undefined) {
      this.sessionId = event.sessionStarted.sessionId;
      this.model = event.sessionStarted.model;
      return;
    }
    if (event.textDelta !== undefined) {
      this.text.push(event.textDelta.delta);
      return;
    }
    if (event.result !== undefined) {
      this.turns = event.result.turns;
      this.aborted = event.result.aborted;
      this.durationMs = event.result.durationMs;
      return;
    }
    if (event.error !== undefined) {
      this.failure = { code: event.error.code, message: event.error.message };
    }
  }

  private render(event: AskEvent): void {
    const { stdout, stderr } = this.options.io;

    if (event.textDelta !== undefined) {
      stdout.write(event.textDelta.delta);
      return;
    }
    if (event.thinkingDelta !== undefined) {
      if (this.options.showThinking) stderr.write(this.dim(event.thinkingDelta.delta));
      return;
    }
    if (event.toolStart !== undefined) {
      stderr.write(`${this.dim(`[tool] ${event.toolStart.toolName} started`)}\n`);
      return;
    }
    if (event.toolEnd !== undefined) {
      const outcome = event.toolEnd.isError ? "failed" : "done";
      stderr.write(`${this.dim(`[tool] ${event.toolEnd.toolName} ${outcome}`)}\n`);
      return;
    }
    if (event.error !== undefined) {
      stderr.write(`error ${event.error.code}: ${event.error.message}\n`);
    }
  }

  private dim(text: string): string {
    return supportsColor(this.options.io.stderr) ? `\x1b[2m${text}\x1b[0m` : text;
  }
}

export function formatSummary(renderer: AskRenderer): string {
  const parts = [`turns=${renderer.turns}`, `duration=${renderer.durationMs}ms`];
  if (renderer.aborted) parts.push("aborted");
  if (renderer.sessionId !== undefined) parts.push(`session=${renderer.sessionId}`);
  return parts.join(" ");
}
