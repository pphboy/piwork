import dependency from "fixture-dependency";
export default function (pi) {
  let sessionStarted = false;
  pi.on("session_start", async () => { sessionStarted = true; });
  pi.registerTool({ name: "fixture_hello", label: "Fixture hello", description: "Offline package fixture",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: `v1:${dependency}:${sessionStarted ? "started" : "pending"}` }] }) });
}
