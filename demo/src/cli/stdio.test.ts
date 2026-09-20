import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { installEpipeGuard } from "./stdio.js";

function epipe(): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error("write EPIPE");
  error.code = "EPIPE";
  return error;
}

describe("installEpipeGuard", () => {
  it("exits quietly when the downstream pipe closes", () => {
    const stream = new PassThrough();
    const exits: number[] = [];
    installEpipeGuard(stream, (code) => exits.push(code));

    stream.emit("error", epipe());

    assert.deepEqual(exits, [0]);
  });

  it("rethrows any other stream error so real failures stay visible", () => {
    const stream = new PassThrough();
    const exits: number[] = [];
    installEpipeGuard(stream, (code) => exits.push(code));

    const failure: NodeJS.ErrnoException = new Error("disk on fire");
    failure.code = "EIO";

    assert.throws(() => stream.emit("error", failure), /disk on fire/);
    assert.deepEqual(exits, []);
  });
});
