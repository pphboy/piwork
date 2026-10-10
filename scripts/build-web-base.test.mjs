import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inputHash, source } from './build-web-base.mjs';

test('image inputs bind real tools and locks without a publication/README hash cycle', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'piwork-base-input-'));
  try {
    cpSync(source, temporary, { recursive: true });
    const original = inputHash(temporary);
    writeFileSync(join(temporary, 'README.md'), 'Updated usage and published digest.\n');
    writeFileSync(join(temporary, 'published.json'), '{"registryDigest":"synthetic"}\n');
    assert.equal(inputHash(temporary), original);
    writeFileSync(join(temporary, 'tools/piwork-web'), 'a changed launcher');
    assert.notEqual(inputHash(temporary), original);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
