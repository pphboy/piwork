import { formatHttpUrl, parseListenAddress, ensureCorePaths } from "../application/paths.js";
import { CoreApplication } from "../application/core-application.js";

export async function runServe(args: readonly string[]): Promise<void> {
  assertKnownOptions(args, ["--data-dir", "--listen", "--allow-insecure-remote"]);
  const paths = ensureCorePaths(requiredValue(args, "--data-dir"));
  const requested = parseListenAddress(optionalValue(args, "--listen"), args.includes("--allow-insecure-remote"));
  const application = await CoreApplication.create({ paths });
  try {
    const bound = await application.listen(requested);
    process.stdout.write(`${JSON.stringify({ event: "core.listening", url: formatHttpUrl(bound), pid: process.pid, dataDirectory: paths.dataDirectory })}\n`);
    await waitForSignal();
  } finally {
    await withTimeout(application.close(), 10_000, "Core shutdown exceeded 10 seconds");
  }
}

function requiredValue(args: readonly string[], flag: string): string {
  const value = optionalValue(args, flag);
  if (value === undefined) throw new Error(`${flag} requires a value`);
  return value;
}
function optionalValue(args: readonly string[], flag: string): string | undefined {
  const indexes = args.flatMap((value, index) => value === flag ? [index] : []);
  if (indexes.length > 1) throw new Error(`${flag} may be specified only once`);
  const index = indexes[0];
  if (index === undefined) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}
function assertKnownOptions(args: readonly string[], options: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (!options.includes(argument)) throw new Error(`unknown option: ${argument}`);
    if (argument !== "--allow-insecure-remote") { if (args[index + 1] === undefined || args[index + 1]!.startsWith("--")) throw new Error(`${argument} requires a value`); index += 1; }
  }
}

async function waitForSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    const done = () => { process.off("SIGINT", done); process.off("SIGTERM", done); resolve(); };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })]); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
