import assert from "node:assert/strict";
import { X509Certificate } from "node:crypto";
import { copyFile, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { certificateIsCurrent, certificateIsTrusted, ensureGenerationTlsIdentity } from "./mtls.js";

test("installation CA and generation identities are persisted with scoped names and restrictive host directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "piwork-mtls-"));
  try {
    const first = ensureGenerationTlsIdentity({
      runtimeDirectory: root,
      installationId: "installation-a",
      workId: "work-11111111-1111-4111-8111-111111111111",
      generation: 3,
    });
    const repeated = ensureGenerationTlsIdentity({
      runtimeDirectory: root,
      installationId: "installation-a",
      workId: "work-11111111-1111-4111-8111-111111111111",
      generation: 3,
    });
    assert.deepEqual(repeated, first);
    const server = new X509Certificate(await readFile(first.serverCertificatePath));
    const client = new X509Certificate(await readFile(first.clientCertificatePath));
    assert.match(server.subject, /CN=agent\.g3\.work-11111111-1111-4111-8111-111111111111\.piwork/);
    assert.match(server.subjectAltName ?? "", /spiffe:\/\/piwork\/work\/work-11111111-1111-4111-8111-111111111111\/generation\/3\/agent/);
    assert.match(client.subject, /CN=core\.g3\.work-11111111-1111-4111-8111-111111111111\.piwork/);
    assert.equal(certificateIsCurrent(client), true);
    assert.equal(certificateIsCurrent(client, new Date("2100-01-01T00:00:00.000Z")), false);
    const other = ensureGenerationTlsIdentity({
      runtimeDirectory: join(root, "other-installation"),
      installationId: "installation-b",
      workId: "work-22222222-2222-4222-8222-222222222222",
      generation: 1,
    });
    const trustedAuthority = new X509Certificate(await readFile(first.caCertificatePath));
    const untrustedClient = new X509Certificate(await readFile(other.clientCertificatePath));
    assert.equal(certificateIsTrusted(client, trustedAuthority), true);
    assert.equal(certificateIsTrusted(untrustedClient, trustedAuthority), false);
    const originalFingerprint = client.fingerprint256;
    await copyFile(other.clientCertificatePath, first.clientCertificatePath);
    ensureGenerationTlsIdentity({
      runtimeDirectory: root,
      installationId: "installation-a",
      workId: "work-11111111-1111-4111-8111-111111111111",
      generation: 3,
    });
    const rotated = new X509Certificate(await readFile(first.clientCertificatePath));
    assert.equal(certificateIsTrusted(rotated, trustedAuthority), true);
    assert.notEqual(rotated.fingerprint256, originalFingerprint);
    assert.equal((await lstat(join(root, "pki"))).mode & 0o777, 0o700);
    assert.equal((await lstat(first.clientPrivateKeyPath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
