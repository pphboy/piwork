import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_TOOLS,
  loadDaemonConfig,
  parsePort,
  parseTools,
} from "./config.js";

const ROOT = "/demo";

describe("parsePort", () => {
  it("defaults to the piwork container port", () => {
    assert.equal(parsePort(undefined), DEFAULT_PORT);
    assert.equal(parsePort("  "), DEFAULT_PORT);
  });

  it("accepts a valid override", () => {
    assert.equal(parsePort("9000"), 9000);
  });

  it("rejects values that are not a usable port", () => {
    for (const value of ["0", "65536", "abc", "80.5", "-1"]) {
      assert.throws(() => parsePort(value), /PIWORK_PORT/, `expected "${value}" to be rejected`);
    }
  });
});

describe("parseTools", () => {
  it("exposes the tools the daemon is expected to give sessions by default", () => {
    assert.deepEqual([...DEFAULT_TOOLS].sort(), ["bash", "edit", "find", "ls", "read"]);
  });

  it("falls back to the default tool set when the variable is unset", () => {
    assert.deepEqual(parseTools(undefined), [...DEFAULT_TOOLS]);
  });

  it("disables every tool for an explicitly empty value or none", () => {
    assert.deepEqual(parseTools(""), []);
    assert.deepEqual(parseTools("   "), []);
    assert.deepEqual(parseTools("NONE"), []);
  });

  it("splits a comma separated list and drops empty entries", () => {
    assert.deepEqual(parseTools("read, grep ,, ls"), ["read", "grep", "ls"]);
  });
});

describe("loadDaemonConfig", () => {
  it("applies defaults when the environment is empty", () => {
    const config = loadDaemonConfig({}, ROOT);
    assert.equal(config.host, DEFAULT_HOST);
    assert.equal(config.port, DEFAULT_PORT);
    assert.equal(config.provider, "anthropic");
    assert.equal(config.baseUrl, undefined);
    assert.equal(config.apiKey, undefined);
    assert.equal(config.model, undefined);
    assert.deepEqual(config.tools, [...DEFAULT_TOOLS]);
    assert.equal(config.logLevel, "info");
  });

  it("resolves relative paths against the demo root", () => {
    const config = loadDaemonConfig({}, ROOT);
    assert.equal(config.agentDir, "/demo/.piwork/agent");
    assert.equal(config.workspace, "/demo/.piwork/workspaces/default");
  });

  it("takes the proxy base url from ANTHROPIC_BASE_URL for the anthropic provider", () => {
    const config = loadDaemonConfig({ ANTHROPIC_BASE_URL: "https://proxy.example" }, ROOT);
    assert.equal(config.baseUrl, "https://proxy.example");
  });

  it("prefers PIWORK_BASE_URL over ANTHROPIC_BASE_URL", () => {
    const config = loadDaemonConfig(
      { PIWORK_BASE_URL: "https://piwork.example", ANTHROPIC_BASE_URL: "https://proxy.example" },
      ROOT,
    );
    assert.equal(config.baseUrl, "https://piwork.example");
  });

  it("ignores ANTHROPIC_BASE_URL when another provider is selected", () => {
    const config = loadDaemonConfig({ PIWORK_PROVIDER: "openai", ANTHROPIC_BASE_URL: "https://proxy.example" }, ROOT);
    assert.equal(config.baseUrl, undefined);
  });

  it("leaves ANTHROPIC_AUTH_TOKEN to pi instead of turning it into an api key", () => {
    // pi reads that variable itself and sends it as "Authorization: Bearer".
    // Mapping it to setRuntimeApiKey would switch the request to x-api-key and
    // break token based proxies, so this must stay undefined.
    const config = loadDaemonConfig({ ANTHROPIC_AUTH_TOKEN: "secret-token" }, ROOT);
    assert.equal(config.apiKey, undefined);
  });

  it("reads the provider specific api key variable", () => {
    assert.equal(loadDaemonConfig({ ANTHROPIC_API_KEY: "sk-a" }, ROOT).apiKey, "sk-a");
    assert.equal(loadDaemonConfig({ PIWORK_PROVIDER: "openai", OPENAI_API_KEY: "sk-o" }, ROOT).apiKey, "sk-o");
  });

  it("prefers PIWORK_API_KEY over the provider specific variable", () => {
    const config = loadDaemonConfig({ PIWORK_API_KEY: "generic", ANTHROPIC_API_KEY: "sk-a" }, ROOT);
    assert.equal(config.apiKey, "generic");
  });

  it("falls back to the default log level when one is invalid", () => {
    assert.equal(loadDaemonConfig({ PIWORK_LOG_LEVEL: "loud" }, ROOT).logLevel, "info");
    assert.equal(loadDaemonConfig({ PIWORK_LOG_LEVEL: "debug" }, ROOT).logLevel, "debug");
  });

  it("rejects an invalid port through the environment", () => {
    assert.throws(() => loadDaemonConfig({ PIWORK_PORT: "nope" }, ROOT), /PIWORK_PORT/);
  });
});
