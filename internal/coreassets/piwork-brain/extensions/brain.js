import { request } from "node:http";

const definitions = {
  brain_service: ["discover", "query", "action", "action_get", "job_get", "verify"],
  brain_feedback: ["events", "request_get", "wait", "finish", "cancel"],
  brain_experience: ["list", "stage", "commit", "status", "recall", "read", "revise", "invalidate"],
  brain_package_update: ["prepare", "status"],
};

/** This is a local Pi extension package. All authority lives in agentd. */
export default function (pi) {
  for (const [name, operations] of Object.entries(definitions)) {
    pi.registerTool({ name, label: name,
      description: `Piwork ${name.slice(6)}. Operations: ${operations.join(", ")}. Read brain.md and references/service-contract.md for the fixed verified workflow.`,
      parameters: { type: "object", properties: {
        operation: { type: "string", enum: operations },
        serviceName: { type: "string" }, name: { type: "string" }, id: { type: "string" },
        input: {}, expectedStateVersion: { type: ["string", "null"] },
        limit: { type: "integer", minimum: 1, maximum: 100 }, cursor: { type: "string" },
        waitRef: { type: "object" }, state: { type: "string", enum: ["completed", "failed", "needs_attention"] },
        result: { type: "string" }, evidenceIds: { type: "array", items: { type: "string" } },
        entry: { type: "object" }, userPreference: { type: "boolean" },
        entryId: { type: "string" }, query: { type: "string" }, reason: { type: "string" },
        expectedVersion: { type: "integer", minimum: 0 },
        submissionKey: { type: "string" }, verificationGoal: { type: "string" },
        verificationTarget: { type: "object", properties: {
          contractVersion: { const: 1 }, toolName: { type: "string", pattern: "^package:piwork-brain:[a-zA-Z][a-zA-Z0-9_-]{0,63}$" },
          input: { type: "object" }, checkNames: { type: "array", minItems: 1, maxItems: 8, uniqueItems: true, items: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$" } },
        }, required: ["contractVersion", "toolName", "input", "checkNames"], additionalProperties: false },
      }, required: ["operation"], additionalProperties: false },
      async execute(_callId, input, signal) {
        const value = await callHost(name, input, signal);
        return { content: [{ type: "text", text: JSON.stringify(value) }], details: value };
      },
    });
  }
}

export function callHost(tool, input, signal) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(input);
    const call = request({ socketPath: "/tmp/piwork-brain.sock", path: `/internal/v1/brain/${tool}`,
      method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) }, signal }, (response) => {
      const chunks = []; let size = 0;
      response.on("data", (chunk) => { size += chunk.length; if (size > 1048576) call.destroy(new Error("Brain response exceeds limit")); else chunks.push(chunk); });
      response.on("end", () => { try { const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (response.statusCode !== 200) reject(new Error(`${value.code ?? "BRAIN_UNAVAILABLE"}: ${value.message ?? "Brain operation failed"}`)); else resolve(value);
      } catch (error) { reject(error); } });
    });
    call.setTimeout(30000, () => call.destroy(new Error("Brain operation timed out; query the original identity")));
    call.on("error", reject); call.end(body);
  });
}
