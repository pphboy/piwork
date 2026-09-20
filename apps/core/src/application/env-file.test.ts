import assert from "node:assert/strict";
import test from "node:test";
import { parseEnvironmentFile, resolveEnvironment } from "./env-file.js";

test("environment file parser supports comments and quotes without evaluating shell", () => {
  const parsed = parseEnvironmentFile(`
# comment
PLAIN=value
SINGLE='literal $HOME'
DOUBLE="line\\nvalue"
TRAIL=value # comment
`);
  assert.deepEqual(parsed, { PLAIN: "value", SINGLE: "literal $HOME", DOUBLE: "line\nvalue", TRAIL: "value" });
  assert.throws(() => parseEnvironmentFile("A=1\nA=2\n"), /duplicate/);
  assert.throws(() => parseEnvironmentFile("BROKEN\n"), /line 1/);
  assert.throws(() => parseEnvironmentFile("A=$(whoami)\n"), /unsupported/);
});

test("explicit values override process environment and env file", () => {
  assert.deepEqual(resolveEnvironment({ A: "file", B: "file" }, { A: "process" }, { A: "explicit" }), {
    A: "explicit",
    B: "file",
  });
});
