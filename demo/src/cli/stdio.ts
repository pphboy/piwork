/**
 * Keeps the CLI quiet when its output pipe closes early.
 *
 * Node turns a closed downstream pipe (`piwork-cli ask ... | head -1`) into an
 * EPIPE error event on stdout. With no listener that event is unhandled and the
 * process dies with a stack trace, which is noise rather than a failure: the
 * consumer simply stopped reading. Any other stream error is a real bug and is
 * rethrown.
 *
 * `exit` is injectable so the behaviour can be tested without ending the test
 * runner.
 */
export function installEpipeGuard(
  stream: NodeJS.WritableStream,
  exit: (code: number) => void = (code) => process.exit(code),
): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") {
      exit(0);
      return;
    }
    throw error;
  });
}
