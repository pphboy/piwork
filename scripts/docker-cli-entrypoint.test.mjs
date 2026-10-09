import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'piwork-cli-entrypoint-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const bin = join(base, 'bin'); mkdirSync(bin);
  const helper = join(base, 'wait-core');
  writeFileSync(helper, readFileSync(new URL('../deploy/docker/wait-core.sh', import.meta.url)), { mode: 0o755 });
  const entrypoint = join(base, 'entrypoint');
  writeFileSync(entrypoint, readFileSync(new URL('../deploy/docker/cli-entrypoint.sh', import.meta.url), 'utf8').replace('/usr/local/libexec/piwork/wait-core', helper), { mode: 0o755 });
  writeFileSync(join(bin, 'piwork-cli'), '#!/bin/sh\nprintf "forwarded:"\nprintf " <%s>" "$@"\nprintf "\\n"\nexit "${FIXTURE_EXIT:-0}"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
case "$*" in *'/readyz?profile=docker-delivery'*) ;; *) exit 3 ;; esac
case "$FIXTURE_MODE" in
  ready) printf 200 ;;
  redirect) printf 302 ;;
  pending) if test -e "$FIXTURE_STATE/attempt"; then printf 200; else touch "$FIXTURE_STATE/attempt"; printf 503; fi ;;
  unavailable) exit 7 ;;
  invalid) exit 3 ;;
  stalled) exec /bin/sleep 30 ;;
esac
`, { mode: 0o755 });
  writeFileSync(join(bin, 'date'), `#!/bin/sh
value=0
test ! -e "$FIXTURE_STATE/clock" || value=$(cat "$FIXTURE_STATE/clock")
printf '%s\\n' "$value"
printf '%s\\n' "$((value + \${FIXTURE_CLOCK_STEP:-1}))" > "$FIXTURE_STATE/clock"
`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PIWORK_CORE_URL: 'http://localhost:7171', FIXTURE_STATE: base, FIXTURE_MODE: 'ready' };
  const run = (args = [], extra = {}) => spawnSync('/bin/sh', [entrypoint, ...args], { env: { ...env, ...extra }, input: 'echo terminal-fixture\nexit\n', encoding: 'utf8', timeout: 4000 });
  return { base, bin, entrypoint, env, run };
}

test('explicit commands bypass readiness and preserve arguments and exit code', t => {
  const { run } = fixture(t);
  for (const args of [['--help'], ['--version'], ['work', 'create', '--name', 'two words'], ['desktop', '--no-open']]) {
    const result = run(args, { PIWORK_CORE_URL: 'http://secret@example.invalid', FIXTURE_MODE: 'stalled', FIXTURE_EXIT: '7' });
    assert.equal(result.status, 7);
    assert(result.stdout.includes('forwarded:'));
    for (const arg of args) assert(result.stdout.includes(`<${arg}>`));
    assert(!result.stdout.includes('terminal-fixture'));
  }
});

test('default startup waits for complete readiness before entering a terminal', t => {
  for (const mode of ['ready', 'pending']) {
    const { run } = fixture(t);
    const result = run([], { FIXTURE_MODE: mode });
    assert.equal(result.status, 0, result.stderr);
    assert(result.stdout.includes('Core is ready.'));
    assert(result.stdout.includes('terminal-fixture'));
    assert(!result.stdout.includes('forwarded:'));
  }
});

test('failed, redirected or invalid readiness cannot open the terminal or leak values', t => {
  for (const extra of [
    { FIXTURE_MODE: 'unavailable', FIXTURE_CLOCK_STEP: '301' },
    { FIXTURE_MODE: 'redirect', FIXTURE_CLOCK_STEP: '301' },
    { FIXTURE_MODE: 'invalid' },
    { PIWORK_CORE_URL: 'http://user:synthetic-canary@example.invalid' },
    { PIWORK_CORE_URL: 'file:///synthetic-canary' },
    { PIWORK_CORE_URL: 'https://example.invalid/path?synthetic-canary' },
    { PIWORK_CORE_URL: 'http://localhost:65536' },
    { PIWORK_CORE_URL: '' },
  ]) {
    const { run } = fixture(t);
    const result = run([], extra);
    assert.equal(result.status, 1, result.stderr);
    assert(!result.stdout.includes('terminal-fixture'));
    assert(!`${result.stdout}${result.stderr}`.includes('synthetic-canary'));
    assert.match(result.stderr, /Core is not ready/);
  }
});

test('SIGTERM cancels a readiness wait and exits nonzero', async t => {
  const { entrypoint, env } = fixture(t);
  const child = spawn('/bin/sh', [entrypoint], { env: { ...env, FIXTURE_MODE: 'stalled' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  let output = ''; child.stdout.on('data', data => { output += data; });
  const result = new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal })));
  await new Promise(resolve => setTimeout(resolve, 100));
  child.kill('SIGTERM');
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('signal did not cancel readiness')), 3000));
  assert.equal((await Promise.race([result, timeout])).code, 143);
  assert(!output.includes('Core is ready'));
});
