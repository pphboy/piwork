import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPublication, imageChecks, hostedChecks, sdkChecks } from './publish-fastapi-htmx-base.mjs';
import { dependencyChecks, assertRemoteIdentity } from './publish-web-base.mjs';

function fixture() {
  const candidate = { state: 'candidate', contractVersion: 1, platform: 'linux/amd64', reference: 'docker.io/pphboy/piwork-fastapi-htmx-base:fixed',
    inputHash: 'input', imageId: 'sha256:' + 'a'.repeat(64), commit: 'commit', modified: true };
  const image = { Id: candidate.imageId, Os: 'linux', Architecture: 'amd64', Config: { User: '10001:10001', Labels: {
    'io.piwork.web-base.contract': '1', 'io.piwork.web-base.stack': 'python-fastapi-htmx-sqlite', 'io.piwork.web-base.input-sha256': 'input',
    'org.opencontainers.image.revision': 'commit', 'io.piwork.source.modified': 'true' } } };
  const report = checks => ({ passed: true, imageId: candidate.imageId, inputHash: 'input', checks });
  const sdk = { summary: { status: 'partial', expected: 2, passed: 2, errors: [], skipped: [] },
    results: [{ tests: sdkChecks.map(name => ({ name, action: 'pass' })) }], identity: { images: { candidate: { id: candidate.imageId } } } };
  return [candidate, image, report(imageChecks), { ...report(dependencyChecks), internalRegistry: true }, report(hostedChecks), sdk, 'input'];
}
test('publication requires the exact candidate and all actual acceptance groups', () => {
  verifyPublication(...fixture());
  const missing = fixture();
  missing[2].checks = [];
  assert.throws(() => verifyPublication(...missing), /Missing validation/);
  const oldImage = fixture();
  oldImage[5].identity.images.candidate.id = 'old';
  assert.throws(() => verifyPublication(...oldImage), /different image/);
  const failedSDK = fixture();
  failedSDK[5].results[0].tests[0].action = 'fail';
  assert.throws(() => verifyPublication(...failedSDK), /Missing SDK/);
});
test('fixed remote tag conflicts cannot replace published content', () => {
  const manifest = { schemaVersion: 2, config: { digest: 'sha256:' + 'b'.repeat(64) } };
  assert.throws(() => assertRemoteIdentity(manifest, 'sha256:' + 'a'.repeat(64)), /different content/);
});
