import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_HOST, DEFAULT_PORT } from "../common/config.js";
import { defaultAddress, parseCliArgs, UsageError } from "./args.js";

describe("defaultAddress", () => {
  it("falls back to the daemon defaults", () => {
    assert.equal(defaultAddress({}), `${DEFAULT_HOST}:${DEFAULT_PORT}`);
  });

  it("honours PIWORK_HOST and PIWORK_PORT", () => {
    assert.equal(defaultAddress({ PIWORK_HOST: "10.0.0.5", PIWORK_PORT: "9000" }), "10.0.0.5:9000");
  });

  it("connects to loopback when the daemon is bound to every interface", () => {
    assert.equal(defaultAddress({ PIWORK_HOST: "0.0.0.0", PIWORK_PORT: "9000" }), `${DEFAULT_HOST}:9000`);
  });
});

describe("parseCliArgs", () => {
  it("defaults to the interactive loop", () => {
    const options = parseCliArgs([], {});
    assert.equal(options.command, "repl");
    assert.equal(options.showThinking, false);
    assert.equal(options.json, false);
    assert.equal(options.sessionId, undefined);
  });

  it("recognises subcommands", () => {
    assert.equal(parseCliArgs(["health"], {}).command, "health");
    assert.equal(parseCliArgs(["ask", "hi"], {}).command, "ask");
    assert.equal(parseCliArgs(["help"], {}).command, "help");
  });

  it("treats -h and --help as help from anywhere", () => {
    assert.equal(parseCliArgs(["-h"], {}).command, "help");
    assert.equal(parseCliArgs(["ask", "hi", "--help"], {}).command, "help");
  });

  it("parses flags in both separated and inline form", () => {
    const separated = parseCliArgs(["--addr", "host:1", "--session", "s1", "--cwd", "/tmp"], {});
    assert.equal(separated.address, "host:1");
    assert.equal(separated.sessionId, "s1");
    assert.equal(separated.cwd, "/tmp");

    const inline = parseCliArgs(["--addr=host:2"], {});
    assert.equal(inline.address, "host:2");
  });

  it("parses boolean flags", () => {
    const options = parseCliArgs(["--show-thinking", "--json"], {});
    assert.equal(options.showThinking, true);
    assert.equal(options.json, true);
  });

  it("joins the ask prompt from the remaining arguments", () => {
    assert.equal(parseCliArgs(["ask", "what", "is", "gRPC"], {}).prompt, "what is gRPC");
  });

  it("rejects an unknown command", () => {
    assert.throws(() => parseCliArgs(["chat"], {}), UsageError);
  });

  it("rejects an unknown option", () => {
    assert.throws(() => parseCliArgs(["--nope"], {}), UsageError);
  });

  it("rejects a flag without a value", () => {
    assert.throws(() => parseCliArgs(["--session"], {}), /missing value/);
  });

  it("requires a prompt for ask", () => {
    assert.throws(() => parseCliArgs(["ask"], {}), /requires a prompt/);
  });

  it("rejects stray positionals after a subcommand", () => {
    assert.throws(() => parseCliArgs(["health", "extra"], {}), /unexpected argument/);
  });
});
