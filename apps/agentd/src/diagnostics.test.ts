import assert from "node:assert/strict";
import test from "node:test";
import { emitAgentDiagnostic } from "./diagnostics.js";

test("agent diagnostic logger emits only allowlisted fields and static text", () => {
  const lines: string[] = [];
  emitAgentDiagnostic({
    stage: "skill-load", outcome: "failed", code: "SKILL_LOAD_FAILED",
    correlationId: "operation-1", workId: "work-1", skillName: "code-review",
  }, { write: (line) => lines.push(line) });

  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(event.component, "agentd");
  assert.equal(event.code, "SKILL_LOAD_FAILED");
  assert.equal(event.stage, "skill-load");
  assert.equal(event.skillName, "code-review");
  assert.equal(event.message, "Work context Skill initialization failed.");
  assert.doesNotMatch(lines[0]!, /token=|\/host\/|SKILL\.md/);

  emitAgentDiagnostic({
    stage: "skill-load", outcome: "failed", code: "SKILL_LOAD_FAILED",
    correlationId: "operation-1", skillName: "# forged SKILL.md token=abc",
  }, { write: (line) => lines.push(line) });
  assert.doesNotMatch(lines[1]!, /forged|SKILL\.md|token=abc/);

  emitAgentDiagnostic({
    stage: "skill-load", outcome: "started", code: "SKILL_LOAD_FAILED",
    correlationId: "operation-2", workId: "work-2",
  }, { write: (line) => lines.push(line) });
  emitAgentDiagnostic({
    stage: "skill-load", outcome: "succeeded", code: "SKILL_LOAD_FAILED",
    correlationId: "operation-2", workId: "work-2",
  }, { write: (line) => lines.push(line) });
  assert.equal(JSON.parse(lines[2]!).outcome, "started");
  assert.equal(JSON.parse(lines[3]!).message, "Work context Skills were validated by the SDK.");
  emitAgentDiagnostic({
    stage: "mcp-initialize", outcome: "succeeded", code: "MCP_INITIALIZATION_FAILED",
    correlationId: "operation-3", workId: "work-3",
  }, { write: (line) => lines.push(line) });
  assert.equal(JSON.parse(lines[4]!).message, "Required Work MCP tools were initialized.");
  emitAgentDiagnostic({
    stage: "package-load", outcome: "failed", code: "PACKAGE_LOAD_FAILED",
    correlationId: "operation-4", workId: "work-4",
  }, { write: (line) => lines.push(line) });
  assert.equal(JSON.parse(lines[5]!).code, "PACKAGE_LOAD_FAILED");
  assert.equal(JSON.parse(lines[5]!).stage, "package-load");
  assert.doesNotMatch(lines[5]!, /token=|\/host\//);
});
