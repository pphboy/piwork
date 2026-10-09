import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { renderPublishScript, remoteConfigIdentity } from './docker-publish-preflight.mjs';

const roles = ['core', 'cli', 'agent', 'fileHelper', 'snapshotHelper'];
const manifest = { releaseVersion: '1', sourceCommit: 'a'.repeat(40), sourceModified: true, sourceInputHash: 'b'.repeat(64), desktopUIHash: 'c'.repeat(64), images: Object.fromEntries(roles.map((role, i) => [role, { reference: `docker.io/pphboy/piwork-${role.toLowerCase()}:reviewed`, imageId: 'sha256:' + String(i + 1).repeat(64), platform: 'linux/amd64', protocolLabels: {} }])) };

test('remote config identity selects only a unique linux/amd64 manifest', () => {
  const config = { config: { digest: manifest.images.core.imageId } };
  assert.equal(remoteConfigIdentity(config), manifest.images.core.imageId);
  assert.equal(remoteConfigIdentity([{ Descriptor: { platform: { os: 'linux', architecture: 'amd64' } }, SchemaV2Manifest: config }]), manifest.images.core.imageId);
  for (const value of [{}, { config: { digest: 'unknown' } }, [], [{ Descriptor: { platform: { os: 'linux', architecture: 'arm64' } }, SchemaV2Manifest: config }]]) assert.throws(() => remoteConfigIdentity(value));
});

test('executable publisher preflights ALL roles and fails closed before any push', async t => {
  const base = mkdtempSync(join(tmpdir(), 'piwork-publish-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  writeFileSync(join(base, 'manifest-fixture.json'), JSON.stringify(manifest));
  // The Docker mock exercises the actual generated shell; no registry writes occur.
  writeFileSync(join(base, 'docker'), `#!/usr/bin/env node
const fs=require('fs'); const args=process.argv.slice(2); const m=JSON.parse(fs.readFileSync(process.env.FIXTURE_MANIFEST));
const ref=args.at(-1); const role=Object.keys(m.images).find(k=>m.images[k].reference===ref); const im=m.images[role]; const mode=process.env.FIXTURE_MODE;
fs.appendFileSync(process.env.FIXTURE_CALLS, args[0]+' '+(role||'')+'\\n');
if(args[0]==='image') {
 const labels=[m.releaseVersion,m.sourceCommit,String(m.sourceModified),m.sourceInputHash,...Object.values(im.protocolLabels),...(role==='cli'?[m.desktopUIHash]:[])];
 console.log([mode==='retag'&&role==='snapshotHelper'?'sha256:changed':im.imageId,im.platform,...labels].join('|'));
} else if(args[0]==='manifest') {
 if(role==='snapshotHelper'&&['missing','auth','network','unknown'].includes(mode)) { console.error(mode==='missing'?'no such manifest: '+ref:mode==='auth'?'unauthorized: authentication required':mode==='network'?'connection timeout':'unknown remote result'); process.exitCode=1; }
 else console.log(JSON.stringify({config:{digest:mode==='conflict'&&role==='snapshotHelper'?'sha256:'+'0'.repeat(64):im.imageId}}));
} else if(args[0]==='run') {
 if(mode==='invalid-identity') { process.exitCode=1; } else { const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(data.config.digest); }
}
`, { mode: 0o755 });
  for (const mode of ['valid', 'missing', 'retag', 'conflict', 'auth', 'network', 'unknown', 'invalid-identity', 'tampered']) await t.test(mode, () => {
    writeFileSync(join(base, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    writeFileSync(join(base, 'push-commands.sh'), renderPublishScript(manifest), { mode: 0o755 });
    if (mode === 'tampered') writeFileSync(join(base, 'release-manifest.json'), '{}');
    const calls = join(base, 'calls'); writeFileSync(calls, '');
    const environment = { ...process.env, PATH: base + ':' + process.env.PATH, FIXTURE_MODE: mode, FIXTURE_MANIFEST: join(base, 'manifest-fixture.json'), FIXTURE_CALLS: calls };
    for (const flag of ['--check', '--push']) {
      writeFileSync(calls, '');
      const result = spawnSync('sh', [join(base, 'push-commands.sh'), flag], { env: environment, encoding: 'utf8' });
      const success = ['valid', 'missing'].includes(mode);
      assert.equal(result.status === 0, success, result.stderr);
      const log = readFileSync(calls, 'utf8').trim().split('\n');
      const pushes = log.filter(line => line.startsWith('push '));
      assert.equal(pushes.length, success && flag === '--push' ? 5 : 0);
      if (pushes.length) assert(log.indexOf('manifest snapshotHelper') < log.findIndex(line => line.startsWith('push ')));
    }
  });
});
