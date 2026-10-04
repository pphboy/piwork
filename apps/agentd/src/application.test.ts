import assert from "node:assert/strict";
import test from "node:test";
import { status } from "@grpc/grpc-js";
import { assertAgentPeerIdentity, mcpTools, selectPackageTools, skillVisibility } from "./application.js";
import type { McpBridge } from "@piwork/pi-adapter";

const expected = "core.g3.work-11111111-1111-4111-8111-111111111111.piwork";
const peerScope = { installationId: "installation-native", workId: "work-11111111-1111-4111-8111-111111111111", generation: 3, instanceId: "agent-current" };
const peerUri = "URI:spiffe://piwork/installation/installation-native/work/work-11111111-1111-4111-8111-111111111111/generation/3/instance/agent-current/role/core-client";

test("agent mTLS peer verification rejects plaintext, wrong Work, and stale generation identities", () => {
  assert.doesNotThrow(() => assertAgentPeerIdentity({
    transportSecurityType: "ssl",
    sslPeerCertificate: { subject: { CN: expected }, subjectaltname: `${peerUri}` },
  }, expected, peerScope));

  for (const context of [
    { transportSecurityType: "insecure" },
    { transportSecurityType: "ssl", sslPeerCertificate: { subject: { CN: "core.g3.work-other.piwork" } } },
    { transportSecurityType: "ssl", sslPeerCertificate: { subject: { CN: "core.g2.work-11111111-1111-4111-8111-111111111111.piwork" } } },
    ...["", peerUri.replace("installation-native", "installation-other"), peerUri.replace("work-11111111-1111-4111-8111-111111111111", "work-other"),
      peerUri.replace("generation/3", "generation/2"), peerUri.replace("agent-current", "agent-other"), peerUri.replace("core-client", "agent-service-client"), `${peerUri}, ${peerUri}`]
      .map((subjectaltname) => ({ transportSecurityType: "ssl", sslPeerCertificate: { subject: { CN: expected }, subjectaltname } })),
  ]) {
    assert.throws(
      () => assertAgentPeerIdentity(context, expected, peerScope),
      (error) => (error as { code?: number }).code === status.UNAUTHENTICATED,
    );
  }
});

test("Skill model visibility preserves metadata precedence and effective read policy", () => {
  assert.deepEqual(skillVisibility(true, []), {
    modelVisible: false,
    visibilityReason: "model-invocation-disabled",
  });
  assert.deepEqual(skillVisibility(false, []), {
    modelVisible: false,
    visibilityReason: "read-tools-disabled",
  });
  assert.deepEqual(skillVisibility(false, ["read"]), {
    modelVisible: true,
    visibilityReason: "",
  });
});

test("retained Work tool policy hides a denied built-in service tool", () => {
  const tools = ["service_list", "service_stop", "operation_get"].map((name) => ({ serverId: "work-services", name,
    namespacedName: `work-services.${name}`, modelName: `work-services__${name}`, inputSchema: {} }));
  const bridge = { listTools: () => tools } as unknown as McpBridge;
  assert.deepEqual(mcpTools(bridge, { allowed: [], denied: ["work-services.service_stop"] }).map((tool) => tool.canonicalName),
    ["work-services.service_list", "work-services.operation_get"]);
  assert.deepEqual(mcpTools({ listTools: () => [] } as unknown as McpBridge, { allowed: [], denied: [] }), []);
});

test("package tool policy maps canonical keys to native SDK names with deny precedence", () => {
  const tools = new Map([["package:@example/tools:hello", "hello"], ["package:@example/tools:other", "other"]]);
  assert.deepEqual(selectPackageTools(tools, { allowed: [], denied: ["package:@example/tools:other"] }, new Set(["read"])),
    [["package:@example/tools:hello", "hello"]]);
  assert.deepEqual(selectPackageTools(tools, { allowed: ["package:@example/tools:hello"], denied: ["package:@example/tools:hello"] }, new Set()), []);
  assert.throws(() => selectPackageTools(tools, { allowed: [], denied: [] }, new Set(["hello"])), /conflicts with existing tool/);
});
