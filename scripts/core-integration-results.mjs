import {
  key,
  requiredNames,
  validateAllocation,
} from "./core-integration-plan.mjs";

export const optionalSkips = {
  TestIsolatedRealEngineIdentitySurvivesDaemonRestart: {
    environment: "PIWORK_TEST_ISOLATED_DIND_IMAGE",
    reason: "PIWORK_TEST_ISOLATED_DIND_IMAGE",
  },
  TestNativeSchema5UpgradeRollbackAndDowngradeFence: {
    environment: "PIWORK_TEST_NATIVE_HISTORY5_IMAGE",
    reason: "source and current acceptance images required",
  },
  TestNativeOptionalRealModelSmoke: {
    environment: "PIWORK_TEST_REAL_MODEL_ENV",
    reason: "PIWORK_TEST_REAL_MODEL_ENV",
  },
  TestNativeSELinuxSnapshotRejectsUserAttributesAndRetries: {
    environment: "PIWORK_TEST_SELINUX",
    reason: "SELinux Enforcing",
  },
  TestNativePreparationRecordsPermitOldCoreRollbackAndUpgrade: {
    environment: "PIWORK_TEST_PREPARATION_OLD_CORE",
    reason: "PIWORK_TEST_PREPARATION_OLD_CORE",
  },
  TestNativeNewAgentRejectsTemporaryModeAgainstOldCore: {
    environment: "PIWORK_TEST_OLD_CORE_BINARY",
    reason: "PIWORK_TEST_OLD_CORE_BINARY",
  },
};

export function collectEvents(unit) {
  const starts = new Map(),
    terminals = new Map(),
    outputs = new Map(),
    errors = [];
  const packageTerminals = [];
  const expected = new Set(unit.tests.map(key));
  return {
    accept(line) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        errors.push("malformed event");
        return;
      }
      if (
        event.Package !== unit.package ||
        ![
          "start",
          "run",
          "pause",
          "cont",
          "pass",
          "fail",
          "skip",
          "output",
          "build-output",
          "build-fail",
        ].includes(event.Action)
      ) {
        errors.push("invalid event identity/action");
        return;
      }
      if (event.Action === "build-fail") errors.push("compile failure");
      if (!event.Test) {
        if (["pass", "fail", "skip"].includes(event.Action))
          packageTerminals.push(event.Action);
        return;
      }
      const top = event.Test.split("/")[0],
        id = `${event.Package}#${top}`;
      if (!expected.has(id)) errors.push(`unknown test: ${id}`);
      if (event.Output) outputs.set(id, (outputs.get(id) || "") + event.Output);
      if (event.Test !== top) {
        if (event.Action === "fail")
          errors.push(`subtest failed: ${event.Test}`);
        if (event.Action === "skip")
          errors.push(`unexplained subtest skip: ${event.Test}`);
        return;
      }
      if (event.Action === "run") starts.set(id, (starts.get(id) || 0) + 1);
      if (["pass", "fail", "skip"].includes(event.Action)) {
        if (terminals.has(id)) errors.push(`duplicate terminal: ${id}`);
        terminals.set(id, { action: event.Action, elapsed: event.Elapsed });
      }
    },
    finish(exitCode, { environment = {} } = {}) {
      if (exitCode !== 0) errors.push(`process exit: ${exitCode}`);
      if (packageTerminals.length !== 1 || packageTerminals[0] !== "pass")
        errors.push("missing or failed package terminal");
      const tests = unit.tests.map((test) => {
        const id = key(test),
          terminal = terminals.get(id);
        if (starts.get(id) !== 1)
          errors.push(`missing or duplicate run: ${id}`);
        if (!terminal) errors.push(`missing terminal: ${id}`);
        if (terminal?.action === "fail") errors.push(`failed test: ${id}`);
        let skipReason;
        if (terminal?.action === "skip") {
          const rule = optionalSkips[test.name];
          const text = outputs.get(id) || "";
          if (
            requiredNames.includes(test.name) ||
            !rule ||
            environment[rule.environment] ||
            !text.includes(rule.reason)
          )
            errors.push(`unexplained or required skip: ${id}`);
          skipReason = rule?.reason;
        }
        return { ...test, ...terminal, skipReason };
      });
      return {
        id: unit.id,
        package: unit.package,
        exitCode,
        packageTerminals,
        tests,
        errors,
      };
    },
  };
}

export function summarize(
  plan,
  results,
  { aborted = false, identityMatches = true, cleanupConfirmed = true } = {},
) {
  const errors = [];
  try {
    validateAllocation(plan.inventory, plan.units);
  } catch (error) {
    errors.push(error.message);
  }
  const ids = results.map((result) => result.id);
  if (
    new Set(ids).size !== ids.length ||
    ids.length !== plan.units.length ||
    plan.units.some((unit) => !ids.includes(unit.id))
  )
    errors.push("missing, unknown or duplicate execution unit");
  for (const result of results) {
    errors.push(...(result.errors || []));
    if (result.error) errors.push(result.error);
    if (result.exitCode !== 0) errors.push(`unsuccessful unit: ${result.id}`);
    const unit = plan.units.find((item) => item.id === result.id);
    if (
      !unit ||
      JSON.stringify((result.tests || []).map(key).sort()) !==
        JSON.stringify(unit.tests.map(key).sort())
    )
      errors.push(`unit result inventory mismatch: ${result.id}`);
  }
  const tests = results.flatMap((result) => result.tests || []);
  if (plan.mode === "full")
    for (const name of requiredNames)
      if (
        tests.filter((test) => test.name === name && test.action === "pass")
          .length !== 1
      )
        errors.push(`required regression not passed exactly once: ${name}`);
  if (!identityMatches) errors.push("candidate identity drift");
  if (!cleanupConfirmed) errors.push("cleanup unconfirmed");
  if (aborted) errors.push("aborted");
  const status = aborted
    ? "aborted"
    : errors.length
      ? "failed"
      : plan.mode === "partial"
        ? "partial"
        : "passed";
  return {
    status,
    mode: plan.mode,
    expected: plan.inventory.length,
    passed: tests.filter((t) => t.action === "pass").length,
    skipped: tests.filter((t) => t.action === "skip"),
    requiredPassed: requiredNames.filter((name) =>
      tests.some((t) => t.name === name && t.action === "pass"),
    ).length,
    errors,
  };
}

// Evidence consumers may call this, but this module never reads/writes tasks.
export function assertCompleteEvidence(report, identity) {
  if (
    report.summary?.status !== "passed" ||
    report.summary.mode !== "full" ||
    JSON.stringify(report.identity) !== JSON.stringify(identity)
  )
    throw new Error("complete evidence for the same candidate required");
  return true;
}
