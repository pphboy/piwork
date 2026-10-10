import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseChecks, coreChecks, configIdentity, verifyCandidate } from './publish-web-base.mjs';

function fixture() {
  const imageId = 'sha256:' + 'a'.repeat(64), hash = 'b'.repeat(64), commit = 'c'.repeat(40);
  return {
    candidate: { reference: 'docker.io/pphboy/piwork-web-base:0.1.0-fixture', platform: 'linux/amd64', imageId, inputHash: hash, commit },
    image: { Id: imageId, Architecture: 'amd64', Os: 'linux', Config: { User: '10001:10001', Labels: { 'io.piwork.web-base.input-sha256': hash, 'org.opencontainers.image.revision': commit } } },
    validation: { passed: true, imageId, inputHash: hash, internalNetwork: true, checks: [...baseChecks] },
    coreValidation: { passed: true, imageId, inputHash: hash, checks: [...coreChecks] }, hash,
    starterValidation: { passed: true, imageId, inputHash: hash, internalNetwork: true, template: 'web-app', checks: [...baseChecks] },
  };
}
test('publication binds local tag, source inputs and actual browser/SDK evidence', () => {
  const call = f => verifyCandidate(f.candidate, f.image, f.validation, f.coreValidation, f.hash, f.starterValidation);
  call(fixture());
  for (const change of [f => { f.image.Id = 'sha256:' + 'd'.repeat(64); }, f => { f.hash = 'e'.repeat(64); },
    f => { f.validation.internalNetwork = false; }, f => { f.coreValidation.checks = ['real-sdk-mcp']; }, f => { f.coreValidation.passed = false; },
    f => { f.coreValidation.imageId = 'sha256:' + 'f'.repeat(64); }, f => { f.starterValidation = undefined; }]) {
    const f = fixture(); change(f); assert.throws(() => call(f));
  }
});
test('unknown registry records do not become proof of a matching fixed image', () => {
  assert.equal(configIdentity({ schemaVersion: 2, config: { digest: 'sha256:' + 'a'.repeat(64) } }), 'sha256:' + 'a'.repeat(64));
  for (const manifest of [{}, { schemaVersion: 2, config: { digest: 'not-a-digest' } }, { schemaVersion: 1 }]) assert.throws(() => configIdentity(manifest));
});
