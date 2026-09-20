import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CoreStore } from "@piwork/core-store";

const METADATA_KEY = "operator_credential";

export interface OperatorCredentialMetadata {
  readonly version: 1;
  readonly digest: string;
  readonly createdAt: string;
}

export function ensureOperatorCredential(store: CoreStore, path: string, now = new Date()): string {
  assertPrivateParent(path);
  if (existsSync(path)) {
    const credential = readProtectedCredential(path);
    const digest = credentialDigest(credential);
    const metadata = store.getControlMetadata<OperatorCredentialMetadata>(METADATA_KEY);
    if (metadata === undefined) {
      store.putControlMetadataIfAbsent(METADATA_KEY, { version: 1, digest, createdAt: now.toISOString() }, now.toISOString());
    } else if (!constantEqual(metadata.digest, digest)) {
      throw new Error("operator credential does not match persisted control metadata");
    }
    return credential;
  }
  const metadata = store.getControlMetadata<OperatorCredentialMetadata>(METADATA_KEY);
  if (metadata !== undefined) throw new Error("operator credential file is missing");
  const credential = randomBytes(32).toString("base64url");
  writeFileSync(path, `${credential}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  store.putControlMetadataIfAbsent(METADATA_KEY, {
    version: 1,
    digest: credentialDigest(credential),
    createdAt: now.toISOString(),
  }, now.toISOString());
  return credential;
}

export function readProtectedCredential(path: string): string {
  assertPrivateParent(path);
  const info = lstatSync(path);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("operator credential path must be a regular file, not a symbolic link");
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error("operator credential file permissions must be 0600");
  }
  const value = readFileSync(path, "utf8").replace(/[\r\n]+$/, "");
  if (value.length < 32) throw new Error("operator credential is malformed");
  return value;
}

function assertPrivateParent(path: string): void {
  const parent = lstatSync(dirname(path));
  if (parent.isSymbolicLink() || !parent.isDirectory()) throw new Error("operator credential parent must be a regular directory");
  if (process.platform !== "win32" && (parent.mode & 0o077) !== 0) {
    throw new Error("operator credential parent permissions must be 0700");
  }
}

export function verifyOperatorCredential(store: CoreStore, candidate: string): boolean {
  const metadata = store.getControlMetadata<OperatorCredentialMetadata>(METADATA_KEY);
  return metadata !== undefined && constantEqual(metadata.digest, credentialDigest(candidate));
}

function credentialDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
