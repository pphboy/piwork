import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { root, inputHash, verifyVendor, verifyEvidence } from './build-fastapi-htmx-base.mjs';
import { assertRemoteIdentity, dependencyChecks } from './publish-web-base.mjs';

export const imageChecks = ['python-runtime-tests', 'readonly-nonroot', 'sqlite3', 'offline-local-assets', 'htmx-form',
  'shared-agent-state', 'prefix-deep-refresh', 'query-failure-recovery', 'draft-focus', 'checked-copy-fixed',
  'ready-page-adoption', 'restart-data', 'repaired-release-reuse', 'single-form-request', 'unreceived-request-discarded', 'sent-input-cleared', 'no-form-storage', 'no-navigation-input-restore', 'failed-request-no-replay', 'page-update-after-unconfirmed-request', 'previous-code-dependency-restoration'];
export const hostedChecks = ['real-sdk', 'real-cli-desktop', 'real-hosted-prefix', 'two-independent-services',
  'page-business-edits', 'draft-focus', 'query-recovery', 'safe-initialization', 'normal-core-restart'];
export const sdkChecks = ['TestNativeBrainFastAPIWorkstationFeedbackExperienceAndActualCandidateBehavior', 'TestNativeBrainFastAPIAcceptedActionGapRecovery'];

export function verifyPublication(candidate, image, validation, dependencies, hosted, sdk, hash = inputHash()) {
  verifyEvidence(candidate, image, [validation, dependencies, hosted], hash);
  assert.equal(candidate.contractVersion, 1);
  assert.equal(candidate.platform, 'linux/amd64');
  assert.match(candidate.reference, /^docker\.io\/pphboy\/piwork-fastapi-htmx-base:[A-Za-z0-9._-]+$/);
  assert.match(candidate.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, 'amd64');
  assert.equal(image.Config.Labels['io.piwork.web-base.contract'], '1');
  assert.equal(image.Config.Labels['io.piwork.web-base.stack'], 'python-fastapi-htmx-sqlite');
  assert.equal(image.Config.Labels['org.opencontainers.image.revision'], candidate.commit);
  assert.equal(image.Config.Labels['io.piwork.source.modified'], String(candidate.modified));
  for (const [report, names] of [[validation, imageChecks], [dependencies, dependencyChecks], [hosted, hostedChecks]]) {
    for (const name of names) assert(report.checks.includes(name), 'Missing validation: ' + name);
  }
  assert.equal(dependencies.internalRegistry, true);
  assert.equal(sdk.summary.status, 'partial');
  assert.equal(sdk.summary.expected, sdkChecks.length);
  assert.equal(sdk.summary.passed, sdkChecks.length);
  assert.deepEqual(sdk.summary.errors, []);
  assert.deepEqual(sdk.summary.skipped, []);
  const tests = sdk.results.flatMap(unit => unit.tests);
  for (const name of sdkChecks) assert(tests.some(test => test.name === name && test.action === 'pass'), 'Missing SDK check: ' + name);
  assert(Object.values(sdk.identity.images).some(record => record.id === candidate.imageId), 'SDK used a different image');
}

const probe = `import hashlib,json,subprocess,threading,time,urllib.request
from pathlib import Path
import fastapi,jinja2,multipart,httpx,uvicorn
root=Path('/opt/piwork-web-base')
environment=json.loads((root/'environment.json').read_text())
resources=json.loads((root/'vendor/manifest.json').read_text())
for item in resources['files']:
 assert hashlib.sha256((root/'vendor'/item['file']).read_bytes()).hexdigest()==item['sha256']
assert subprocess.check_output(['sqlite3',':memory:','select 42'],text=True).strip()=='42'
subprocess.run(['piwork-fastapi','--help'],check=True,stdout=subprocess.DEVNULL)
app=fastapi.FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
@app.get('/health')
def health(): return {'ready':True}
server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=8080,log_level='critical'))
thread=threading.Thread(target=server.run,daemon=True);thread.start()
for attempt in range(100):
 try:
  assert json.load(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=1))['ready'] is True
  break
 except OSError:time.sleep(.05)
else:raise RuntimeError('Anonymous image did not serve HTTP')
server.should_exit=True;thread.join(5)
print(json.dumps({'inputHash':environment['inputHash'],'stack':environment['stack'],'fastapiVersion':fastapi.__version__,'browserResourcesVerified':True,'httpReady':True}))
`;

export function publish({ push = false, sdkReport = null } = {}) {
  const directory = join(root, 'dist/fastapi-htmx-base');
  const load = name => JSON.parse(readFileSync(join(directory, name)));
  const candidate = load('candidate.json');
  const docker = (args, options = {}) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8 << 20, ...options });
  verifyVendor();
  const image = JSON.parse(docker(['image', 'inspect', candidate.reference]))[0];
  verifyPublication(candidate, image, load('validation.json'), load('dependencies-validation.json'), load('core-validation.json'), sdkReport ? JSON.parse(readFileSync(resolve(root, sdkReport))) : load('core-integration-5/result.json'));
  const repository = candidate.reference.slice(0, candidate.reference.lastIndexOf(':'));
  function manifest(reference) {
    let value = JSON.parse(docker(['buildx', 'imagetools', 'inspect', reference, '--raw']));
    if (value.manifests) {
      const matching = value.manifests.filter(item => item.platform?.os === 'linux' && item.platform?.architecture === 'amd64');
      assert.equal(matching.length, 1, 'Ambiguous remote linux/amd64 image');
      value = JSON.parse(docker(['buildx', 'imagetools', 'inspect', `${repository}@${matching[0].digest}`, '--raw']));
    }
    return value;
  }
  const remote = spawnSync('docker', ['buildx', 'imagetools', 'inspect', candidate.reference, '--raw'], { encoding: 'utf8' });
  if (remote.status === 0) assertRemoteIdentity(manifest(candidate.reference), candidate.imageId);
  else if (!/not found|manifest unknown|404/i.test(remote.stderr) || /unauthorized|denied|timeout|network|connection/i.test(remote.stderr)) {
    throw new Error('Remote availability could not be confirmed; no push performed: ' + remote.stderr.trim());
  }
  if (!push) {
    console.log('Candidate evidence and remote identity verified; no push performed.');
    return;
  }
  docker(['push', candidate.reference], { stdio: 'inherit' });
  assertRemoteIdentity(manifest(candidate.reference), candidate.imageId);
  const descriptor = JSON.parse(docker(['buildx', 'imagetools', 'inspect', candidate.reference, '--format', '{{json .Manifest}}']));
  assert.match(descriptor.digest, /^sha256:[a-f0-9]{64}$/);
  const fixed = `${candidate.reference}@${descriptor.digest}`;
  const anonymous = mkdtempSync(join(directory, 'anonymous-'));
  try {
    writeFileSync(join(anonymous, 'config.json'), '{}\n', { mode: 0o600 });
    const environment = { ...process.env, DOCKER_CONFIG: anonymous };
    delete environment.DOCKER_AUTH_CONFIG;
    docker(['--config', anonymous, 'pull', fixed], { env: environment, stdio: 'inherit' });
    const actual = JSON.parse(docker(['--config', anonymous, 'image', 'inspect', fixed], { env: environment }))[0];
    assert.equal(actual.Id, candidate.imageId);
    const verification = JSON.parse(docker(['--config', anonymous, 'run', '--rm', '--network', 'none', '--read-only',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--entrypoint', 'python', fixed, '-c', probe], { env: environment }));
    assert.equal(verification.inputHash, candidate.inputHash);
    assert.equal(verification.stack, candidate.environment.stack);
    assert.equal(verification.httpReady, true);
    const record = { ...candidate, state: 'published', registryDigest: descriptor.digest, fixedReference: fixed,
      anonymousReadable: true, anonymousRuntime: verification, checkedAt: new Date().toISOString() };
    writeFileSync(join(directory, 'published.json'), JSON.stringify(record, null, 2) + '\n');
    console.log('Published and anonymously verified ' + fixed);
    return record;
  } finally { rmSync(anonymous, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf('--sdk-report');
  if (index !== -1) assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), 'Missing SDK report path');
  publish({ push: process.argv.includes('--push'), sdkReport: index === -1 ? null : process.argv[index + 1] });
}
