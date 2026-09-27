import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import type { CoreStore } from "@piwork/core-store";
import { PiPackageInputError } from "@piwork/pi-package";
import { receivePiPackageUpload } from "./upload.js";

test("package upload rejects oversized or unsupported headers before reading the body", async () => {
  const headers = { "content-type": "application/zip", "content-length": String(256 * 1024 * 1024 + 1),
    "x-piwork-sha256": "a".repeat(64), "x-piwork-package-source": "zip", "x-piwork-package-name": "tools.zip" };
  const input = { store: {} as CoreStore, dataDirectory: "/unused", actorId: "operator", scope: { kind: "core" as const } };
  await assert.rejects(receivePiPackageUpload({ ...input, request: { headers } as unknown as IncomingMessage }),
    (error: unknown) => error instanceof PiPackageInputError && error.code === "PI_PACKAGE_LIMIT_EXCEEDED");
  await assert.rejects(receivePiPackageUpload({ ...input, request: { headers: { ...headers, "content-type": "text/plain" } } as unknown as IncomingMessage }),
    (error: unknown) => error instanceof PiPackageInputError && error.code === "PI_PACKAGE_UNSUPPORTED_MEDIA_TYPE");
});

test("a disconnected ZIP upload removes its partial spool", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-upload-disconnect-"));
  try {
    const request = Readable.from((async function* () { yield Buffer.from("partial"); throw new Error("client disconnected"); })()) as unknown as IncomingMessage;
    request.headers = { "content-type": "application/zip", "content-length": "100",
      "x-piwork-sha256": "a".repeat(64), "x-piwork-package-source": "zip", "x-piwork-package-name": "tools.zip" };
    await assert.rejects(receivePiPackageUpload({ request, store: {} as CoreStore, dataDirectory: root,
      actorId: "operator", scope: { kind: "core" } }), /client disconnected/);
    assert.deepEqual(await readdir(join(root, "pi-packages", "uploads")), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
