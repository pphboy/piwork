#!/usr/bin/env node
// Owns one integration run. Reports are evidence, never OpenSpec mutations.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import {
  packages,
  key,
  parseJobs,
  planUnits,
  workerInvocation,
} from "./core-integration-plan.mjs";
import { collectEvents, summarize } from "./core-integration-results.mjs";
import {
  preparationCache,
  verifyImageRecords,
  sameArtifacts,
  verifyPrepared,
  buildConfiguration,
} from "./core-integration-artifacts.mjs";

import {
  runProcess,
  processSupervisorBinary,
} from "./core-integration-process.mjs";

export const root = resolve(import.meta.dirname, "..");
const imageDefaults = {
  PIWORK_TEST_NATIVE_AGENT_IMAGE: "piwork-agentd:go-migration-acceptance",
  PIWORK_TEST_PRODUCTION_AGENT_IMAGE: "piwork-agentd:go-migration-production",
  PIWORK_TEST_NATIVE_FILE_HELPER_IMAGE:
    "piwork-file-helper:go-migration-acceptance",
  PIWORK_TEST_NATIVE_SNAPSHOT_HELPER_IMAGE:
    "piwork-snapshot-helper:go-migration-acceptance",
  PIWORK_TEST_NATIVE_OLD_SDK_IMAGE: "piwork-agentd:go-migration-sdk-0860",
  PIWORK_TEST_NATIVE_UNAVAILABLE_REGISTRY_IMAGE:
    "piwork-agentd:go-migration-registry-unavailable",
  PIWORK_TEST_NATIVE_HISTORY4_IMAGE:
    "piwork-memory-history4-web-base:acceptance",
};
export function parseArguments(args) {
  const options = { prepare: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help") options.help = true;
    else if (arg === "--prepared") options.prepare = false;
    else if (["--jobs", "--output", "--targets", "--history"].includes(arg)) {
      assert(
        args[i + 1] && !args[i + 1].startsWith("--"),
        `missing ${arg} value`,
      );
      options[arg.slice(2)] = args[++i];
    } else throw new Error("unknown integration option; use --help");
  }
  if (options.targets) options.targets = options.targets.split(",");
  return options;
}
export function sourceIdentity() {
  const result = spawnSync(
    "git",
    ["ls-files", "-c", "-o", "--exclude-standard", "-z"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, "source discovery failed");
  const hash = createHash("sha256");
  const head = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(head.status, 0, "source commit unavailable");
  hash.update(head.stdout);
  const names = [
    ...new Set(
      result.stdout
        .split("\0")
        .filter(
          (name) =>
            name &&
            !name.startsWith("openspec/") &&
            !name.startsWith(".agents/"),
        ),
    ),
  ];
  for (const name of names.sort()) {
    hash.update(name + "\0");
    hash.update(
      existsSync(join(root, name))
        ? readFileSync(join(root, name))
        : "<deleted>",
    );
  }
  return hash.digest("hex");
}
export const digest = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");

export async function runIntegration(options) {
  const jobs = parseJobs(options.jobs ?? process.env.TEST_JOBS ?? "auto");
  const once = preparationCache();
  const started = performance.now();
  const output = resolve(
    root,
    options.output ||
      `dist/core-integration/${new Date().toISOString().replaceAll(":", "-")}-${process.pid}`,
  );
  assert(
    output.startsWith(join(root, "dist") + "/"),
    "reports must be inside ignored dist/",
  );
  mkdirSync(output, { recursive: true, mode: 0o700 });
  mkdirSync(join(output, "bin"), { mode: 0o700 });
  const env = {
    ...imageDefaults,
    ...process.env,
    CGO_ENABLED: "0",
    GOTOOLCHAIN: "local",
  };
  // Git test subprocesses must not inherit a build-specific worktree override.
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const report = {
    schema: 1,
    started: new Date().toISOString(),
    jobs,
    output,
    phase: "preflight",
    durations: {},
    results: [],
    preparation: {
      requested: options.prepare
        ? "build"
        : "verify existing; build caches only",
    },
    identity: null,
  };
  const save = () => {
    const temporary = join(output, "result.json.tmp");
    writeFileSync(temporary, JSON.stringify(report, null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(temporary, join(output, "result.json"));
  };
  const progress = (message) => {
    console.log(message);
    save();
  };
  async function command(
    command,
    args,
    {
      filename,
      environment = env,
      workingDirectory = root,
      events,
      allowFailure = false,
      timeout = 0,
      cancellable = true,
    } = {},
  ) {
    const log = createWriteStream(join(output, filename || "commands.log"), {
      flags: "a",
      mode: 0o600,
    });
    let lines;
    const result = await runProcess(command, args, {
      cwd: workingDirectory,
      env: environment,
      signal: cancellable ? controller.signal : undefined,
      timeoutMs: timeout,
      onSpawn(child) {
        child.stdout.pipe(log, { end: false });
        child.stderr.pipe(log, { end: false });
        if (events) {
          lines = createInterface({ input: child.stdout });
          lines.on("line", (line) => events.accept(line));
        }
      },
    });
    const code =
      result.aborted || result.timedOut || result.cleanupConfirmed === false
        ? -1
        : result.exitCode;
    appendFileSync(
      join(output, "processes.jsonl"),
      JSON.stringify({ log: filename, ...result }) + "\n",
      { mode: 0o600 },
    );
    lines?.close();
    await new Promise((resolve) => log.end(resolve));
    if (code !== 0 && !allowFailure)
      throw new Error(`${command} failed; see ${filename}`);
    return code;
  }
  const imageReferences = () =>
    [
      ...new Set(
        [
          ...Object.keys(imageDefaults).map((key) => env[key]),
          env.PIWORK_TEST_NATIVE_HISTORY5_IMAGE,
          env.PIWORK_TEST_ISOLATED_DIND_IMAGE,
          "python:3.13-slim",
          "piwork-workstation:acceptance",
          "piwork-agentd:synthetic-incompatible-helper",
        ].filter(Boolean),
      ),
    ].sort();
  const images = () => {
    const result = spawnSync(
      "docker",
      ["image", "inspect", ...imageReferences()],
      { cwd: root, env, encoding: "utf8" },
    );
    assert.equal(
      result.status,
      0,
      "required current/historical fixture unavailable; run preparation and supply authentic history images",
    );
    const records = JSON.parse(result.stdout);
    return verifyImageRecords(
      imageReferences(),
      records,
      env.PIWORK_TEST_NATIVE_HISTORY4_IMAGE,
    );
  };
  let plan, cleanupBinary, baseline;
  let cleanupConfirmed = true;
  let identityMatches = true;
  const ledger = join(output, "scopes.txt");
  writeFileSync(ledger, "", { mode: 0o600 });
  env.PIWORK_TEST_SCOPE_LEDGER = ledger;
  env.PIWORK_TEST_RPC_REGISTRY = join(output, "rpc-leases");
  try {
    const candidateSource = sourceIdentity();
    const preparedPath = join(root, "dist/core-integration/prepared.json");
    const effectiveBuildConfiguration = () => {
      const result = spawnSync("go", ["env", "-json"], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(
        result.status,
        0,
        "effective Go build configuration unavailable",
      );
      return buildConfiguration(env, JSON.parse(result.stdout));
    };
    const sharedIdentity = () => {
      const compiled = {};
      function visit(directory) {
        for (const item of readdirSync(join(root, directory), {
          withFileTypes: true,
        })) {
          const path = join(directory, item.name);
          if (item.isDirectory()) visit(path);
          else compiled[path] = digest(join(root, path));
        }
      }
      for (const name of [
        "apps/agentd",
        "packages/contracts",
        "packages/pi-package",
        "packages/pi-adapter",
        "packages/work-store",
      ])
        visit(name + "/dist");
      return {
        source: candidateSource,
        configuration: effectiveBuildConfiguration(),
        images: images(),
        binaries: Object.fromEntries(
          ["piwork-core", "piwork-cli"].map((name) => [
            name,
            digest(join(root, "dist/go", name)),
          ]),
        ),
        compiled,
        tools: {
          node: process.version,
          go: spawnSync("go", ["version"], { encoding: "utf8" }).stdout.trim(),
        },
      };
    };
    if (!options.prepare) {
      verifyPrepared(
        JSON.parse(readFileSync(preparedPath, "utf8")),
        sharedIdentity(),
      );
      report.preparation.cache =
        "verified previous shared build; execution is fresh";
    }
    if (options.prepare) {
      report.phase = "prepare";
      progress(
        "Preparing shared harness, host and immutable image fixtures once.",
      );
      const time = performance.now();
      await once(candidateSource, () =>
        command(
          "make",
          [
            "harness-fixtures",
            "webui-assets",
            "native-compatibility-images",
            "native-helper-images",
            "workstation-fixture",
            "native-history4-web-base-fixture",
          ],
          { filename: "prepare.log" },
        ),
      );
      report.durations.prepareMs = performance.now() - time;
    } else report.durations.prepareMs = 0;
    if (options.prepare) {
      report.phase = "build";
      const buildTime = performance.now();
      const git = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
        cwd: root,
        encoding: "utf8",
      });
      assert.equal(git.status, 0);
      await command("make", ["build-go"], {
        filename: "build.log",
        environment: {
          ...env,
          GIT_DIR: git.stdout.trim(),
          GIT_WORK_TREE: root,
        },
      });
      report.durations.hostBuildMs = performance.now() - buildTime;
    }
    assert.equal(
      sourceIdentity(),
      candidateSource,
      "source changed during preparation",
    );
    if (options.prepare) {
      mkdirSync(join(root, "dist/core-integration"), { recursive: true });
      const temporary = preparedPath + "." + process.pid;
      writeFileSync(temporary, JSON.stringify(sharedIdentity()) + "\n", {
        mode: 0o600,
      });
      renameSync(temporary, preparedPath);
      const log = readFileSync(join(output, "prepare.log"), "utf8");
      report.preparation.cache = {
        dockerCachedSteps: (log.match(/^#.* CACHED$/gm) || []).length,
        testResultCache: false,
      };
      report.preparation.sharedPreparationCount = 1;
    }
    const imageState = images();
    // The history bridge must remain an explicitly identified fixture.
    assert.equal(
      imageState[env.PIWORK_TEST_NATIVE_HISTORY4_IMAGE].labels[
        "io.piwork.fixture.web-base-history4"
      ],
      "true",
      "required history-4 bridge identity missing",
    );
    report.phase = "compile and discover";
    const compileTime = performance.now();
    const binaries = {};
    const inventory = [];
    const packageHooks = [];
    for (const pkg of packages) {
      const metadata = spawnSync(
        "go",
        ["list", "-json", "-tags=integration", "./" + pkg.slice(7)],
        { cwd: root, env, encoding: "utf8" },
      );
      assert.equal(metadata.status, 0, "package fixture discovery failed");
      const details = JSON.parse(metadata.stdout);
      if (
        [...(details.TestGoFiles || []), ...(details.XTestGoFiles || [])].some(
          (file) =>
            /func\s+TestMain\s*\(/.test(
              readFileSync(join(details.Dir, file), "utf8"),
            ),
        )
      )
        packageHooks.push(pkg);
      const binary = join(output, "bin", pkg.split("/").at(-1) + ".test");
      await command(
        "go",
        [
          "test",
          "-c",
          "-mod=readonly",
          "-tags=integration",
          "-o",
          binary,
          "./" + pkg.slice("piwork/".length),
        ],
        { filename: "compile.log" },
      );
      binaries[pkg] = binary;
      const result = spawnSync(binary, ["-test.list=^Test"], {
        cwd: root,
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, "test discovery failed");
      for (const name of result.stdout.trim().split("\n").filter(Boolean))
        inventory.push({ package: pkg, name });
    }
    const fixture = join(output, "bin", "core-fixture");
    cleanupBinary = join(output, "bin", "cleanup");
    await command(
      "go",
      [
        "build",
        "-mod=readonly",
        "-trimpath",
        "-o",
        fixture,
        "./scripts/corefixture",
      ],
      { filename: "compile.log" },
    );
    await command(
      "go",
      [
        "build",
        "-mod=readonly",
        "-trimpath",
        "-o",
        cleanupBinary,
        "./scripts/integrationcleanup",
      ],
      { filename: "compile.log" },
    );
    env.PIWORK_TEST_CORE_FIXTURE_BIN = fixture;
    env.PIWORK_TEST_CORE_FIXTURE_SHA256 = digest(fixture);
    report.durations.compileMs = performance.now() - compileTime;
    const policy = JSON.parse(
      readFileSync(join(root, "scripts/core-integration-resources.json")),
    );
    const durations = options.history
      ? Object.fromEntries(
          JSON.parse(readFileSync(options.history)).results.flatMap((result) =>
            (result.tests || [])
              .filter((t) => t.elapsed > 0)
              .map((t) => [key(t), t.elapsed]),
          ),
        )
      : {};
    plan = planUnits(inventory, {
      ...policy,
      indivisible: [...new Set([...policy.indivisible, ...packageHooks])],
      durations,
      targets: options.targets,
    });
    writeFileSync(
      join(output, "plan.json"),
      JSON.stringify(plan, null, 2) + "\n",
    );
    const binaryState = Object.fromEntries(
      [
        ...Object.entries(binaries),
        ["fixture", fixture],
        ["supervisor", processSupervisorBinary()],
        ["cleanup", cleanupBinary],
        ["hostCore", join(root, "dist/go/piwork-core")],
        ["hostCLI", join(root, "dist/go/piwork-cli")],
      ].map(([name, path]) => [name, { path, sha256: digest(path) }]),
    );
    const historicalBinaries = Object.fromEntries(
      ["PIWORK_TEST_OLD_CORE_BINARY", "PIWORK_TEST_PREPARATION_OLD_CORE"]
        .filter((name) => env[name])
        .map((name) => [name, { path: env[name], sha256: digest(env[name]) }]),
    );
    baseline = {
      source: candidateSource,
      compiled: sharedIdentity().compiled,
      buildConfiguration: effectiveBuildConfiguration(),
      images: imageState,
      binaries: { ...binaryState, ...historicalBinaries },
      tools: {
        node: process.version,
        go: spawnSync("go", ["version"], { encoding: "utf8" }).stdout.trim(),
      },
      git: {
        head: spawnSync("git", ["rev-parse", "HEAD"], {
          cwd: root,
          encoding: "utf8",
        }).stdout.trim(),
        modified: !!spawnSync(
          "git",
          ["status", "--porcelain", "--untracked-files=normal"],
          { cwd: root, encoding: "utf8" },
        ).stdout.trim(),
      },
      configuration: Object.fromEntries(
        Object.keys(env)
          .filter(
            (name) =>
              /^(PIWORK_TEST_|DOCKER_|GOFLAGS$)/.test(name) &&
              ![
                "PIWORK_TEST_SCOPE_LEDGER",
                "PIWORK_TEST_RPC_REGISTRY",
                "PIWORK_TEST_CORE_FIXTURE_BIN",
                "PIWORK_TEST_CORE_FIXTURE_SHA256",
              ].includes(name),
          )
          .sort()
          .map((name) => [
            name,
            createHash("sha256").update(env[name]).digest("hex"),
          ]),
      ),
      manifest: plan.inventory,
    };
    report.identity = baseline;
    report.phase = "execute";
    report.completed = 0;
    report.running = [];
    progress(
      `${plan.mode}: ${inventory.length} discovered, ${plan.inventory.length} selected; ${jobs.actual} workers, ${plan.units.filter((unit) => unit.exclusive).length} exclusive units. Report: ${output}/result.json`,
    );
    const execution = performance.now();
    const { schedule } = await import("./core-integration-plan.mjs");
    report.results = await schedule(
      plan.units,
      jobs.actual,
      async (unit) => {
        const collector = collectEvents(unit);
        const invocation = workerInvocation(unit, binaries[unit.package], root);
        const code = await command(invocation.command, invocation.args, {
          filename: `unit-${unit.id}.jsonl`,
          events: collector,
          allowFailure: true,
          workingDirectory: invocation.cwd,
        });
        const result = collector.finish(code, { environment: env });
        report.results.push(result);
        report.completed++;
        progress(
          `${report.completed}/${plan.units.length} ${result.errors.length ? "FAIL" : "done"} ${unit.tests.map((test) => test.name).join(",")}`,
        );
        return result;
      },
      {
        signal: controller.signal,
        onState(unit, state) {
          report.running = report.running.filter((item) => item.id !== unit.id);
          if (state === "running")
            report.running.push({
              id: unit.id,
              tests: unit.tests,
              reason: unit.reason,
            });
          save();
        },
      },
    );
    report.durations.executeMs = performance.now() - execution;
    identityMatches =
      sourceIdentity() === baseline.source &&
      sameArtifacts(
        effectiveBuildConfiguration(),
        baseline.buildConfiguration,
      ) &&
      sameArtifacts(sharedIdentity().compiled, baseline.compiled) &&
      sameArtifacts(images(), baseline.images) &&
      Object.values(baseline.binaries).every(
        (binary) => digest(binary.path) === binary.sha256,
      );
  } catch (error) {
    report.error = error.message;
    identityMatches = false;
  } finally {
    report.phase = "cleanup";
    save();
    const cleanupStart = performance.now();
    if (cleanupBinary && existsSync(cleanupBinary)) {
      const code = await command(cleanupBinary, [ledger], {
        filename: "cleanup.log",
        allowFailure: true,
        cancellable: false,
        timeout: 90000,
      });
      cleanupConfirmed = code === 0;
    } else if (readFileSync(ledger, "utf8").trim()) cleanupConfirmed = false;
    report.durations.cleanupMs = performance.now() - cleanupStart;
    report.durations.totalMs = performance.now() - started;
    report.summary = plan
      ? summarize(plan, report.results, {
          aborted: controller.signal.aborted,
          identityMatches,
          cleanupConfirmed,
        })
      : {
          status: controller.signal.aborted ? "aborted" : "failed",
          errors: [report.error || "preflight incomplete"],
        };
    if (report.error && report.summary.status !== "aborted")
      report.summary.status = "failed";
    report.phase = report.summary.status;
    report.finished = new Date().toISOString();
    progress(
      `${report.summary.status}: ${report.summary.passed || 0}/${report.summary.expected || 0} PASS; ${Math.round(report.durations.totalMs / 1000)}s total. ${output}/result.json`,
    );
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help)
      console.log(`Usage: node scripts/run-core-integration.mjs [--jobs auto|N] [--prepared] [--output dist/PATH] [--targets NAME,...] [--history RESULT.json]
make test-integration-go runs the five-package full inventory exactly once and checks the required 16 in that run.
--jobs overrides TEST_JOBS; auto caps available parallelism and falls back to 1 if unavailable. No hardware requirement.
Unknown cases and performance cases run exclusively; each worker has an independent process and installation.
--prepared verifies existing builds/images; normal mode prepares each shared artifact once. No cached test result is accepted.
--targets always reports partial, even when every selected test passes. Unknown/unexplained skips and missing history-4 fixtures fail.
Evidence: plan.json, structured unit-*.jsonl, result.json with source/config/binary/image IDs and phase durations.
SIGINT/SIGTERM stops process groups with a bounded fallback and cleans only scope IDs in this run's ledger. OpenSpec is never written.`);
    else {
      process.umask(0o022);
      const report = await runIntegration(options);
      process.exitCode = ["passed", "partial"].includes(report.summary.status)
        ? 0
        : 1;
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
