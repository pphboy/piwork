import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { closeMcpWithDeadline } from "./mcp-shutdown.js";

test("MCP close preserves rejection and bounds an unsettled close", async () => {
  const failure = new Error("synthetic close rejection");
  await assert.rejects(
    closeMcpWithDeadline(() => Promise.reject(failure)),
    (error) => error === failure,
  );
  await closeMcpWithDeadline(() => new Promise(() => {}), 10);
});

test("completed and rejected MCP close leave no fallback timer in a real child process", () => {
  for (const reject of [false, true]) {
    const module = new URL("./mcp-shutdown.js", import.meta.url).href;
    const program = `import {closeMcpWithDeadline} from ${JSON.stringify(module)}; try { await closeMcpWithDeadline(() => ${reject ? 'Promise.reject(new Error("synthetic"))' : "Promise.resolve()"}, 30000); } catch { if (!${reject}) throw new Error('unexpected rejection'); }`;
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", program],
      { timeout: 2000, encoding: "utf8" },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  }
});
