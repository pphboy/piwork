import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { assertEnvironmentLocks, inputHash, source } from './build-web-base.mjs';

test('image inputs bind real tools and locks without a publication/README hash cycle', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'piwork-base-input-'));
  try {
    cpSync(source, temporary, { recursive: true });
    const original = inputHash(temporary);
    writeFileSync(join(temporary, 'README.md'), 'Updated usage and published digest.\n');
    writeFileSync(join(temporary, 'published.json'), '{"registryDigest":"synthetic"}\n');
    assert.equal(inputHash(temporary), original);
    writeFileSync(join(temporary, 'tools/page-client.js'), 'a changed local page adapter');
    const changedPage = inputHash(temporary);
    assert.notEqual(changedPage, original);
    writeFileSync(join(temporary, 'requirements.lock'), 'changed locked dependencies');
    assert.notEqual(inputHash(temporary), changedPage);
    writeFileSync(join(temporary, 'tools/piwork-web'), 'a changed launcher');
    assert.notEqual(inputHash(temporary), original);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('a changed direct requirement cannot silently build with a stale base lock', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'piwork-base-lock-'));
  try {
    cpSync(source, temporary, { recursive: true });
    assertEnvironmentLocks(temporary);
    writeFileSync(join(temporary, 'requirements.in'), 'nicegui==0.0.0\n');
    assert.throws(() => assertEnvironmentLocks(temporary), /exact lock differ/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
