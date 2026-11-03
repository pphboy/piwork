import { spawn, spawnSync } from "node:child_process";
import { buildConfiguration } from "./core-integration-artifacts.mjs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
let supervisor;
export function processSupervisorBinary() {
  if (supervisor) return supervisor;
  const env = {
    ...process.env,
    CGO_ENABLED: "0",
    GOTOOLCHAIN: "local",
    GOFLAGS: "",
    GOOS: "linux",
    GOARCH: process.arch === "x64" ? "amd64" : process.arch,
  };

  const version = spawnSync("go", ["version"], { env, encoding: "utf8" });
  if (version.status !== 0)
    throw new Error(
      "integration supervisor requires the repository Go toolchain",
    );
  const hash = createHash("sha256").update(version.stdout);
  const configuration = spawnSync("go", ["env", "-json"], {
    cwd: root,
    env,
    encoding: "utf8",
  });
  if (configuration.status !== 0)
    throw new Error("supervisor build configuration unavailable");
  hash.update(
    buildConfiguration({}, JSON.parse(configuration.stdout)).goEnvironment,
  );

  for (const name of ["go.mod", "go.sum", "scripts/integrationprocess/main.go"])
    hash.update(readFileSync(join(root, name)));
  const directory = join(root, "dist/core-integration-tools");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const binary = join(directory, hash.digest("hex"));
  if (!existsSync(binary)) {
    const temporary = binary + "." + process.pid;
    const result = spawnSync(
      "go",
      [
        "build",
        "-mod=readonly",
        "-buildvcs=false",
        "-trimpath",
        "-o",
        temporary,
        "./scripts/integrationprocess",
      ],
      { cwd: root, env, encoding: "utf8" },
    );
    if (result.status !== 0)
      throw new Error("integration supervisor build failed: " + result.stderr);
    renameSync(temporary, binary);
  }
  supervisor = binary;
  return binary;
}

// The Linux subreaper owns all descendants, including new process groups and
// sessions. Its status pipe is private and never mixed into Go test events.
export async function runProcess(
  command,
  args,
  { cwd, env, signal, onSpawn = () => {}, graceMs = 5000, timeoutMs = 0 } = {},
) {
  if (signal?.aborted)
    return { exitCode: -1, aborted: true, cleanupConfirmed: true };
  const child = spawn(
    processSupervisorBinary(),
    [String(graceMs), command, ...args],
    {
      cwd,
      env: { ...env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    },
  );
  let status = "",
    killTimer,
    deadline,
    aborted = false,
    timedOut = false;
  child.stdio[3].setEncoding("utf8").on("data", (data) => {
    status += data;
  });
  const stop = () => {
    aborted = !!signal?.aborted;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {}
    if (!killTimer)
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {}
      }, graceMs + 1500);
  };
  signal?.addEventListener("abort", stop, { once: true });
  if (timeoutMs)
    deadline = setTimeout(() => {
      timedOut = true;
      stop();
    }, timeoutMs);
  onSpawn(child);
  const outer = await new Promise((resolve) => {
    child.once("error", () => resolve(-1));
    child.once("close", (code) => resolve(code ?? -1));
  });
  clearTimeout(killTimer);
  clearTimeout(deadline);
  signal?.removeEventListener("abort", stop);
  let result;
  try {
    result = JSON.parse(status);
  } catch {}
  if (
    !result ||
    outer !== 0 ||
    typeof result.exitCode !== "number" ||
    result.cleanupConfirmed !== true
  ) {
    return {
      exitCode: result?.exitCode ?? -1,
      aborted,
      timedOut,
      orphaned: result?.orphaned ?? true,
      cleanupConfirmed: false,
    };
  }
  return { ...result, aborted, timedOut };
}
