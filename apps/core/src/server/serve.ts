import { formatHttpUrl, parseListenAddress, ensureCorePaths } from "../application/paths.js";
import { CoreApplication } from "../application/core-application.js";
import { readEnvironmentFile, resolveEnvironment } from "../application/env-file.js";
import { resolve } from "node:path";

export async function runServe(args: readonly string[]): Promise<void> {
  assertKnownOptions(args, ["--data-dir", "--listen", "--agent-grpc-listen", "--agent-grpc-advertise", "--allow-insecure-remote", "--env-file"]);
  const envFile = optionalValue(args, "--env-file");
  const fileValues = envFile === undefined ? {} : readEnvironmentFile(envFile);
  const explicit: Record<string, string> = {};
  const explicitData = optionalValue(args, "--data-dir"); if (explicitData !== undefined) explicit.PIWORK_DATA_DIR = explicitData;
  const explicitListen = optionalValue(args, "--listen"); if (explicitListen !== undefined) explicit.PIWORK_LISTEN = explicitListen;
  const explicitAgentListen = optionalValue(args, "--agent-grpc-listen"); if (explicitAgentListen !== undefined) explicit.PIWORK_AGENT_GRPC_LISTEN = explicitAgentListen;
  const explicitAgentAdvertise = optionalValue(args, "--agent-grpc-advertise"); if (explicitAgentAdvertise !== undefined) explicit.PIWORK_AGENT_GRPC_ADVERTISE = explicitAgentAdvertise;
  const environment = resolveEnvironment(fileValues, process.env, explicit);
  const dataDirectory = environment.PIWORK_DATA_DIR;
  if (dataDirectory === undefined || dataDirectory === "") throw new Error("--data-dir or PIWORK_DATA_DIR is required");
  const defaultPaths = ensureCorePaths(dataDirectory);
  const paths = environment.PIWORK_OPERATOR_CREDENTIAL_PATH === undefined
    ? defaultPaths
    : { ...defaultPaths, operatorCredentialPath: resolve(environment.PIWORK_OPERATOR_CREDENTIAL_PATH) };
  const requested = parseListenAddress(environment.PIWORK_LISTEN, args.includes("--allow-insecure-remote"));
  const application = await CoreApplication.create({
    paths,
    initialization: initialization(environment),
    agentGrpcListen: environment.PIWORK_AGENT_GRPC_LISTEN ?? "0.0.0.0:7172",
    agentGrpcAdvertise: environment.PIWORK_AGENT_GRPC_ADVERTISE ?? "piwork-core:7172",
    snapshotHelperImage: environment.PIWORK_SNAPSHOT_HELPER_IMAGE,
    fileHelperImage: environment.PIWORK_FILE_HELPER_IMAGE,
    packageHelperImage: environment.PIWORK_PACKAGE_HELPER_IMAGE,
  });
  let startupError: unknown;
  try {
    const bound = await application.listen(requested);
    process.stdout.write(`${JSON.stringify({ event: "core.listening", url: formatHttpUrl(bound), pid: process.pid, dataDirectory: paths.dataDirectory })}\n`);
    await waitForSignal();
  } catch (error) {
    startupError = error;
    throw error;
  } finally {
    try { await withTimeout(application.close(), 45_000, "Core shutdown exceeded 45 seconds"); }
    catch (error) {
      if (startupError === undefined) throw error;
      process.stderr.write(`${JSON.stringify({ event: "core.shutdown-failed-after-startup-error" })}\n`);
    }
  }
}

function initialization(environment: Readonly<Record<string, string>>) {
  const account = environment.PIWORK_ADMIN_ACCOUNT;
  const password = environment.PIWORK_ADMIN_PASSWORD;
  if ((account === undefined) !== (password === undefined)) throw new Error("PIWORK_ADMIN_ACCOUNT and PIWORK_ADMIN_PASSWORD must be provided together");
  const agentImage = environment.PIWORK_AGENT_IMAGE;
  const provider = environment.PIWORK_MODEL_PROVIDER;
  const model = environment.PIWORK_MODEL ?? environment.PIWORK_MODEL_ID;
  const credential = environment.PIWORK_API_KEY ?? environment.PIWORK_MODEL_API_KEY;
  const runtimeFields = [agentImage, provider, model, credential];
  if (runtimeFields.some((value) => value !== undefined) && runtimeFields.some((value) => value === undefined)) {
    throw new Error("PIWORK_AGENT_IMAGE, PIWORK_MODEL_PROVIDER, PIWORK_MODEL, and PIWORK_API_KEY must be provided together");
  }
  return {
    ...(account === undefined ? {} : { administrator: { account, password: password! } }),
    ...(agentImage === undefined ? {} : {
      runtime: {
        agentImage,
        provider: provider!,
        model: model!,
        credential: credential!,
        ...(environment.PIWORK_MODEL_BASE_URL === undefined ? {} : { baseUrl: environment.PIWORK_MODEL_BASE_URL }),
      },
    }),
  };
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
