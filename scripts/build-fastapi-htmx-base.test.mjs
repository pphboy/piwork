import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { source, inputHash, verifyVendor, verifyEvidence } from './build-fastapi-htmx-base.mjs';

test('browser inputs change candidate identity and corrupt vendor bytes fail', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'piwork-fastapi-inputs-'));
  try {
    cpSync(source, temporary, { recursive: true });
    const before = inputHash(temporary);
    const file = join(temporary, 'vendor/bootstrap.min.css');
    writeFileSync(file, readFileSync(file, 'utf8') + '\n/* changed */\n');
    assert.notEqual(inputHash(temporary), before);
    assert.throws(() => verifyVendor(temporary), /Vendor integrity/);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test('evidence must match current candidate and cannot mark local bytes published', () => {
  const candidate = { state: 'candidate', inputHash: 'input', imageId: 'image' };
  const image = { Id: 'image', Config: { User: '10001:10001', Labels: { 'io.piwork.web-base.input-sha256': 'input' } } };
  const report = { passed: true, inputHash: 'input', imageId: 'image' };
  verifyEvidence(candidate, image, [report], 'input');
  assert.throws(() => verifyEvidence(candidate, image, [report], 'changed'));
  assert.throws(() => verifyEvidence(candidate, image, [{ ...report, imageId: 'old' }], 'input'));
  assert.throws(() => verifyEvidence({ ...candidate, state: 'published' }, image, [report], 'input'));
  assert.throws(() => verifyEvidence(candidate, image, [], 'input'));
});
