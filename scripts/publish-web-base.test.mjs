import assert from 'node:assert/strict';
import { test } from 'node:test';
import { baseChecks, coreChecks, dependencyChecks, toolChecks, configIdentity, assertRemoteIdentity, verifyCandidate } from './publish-web-base.mjs';

function fixture() {
  const imageId = 'sha256:' + 'a'.repeat(64), hash = 'b'.repeat(64), commit = 'c'.repeat(40);
  return {
    candidate: { contractVersion: 2, reference: 'docker.io/pphboy/piwork-web-base:0.2.0-fixture', platform: 'linux/amd64', imageId, inputHash: hash, commit },
    image: { Id: imageId, Architecture: 'amd64', Os: 'linux', Config: { User: '10001:10001', Labels: { 'io.piwork.web-base.contract': '2', 'io.piwork.web-base.input-sha256': hash, 'org.opencontainers.image.revision': commit } } },
    validation: { passed: true, imageId, inputHash: hash, internalNetwork: true, checks: [...baseChecks] },
    coreValidation: { passed: true, imageId, inputHash: hash, checks: [...coreChecks] }, hash,
    starterValidation: { passed: true, imageId, inputHash: hash, internalNetwork: true, template: 'web-app', checks: [...baseChecks] },
    dependencyValidation: { passed: true, imageId, inputHash: hash, internalRegistry: true, checks: [...dependencyChecks] },
    toolsValidation: { passed: true, imageId, inputHash: hash, checks: [...toolChecks] },
  };
}
test('publication binds local tag, source inputs and actual browser/SDK evidence', () => {
  const call = f => verifyCandidate(f.candidate, f.image, f.validation, f.coreValidation, f.hash, f.starterValidation, f.dependencyValidation, f.toolsValidation);
  call(fixture());
  for (const change of [f => { f.image.Id = 'sha256:' + 'd'.repeat(64); }, f => { f.hash = 'e'.repeat(64); },
    f => { f.validation.internalNetwork = false; }, f => { f.coreValidation.checks = ['real-sdk-mcp']; }, f => { f.coreValidation.passed = false; },
    f => { f.coreValidation.imageId = 'sha256:' + 'f'.repeat(64); }, f => { f.starterValidation = undefined; },
    f => { f.candidate.contractVersion = 1; }, f => { f.validation.checks = ['frontend-tests', 'backend-tests', 'build']; },
    f => { f.dependencyValidation = undefined; }, f => { f.dependencyValidation.internalRegistry = false; },
    f => { f.coreValidation.checks = f.coreValidation.checks.filter(name => name !== 'draft-storage-failure-retained'); },
    f => { f.coreValidation.checks = f.coreValidation.checks.filter(name => name !== 'page-helper-auto-adoption'); },
    f => { f.toolsValidation.checks = f.toolsValidation.checks.filter(name => name !== 'page-helper-resource-version'); },
    f => { f.toolsValidation.checks = f.toolsValidation.checks.filter(name => name !== 'invalid-page-manifest-no-ready'); },
    f => { f.toolsValidation.passed = false; }]) {
    const f = fixture(); change(f); assert.throws(() => call(f));
  }
});
test('unknown registry records do not become proof of a matching fixed image', () => {
  assert.equal(configIdentity({ schemaVersion: 2, config: { digest: 'sha256:' + 'a'.repeat(64) } }), 'sha256:' + 'a'.repeat(64));
  for (const manifest of [{}, { schemaVersion: 2, config: { digest: 'not-a-digest' } }, { schemaVersion: 1 }]) assert.throws(() => configIdentity(manifest));
});

test('a fixed remote tag belonging to different content stops publication preflight', () => {
  const imageId = 'sha256:' + 'a'.repeat(64);
  assertRemoteIdentity({ schemaVersion: 2, config: { digest: imageId } }, imageId);
  assert.throws(() => assertRemoteIdentity({ schemaVersion: 2, config: { digest: 'sha256:' + 'b'.repeat(64) } }, imageId), /different content/);
  assert.throws(() => assertRemoteIdentity({}, imageId), /Unknown remote image identity/);
});
