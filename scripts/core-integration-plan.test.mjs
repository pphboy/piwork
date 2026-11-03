import test from "node:test";
import assert from "node:assert/strict";
import {
  key,
  packages,
  requiredNames,
  parseJobs,
  planUnits,
  validateInventory,
  validateAllocation,
  schedule,
  workerInvocation,
} from "./core-integration-plan.mjs";
import {
  collectEvents,
  summarize,
  assertCompleteEvidence,
} from "./core-integration-results.mjs";
import { parseArguments } from "./run-core-integration.mjs";

const regressions = requiredNames.map((name, index) => ({
  package: packages[index < 2 ? 1 : 2],
  name,
}));
const inventory = [
  ...regressions,
  ...[packages[0], packages[3], packages[4]].map((pkg, index) => ({
    package: pkg,
    name: `TestPackageFixture${index}`,
  })),
];
const policy = { classified: inventory.map(key) };
function completed(
  unit,
  {
    exit = 0,
    packageAction = "pass",
    action = "pass",
    output = "",
    environment = {},
  } = {},
) {
  const events = collectEvents(unit);
  for (const test of unit.tests) {
    for (const event of [
      { Action: "run" },
      { Action: "output", Output: output },
      { Action: action, Elapsed: 1 },
    ])
      events.accept(
        JSON.stringify({ Package: unit.package, Test: test.name, ...event }),
      );
  }
  if (packageAction)
    events.accept(
      JSON.stringify({ Package: unit.package, Action: packageAction }),
    );
  return events.finish(exit, { environment });
}

test("inventory and exact allocation reject omissions, duplicates, extras and missing required regressions", () => {
  const plan = planUnits(inventory, policy);
  validateAllocation(inventory, plan.units);
  assert.throws(
    () =>
      validateInventory(
        inventory.filter((test) => test.package !== packages[0]),
      ),
    /missing package inventory/,
  );
  assert.throws(() => validateInventory(inventory.slice(1)), /required test/);
  assert.throws(
    () => validateInventory([...inventory, inventory[0]]),
    /duplicate/,
  );
  for (const units of [
    plan.units.slice(1),
    [...plan.units, plan.units[0]],
    [...plan.units, { tests: [{ package: packages[0], name: "TestUnknown" }] }],
  ])
    assert.throws(() => validateAllocation(inventory, units));
  assert.throws(() => planUnits(inventory, { targets: ["TestDoesNotExist"] }));
  assert.equal(
    planUnits(inventory, { ...policy, targets: [requiredNames[0]] }).mode,
    "partial",
  );
});

test("unknown new cases and package fixtures are conservatively exclusive", () => {
  const newCase = { package: packages[2], name: "TestFutureUnknownFixture" };
  const plan = planUnits([...inventory, newCase], policy);
  assert.equal(
    plan.units.find((unit) => unit.tests[0].name === newCase.name).exclusive,
    true,
  );
  const combined = planUnits(inventory, {
    ...policy,
    indivisible: [packages[2]],
  });
  assert.equal(
    combined.units.filter((unit) => unit.package === packages[2]).length,
    1,
  );
  assert.equal(
    combined.units.find((unit) => unit.package === packages[2]).exclusive,
    true,
  );
});

test("jobs are portable policy inputs with strict explicit syntax and serial fallback", () => {
  for (const requested of ["1", "2", "7"])
    assert.equal(parseJobs(requested).actual, Number(requested));
  for (const requested of [
    "0",
    "-1",
    "1.5",
    "2x",
    "Infinity",
    "01",
    " 2",
    "9007199254740992",
  ])
    assert.throws(() => parseJobs(requested));
  assert.equal(
    parseJobs("auto", {
      probe: () => {
        throw new Error("unavailable");
      },
    }).actual,
    1,
  );
  assert.equal(parseJobs("auto", { probe: () => 1 }).actual, 1);
  assert.equal(parseJobs("auto", { probe: () => 99, cap: 3 }).actual, 3);
  for (const jobs of [1, 2, 5, 8])
    assert.deepEqual(
      planUnits(inventory, policy).inventory,
      inventory,
      `${jobs} cannot alter inventory`,
    );
});

test("scheduler executes exact coverage, keeps inputs isolated, then drains ordinary load before exclusive work", async () => {
  const plan = planUnits(inventory, {
    ...policy,
    durations: { [key(inventory[0])]: 30 },
  });
  plan.units.at(-1).exclusive = true;
  for (const jobs of [1, 2, 5, 8]) {
    let active = 0,
      exclusive = 0;
    const seen = [];
    const results = await schedule(plan.units, jobs, async (unit) => {
      if (unit.exclusive) assert.equal(active, 0);
      else assert.equal(exclusive, 0);
      if (unit.exclusive) exclusive++;
      active++;
      seen.push(...unit.tests.map(key));
      unit.environment = { PATH: "per-process" };
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (unit.exclusive) exclusive--;
      return completed(unit);
    });
    assert.equal(summarize(plan, results).status, "passed");
    assert.deepEqual(seen.sort(), inventory.map(key).sort());
    assert(plan.units.every((unit) => unit.environment === undefined));
  }
});

test("all PASS still fails on package failure, compile failure, abnormal exit or missing/duplicate events", () => {
  const unit = planUnits(inventory, policy).units[0];
  for (const settings of [
    { packageAction: "fail" },
    { exit: 1 },
    { exit: -1 },
    { packageAction: null },
    { action: "skip" },
  ])
    assert(completed(unit, settings).errors.length);
  const empty = collectEvents(unit);
  empty.accept("not json");
  empty.accept(JSON.stringify({ Package: unit.package, Action: "build-fail" }));
  assert(empty.finish(1).errors.length >= 4);
  const duplicate = collectEvents(unit);
  for (const Action of ["run", "run", "pass", "pass"])
    duplicate.accept(
      JSON.stringify({
        Package: unit.package,
        Test: unit.tests[0].name,
        Action,
      }),
    );
  assert(
    duplicate.finish(0).errors.some((error) => error.includes("duplicate")),
  );
});

test("optional skips retain exact conditions and reasons; required or configured skips fail", () => {
  const unit = {
    id: "optional",
    package: packages[2],
    tests: [{ package: packages[2], name: "TestNativeOptionalRealModelSmoke" }],
  };
  assert.equal(
    completed(unit, {
      action: "skip",
      output: "optional real model smoke requires PIWORK_TEST_REAL_MODEL_ENV",
    }).errors.length,
    0,
  );
  assert(
    completed(unit, { action: "skip", output: "missing something" }).errors
      .length,
  );
  assert(
    completed(unit, {
      action: "skip",
      output: "PIWORK_TEST_REAL_MODEL_ENV",
      environment: { PIWORK_TEST_REAL_MODEL_ENV: "configured" },
    }).errors.length,
  );
});

test("subtests preserve their parent identity, unexpected children or helper names cannot inflate coverage", () => {
  const unit = planUnits(inventory, policy).units[0];
  const events = collectEvents(unit);
  events.accept(
    JSON.stringify({
      Package: unit.package,
      Test: unit.tests[0].name + "/child",
      Action: "pass",
    }),
  );
  events.accept(
    JSON.stringify({
      Package: unit.package,
      Test: "TestUnknown/child",
      Action: "pass",
    }),
  );
  assert(events.finish(0).errors.some((error) => error.includes("unknown")));
});

test("full evidence requires every execution, clean exits, cleanup and matching candidate; partial is never full", () => {
  const plan = planUnits(inventory, policy),
    results = plan.units.map((unit) => completed(unit));
  assert.equal(summarize(plan, results).status, "passed");
  assert.equal(summarize(plan, results.slice(1)).status, "failed");
  assert.equal(summarize(plan, [...results, results[0]]).status, "failed");
  for (const settings of [
    { identityMatches: false },
    { cleanupConfirmed: false },
  ])
    assert.equal(summarize(plan, results, settings).status, "failed");
  assert.equal(summarize(plan, results, { aborted: true }).status, "aborted");
  const partial = planUnits(inventory, {
    ...policy,
    targets: [requiredNames[0]],
  });
  assert.equal(
    summarize(
      partial,
      partial.units.map((unit) => completed(unit)),
    ).status,
    "partial",
  );
  const identity = { source: "candidate-a" };
  assert(
    assertCompleteEvidence(
      { summary: summarize(plan, results), identity },
      identity,
    ),
  );
  assert.throws(() =>
    assertCompleteEvidence(
      { summary: { status: "partial", mode: "partial" }, identity },
      identity,
    ),
  );
  assert.throws(() =>
    assertCompleteEvidence(
      { summary: summarize(plan, results), identity },
      { source: "candidate-b" },
    ),
  );
});

test("cancelled scheduler records incomplete work and executor failures do not suppress remaining cleanup work", async () => {
  const plan = planUnits(inventory, policy),
    controller = new AbortController();
  const results = await schedule(
    plan.units,
    1,
    async () => {
      controller.abort();
      throw new Error("synthetic worker failure");
    },
    { signal: controller.signal },
  );
  assert.equal(results.length, 1);
  assert.equal(summarize(plan, results, { aborted: true }).status, "aborted");
});

test("runner help and precedence accept only the implemented interface", () => {
  assert.equal(parseArguments(["--help"]).help, true);
  assert.equal(parseArguments(["--jobs", "2", "--prepared"]).jobs, "2");
  assert.equal(parseArguments(["--prepared"]).prepare, false);
  assert.deepEqual(parseArguments(["--targets", "TestOne,TestTwo"]).targets, [
    "TestOne",
    "TestTwo",
  ]);
  assert.throws(() => parseArguments(["--jobs"]));
  assert.throws(() => parseArguments(["--skip-required"]));
});

test("worker execution retains Go package working directory for real relative testdata reads", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import(
    "node:fs"
  );
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { runProcess } = await import("./core-integration-process.mjs");
  const root = mkdtempSync(join(tmpdir(), "piwork-package-cwd-"));
  try {
    const unit = planUnits(inventory, policy).units[0];
    const invocation = workerInvocation(unit, "/synthetic.test", root);
    mkdirSync(join(invocation.cwd, "testdata"), { recursive: true });
    writeFileSync(
      join(invocation.cwd, "testdata", "relative-fixture"),
      "scoped fixture",
    );
    const program = `const fs=require('node:fs'); if(fs.readFileSync('testdata/relative-fixture','utf8')!=='scoped fixture')throw new Error('wrong fixture');`;
    const result = await runProcess(process.execPath, ["-e", program], {
      cwd: invocation.cwd,
      env: process.env,
    });
    assert.equal(result.exitCode, 0);
    const wrong = await runProcess(process.execPath, ["-e", program], {
      cwd: root,
      env: process.env,
    });
    assert.notEqual(
      wrong.exitCode,
      0,
      "repository cwd must fail this regression",
    );
    assert.throws(() =>
      workerInvocation(
        { ...unit, package: "other/package" },
        "/synthetic.test",
        root,
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
