import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { inputHash, root } from './build-web-base.mjs';

const candidate = JSON.parse(readFileSync(resolve(process.argv[2] || 'dist/web-base/candidate.json')));
assert.equal(candidate.inputHash, inputHash(), 'Rebuild the current image before running its tools tests');
const id = 'piwork-base-tools-' + randomUUID();
const volume = id + '-workspace';
const docker = args => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20 });
const actual = JSON.parse(docker(['image', 'inspect', candidate.reference]))[0];
assert.equal(actual.Id, candidate.imageId, 'The candidate tag no longer identifies the tested image');
assert.equal(actual.Config.Labels['io.piwork.web-base.input-sha256'], candidate.inputHash);
try {
  docker(['volume', 'create', '--label', `piwork.fixture=${id}`, volume]);
  docker(['run', '--rm', '--label', `piwork.fixture=${id}`, '--network', 'none', '--user', '0:0',
    '--mount', `type=volume,src=${volume},dst=/var/data/workspace`, '--entrypoint', 'sh', candidate.reference,
    '-c', 'mkdir -p /var/data/workspace/.tests; chown -R 10001:10001 /var/data/workspace']);
  const output = docker(['run', '--rm', '--label', `piwork.fixture=${id}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--mount', `type=volume,src=${volume},dst=/var/data/workspace`,
    '--mount', `type=bind,src=${join(root, 'deploy/images/web-base/test')},dst=/tests,readonly`,
    '--env', 'TMPDIR=/var/data/workspace/.tests', '--env', 'HOME=/var/data/workspace/.tests', '--entrypoint', 'python',
    candidate.reference, '-m', 'pytest', '-q', '-p', 'no:cacheprovider', '/tests']);
  process.stdout.write(output);
  writeFileSync(join(root, 'dist/web-base/tools-validation.json'), JSON.stringify({ passed: true, imageId: candidate.imageId,
    inputHash: candidate.inputHash, checks: ['checked-execution-cache', 'ui-business-environment-version', 'loaded-version-fixed', 'unchecked-startup-rejected', 'offline-rebuild-changed-input', 'page-helper-resource-version', 'page-file-set-compatibility', 'invalid-page-manifest-no-ready'] }, null, 2) + '\n');
} finally {
  docker(['volume', 'rm', volume]);
}
