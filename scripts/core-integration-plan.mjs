import assert from "node:assert/strict";
import { availableParallelism } from "node:os";
import { join } from "node:path";

export const packages = [
  "testsupport",
  "dockerengine",
  "coreapp",
  "workruntime",
  "packageprepare",
].map((name) => `piwork/internal/${name}`);
export const requiredNames = [
  "TestRealNativeAgentImageStaticCapabilitiesAndBuildEvidence",
  "TestRealManagedResourceLifecycleAndOwnership",
  "TestNativeBrainWorkstationFeedbackExperienceAndActualCandidateBehavior",
  "TestNativeBrainFastAPIWorkstationFeedbackExperienceAndActualCandidateBehavior",
  "TestNativeCoreWebDAVUploadStopApplyRevocationAndRestart",
  "TestNativeMemoryMigrationProcessRecoveryAndStopSupersession",
  "TestNativeSchema4ConversationUpgradeRollbackAndDowngradeFence",
  "TestNativeSchema4ExperienceUpgradeRollbackAndDowngradeFence",
  "TestNativeCoreProcessHealthIdentityRestartWithoutHostTools",
  "TestNativeChatModelSelectionRunsThroughGoAndRealSDK",
  "TestNativeSDKDeploysServiceThroughGoMCPAndCore",
  "TestNativeServiceRevisionsCounterAndRemoval",
  "TestNativeCancelledCheckpointHistoryAfterEventCompaction",
  "TestNativeShutdownConfirmsOtherWorksAfterFailedAgentDrain",
  "TestNativeSnapshotMovesServicesContextsAndPackagesBetweenOfflineInstallations",
  "TestNativeTemporaryCleanupRetriesAfterEngineReturns",
  "TestNativeSkillFailuresRemainSpecificAfterRollbackAndCoreRestart",
];
export const performanceNames = new Set([
  "TestNativeStartupSamplerUsesRealUIAgentAndService",
  "TestNativeLatencyColdConcurrentLargePackageAndSlowMCP",
  "TestNativeWarmDefaultCreationRetainedStartAndRestart",
]);
export const key = (test) => `${test.package}#${test.name}`;

// This cap is scheduling policy, never a prerequisite or a PASS condition.
export function parseJobs(
  requested = "auto",
  { probe = availableParallelism, cap = 8 } = {},
) {
  if (requested !== "auto") {
    assert(
      /^[1-9][0-9]*$/.test(String(requested)) &&
        Number.isSafeInteger(Number(requested)),
      "TEST_JOBS must be auto or a positive integer",
    );
    return {
      requested: String(requested),
      actual: Number(requested),
      reason: "explicit",
    };
  }
  try {
    const available = probe();
    assert(
      Number.isSafeInteger(available) &&
        available > 0 &&
        Number.isSafeInteger(cap) &&
        cap > 0,
    );
    return {
      requested,
      actual: Math.min(available, cap),
      reason: "available parallelism capped by conservative policy",
    };
  } catch {
    return {
      requested,
      actual: 1,
      reason: "resource probe unavailable; serial fallback",
    };
  }
}

export function validateInventory(
  inventory,
  { required = requiredNames } = {},
) {
  assert(inventory.length > 0, "empty inventory");
  const keys = inventory.map(key);
  assert.equal(new Set(keys).size, keys.length, "duplicate inventory");
  for (const test of inventory)
    assert(
      packages.includes(test.package) && /^Test[A-Za-z0-9_]+$/.test(test.name),
      "invalid inventory entry",
    );
  for (const pkg of packages)
    assert(
      inventory.some((test) => test.package === pkg),
      `missing package inventory: ${pkg}`,
    );
  for (const name of required)
    assert.equal(
      inventory.filter((test) => test.name === name).length,
      1,
      `required test missing or ambiguous: ${name}`,
    );
}
export function validateAllocation(inventory, units) {
  const expected = inventory.map(key).sort();
  const actual = units.flatMap((unit) => unit.tests.map(key)).sort();
  assert.deepEqual(
    actual,
    expected,
    "allocation missing, duplicate or unknown test",
  );
}
export function planUnits(
  inventory,
  {
    classified = [],
    indivisible = [],
    exclusive = [],
    durations = {},
    targets,
  } = {},
) {
  validateInventory(inventory);
  const selected = targets
    ? inventory.filter((test) => targets.includes(test.name))
    : inventory;
  if (targets)
    for (const name of targets)
      assert.equal(
        selected.filter((test) => test.name === name).length,
        1,
        `unknown target: ${name}`,
      );
  const known = new Set(classified);
  const units = [];
  for (const pkg of packages) {
    const tests = selected.filter((test) => test.package === pkg);
    if (!tests.length) continue;
    if (indivisible.includes(pkg)) {
      units.push({
        package: pkg,
        tests,
        exclusive: true,
        reason: "package fixture",
        weight: tests.reduce((n, t) => n + (durations[key(t)] || 1), 0),
      });
      continue;
    }
    for (const test of tests) {
      const performance = performanceNames.has(test.name);
      const unknown = !known.has(key(test));
      units.push({
        package: pkg,
        tests: [test],
        exclusive: performance || unknown || exclusive.includes(key(test)),
        reason: performance
          ? "performance"
          : unknown
            ? "unclassified"
            : exclusive.includes(key(test))
              ? "global external resource"
              : "isolated installation",
        weight: durations[key(test)] || 1,
      });
    }
  }
  units.sort(
    (a, b) =>
      b.weight - a.weight || key(a.tests[0]).localeCompare(key(b.tests[0])),
  );
  units.forEach((unit, index) => {
    unit.id = String(index + 1).padStart(4, "0");
  });
  validateAllocation(selected, units);
  return { mode: targets ? "partial" : "full", inventory: selected, units };
}

// Executors get a separate immutable input, including environment, per process.
// Exclusive work begins only after every ordinary process has settled.
export async function schedule(
  units,
  jobs,
  execute,
  { signal, onState = () => {} } = {},
) {
  assert(Number.isSafeInteger(jobs) && jobs > 0);
  const results = [];
  let cursor = 0;
  const ordinary = units.filter((unit) => !unit.exclusive);
  async function worker() {
    while (cursor < ordinary.length && !signal?.aborted) {
      const unit = ordinary[cursor++];
      onState(unit, "running");
      try {
        results.push(await execute(structuredClone(unit)));
      } catch (error) {
        results.push({ id: unit.id, error: String(error), exitCode: 1 });
      }
      onState(unit, "finished");
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(jobs, ordinary.length) }, worker),
  );
  for (const unit of units.filter((unit) => unit.exclusive)) {
    if (signal?.aborted) break;
    onState(unit, "running");
    try {
      results.push(await execute(structuredClone(unit)));
    } catch (error) {
      results.push({ id: unit.id, error: String(error), exitCode: 1 });
    }
    onState(unit, "finished");
  }
  return results;
}

// Go test executes a package from its source directory. Preserve that contract
// for relative testdata paths and fixture subprocesses when using test2json.
export function workerInvocation(unit, binary, root) {
  assert(packages.includes(unit.package), "unknown worker package");
  const pattern = `^(${unit.tests.map((test) => test.name).join("|")})$`;
  return {
    command: "go",
    args: [
      "tool",
      "test2json",
      "-t",
      "-p",
      unit.package,
      binary,
      "-test.v=test2json",
      `-test.run=${pattern}`,
      "-test.timeout=45m",
    ],
    cwd: join(root, unit.package.slice("piwork/".length)),
  };
}
