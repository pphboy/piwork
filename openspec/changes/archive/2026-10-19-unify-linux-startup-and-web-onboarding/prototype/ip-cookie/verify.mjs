import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const fixtureRoot = join(root, 'dist/unify-linux-startup/ip-cookie');
// Keep the original all-compatibility gate result untouched.
const output = join(fixtureRoot, 'accepted-boundary');
const { values } = parseArgs({ options: {
  'server-ip': { type: 'string' },
  'browser-bin': { type: 'string', multiple: true },
} });
const serverIP = values['server-ip'] ?? Object.entries(networkInterfaces())
  .filter(([name]) => /^(eth|en|wl)/.test(name))
  .flatMap(([, addresses]) => addresses ?? [])
  .find(address => address.family === 'IPv4' && !address.internal)?.address;
assert(serverIP, 'Specify --server-ip with the server numeric LAN address.');
const executables = values['browser-bin'] ?? [
  join(fixtureRoot, 'browsers/chrome/opt/google/chrome/chrome'),
  join(fixtureRoot, 'browsers/edge/opt/microsoft/msedge/msedge'),
];
await mkdir(output, { recursive: true });
const binary = join(output, 'fixture');
execFileSync('go', ['build', '-o', binary, './openspec/changes/unify-linux-startup-and-web-onboarding/prototype/ip-cookie'], {
  cwd: root, env: { ...process.env, CGO_ENABLED: '0' }, stdio: ['ignore', 'ignore', 'inherit'],
});
const server = spawn(binary, ['--server-ip', serverIP], { stdio: ['ignore', 'pipe', 'inherit'] });
const exited = once(server, 'exit');
const lines = createInterface({ input: server.stdout });
const info = await Promise.race([
  once(lines, 'line').then(([line]) => JSON.parse(line)),
  exited.then(() => { throw new Error('Fixture exited before listening.'); }),
]);
lines.close();
const evidence = {
  recordedAt: new Date().toISOString(),
  node: process.version,
  serverIP,
  scope: 'Linux browsers on the same host, numeric non-loopback IP; synthetic apps, not a Core or remote-network acceptance.',
  browserSecurity: 'Default settings, no DNS, no proxy, no cookie/script injection, original application CSP.',
  browsers: [],
  gatePassed: false,
  supportedBoundaryPassed: false,
};
const limitations = new Set(['own-script-cookie-read', 'csrf-double-submit',
  'script-written-cookie-isolation', 'script-written-cookie-reaches-upstream']);
const check = (run, id, mode, passed, expected, observed) => {
  const classification = mode === 'raw' ? 'negative-control' : limitations.has(id) ? 'known-limitation' : 'supported';
  const item = { id, mode, passed, expected, observed, classification };
  run.checks.push(item);
  console.log(`${run.name}: ${passed ? 'PASS' : classification === 'known-limitation' ? 'LIMITATION' : 'FAIL'} ${mode} ${id}`);
};
const request = (page, path, method = 'GET') => page.evaluate(
  ([path, method]) => window.fixture.request(path, { method }), [path, method]);
const login = page => request(page, '/login', 'POST');
async function open(context, url) {
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  await page.goto(url + '/__fixture/authorize');
  await page.waitForFunction(() => !!window.fixture);
  return page;
}

try {
  for (const executablePath of executables) {
    const version = execFileSync(executablePath, ['--version'], { encoding: 'utf8' }).trim();
    const name = version.startsWith('Microsoft') ? 'edge' : version.startsWith('Google') ? 'chrome' : 'chromium';
    const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-proxy-server'] });
    const run = { name, version, engineVersion: browser.version(), checks: [] };
    evidence.browsers.push(run);
    try {
      // Control: ordinary browser cookie forwarding preserves scripts but crosses ports.
      const raw = await browser.newContext();
      try {
        const a = await open(raw, info.raw.a);
        const b = await open(raw, info.raw.b);
        await login(a);
        const baseline = await a.evaluate(() => window.fixture.csrf());
        assert.equal(baseline.status, 200, 'Direct forwarding must prove the unmodified app works.');
        check(run, 'csrf-before-second-app', 'raw', baseline.status === 200, 200, baseline.status);
        const leaked = await b.evaluate(() => window.fixture.cookie('csrftoken'));
        assert.equal(leaked, 'a-synthetic-csrf');
        check(run, 'script-cookie-isolation', 'raw', leaked === '', 'No cookie from Service A', 'Service B reads A synthetic CSRF cookie');
        await login(b);
        const overwritten = await request(a, '/api/protected');
        assert.equal(overwritten.status, 401);
        check(run, 'same-name-login-isolation', 'raw', overwritten.status === 200, 200, overwritten.status);
        await request(b, '/delete', 'POST');
        const deleted = await a.evaluate(() => window.fixture.cookie('csrftoken'));
        check(run, 'cross-service-delete-isolation', 'raw', deleted === 'a-synthetic-csrf', 'Service A keeps its cookie', deleted === '' ? 'Service B deletion also removes A cookie' : deleted);
      } finally {
        await raw.close();
      }

      // Candidate: host cookies stay in per-entry standard server jars, never raw in browser.
      const context = await browser.newContext();
      try {
        await context.addCookies([{ name: 'piwork-platform-fixture', value: 'synthetic-platform', url: info.jar.a, httpOnly: true, sameSite: 'Strict' }]);
        const a = await open(context, info.jar.a);
        const b = await open(context, info.jar.b);
        await login(a);
        await login(b);
        const authenticatedA = await request(a, '/api/protected');
        const authenticatedB = await request(b, '/api/protected');
        assert.equal(authenticatedA.status, 200);
        assert.equal(authenticatedB.status, 200);
        check(run, 'same-name-login-isolation', 'jar', authenticatedA.status === 200 && authenticatedB.status === 200, [200, 200], [authenticatedA.status, authenticatedB.status]);
        check(run, 'domain-cookie-login', 'jar', authenticatedA.body.domainCookie && authenticatedB.body.domainCookie, true, authenticatedA.body.domainCookie && authenticatedB.body.domainCookie);
        const cookiesA = await a.evaluate(() => document.cookie);
        const cookiesB = await b.evaluate(() => document.cookie);
        check(run, 'raw-app-secret-isolation', 'jar', cookiesB === '', 'No raw application cookies', cookiesB);
        check(run, 'own-script-cookie-read', 'jar', cookiesA.includes('csrftoken=a-synthetic-csrf'), 'Application reads its own csrftoken', cookiesA);
        const csrf = await a.evaluate(() => window.fixture.csrf());
        assert.equal(csrf.status, 403, 'The server jar alone cannot supply document.cookie.');
        check(run, 'csrf-double-submit', 'jar', csrf.status === 200, 200, csrf.status);

        await a.evaluate(() => { document.cookie = 'client_setting=a-client-written; Path=/; SameSite=Strict'; });
        const clientLeaked = await b.evaluate(() => window.fixture.cookie('client_setting'));
        assert.equal(clientLeaked, 'a-client-written');
        check(run, 'script-written-cookie-isolation', 'jar', clientLeaked === '', 'Service B cannot read A client cookie', 'Service B reads A client-written cookie');
        const echo = await request(a, '/api/echo?root=kept');
        check(run, 'script-written-cookie-reaches-upstream', 'jar', echo.body.cookies.includes('client_setting'), true, echo.body.cookies.includes('client_setting'));
        check(run, 'platform-and-route-cookie-filter', 'jar', !echo.body.cookies.some(name => name.startsWith('piwork-')), 'No platform/grant cookies at upstream', echo.body.cookies);
        check(run, 'root-path-and-query', 'jar', echo.body.path === '/api/echo' && echo.body.query === 'root=kept', '/api/echo?root=kept', `${echo.body.path}?${echo.body.query}`);
        const csp = (await a.request.get(info.jar.a)).headers()['content-security-policy'];
        check(run, 'application-csp-preserved', 'jar', csp.includes("script-src 'self'") && !csp.includes('unsafe-inline'), "script-src 'self'", csp);

        await a.evaluate(() => { localStorage.setItem('same-key', 'a'); });
        await b.evaluate(() => { localStorage.setItem('same-key', 'b'); });
        check(run, 'localstorage-origin-isolation', 'jar', await a.evaluate(() => localStorage.getItem('same-key')) === 'a', 'a', await a.evaluate(() => localStorage.getItem('same-key')));
        const foreignFrame = await a.evaluate(async origin => {
          const frame = document.createElement('iframe');
          frame.src = origin;
          document.body.append(frame);
          await new Promise(resolve => { frame.onload = resolve; });
          try { void frame.contentWindow.document.body.innerText; return 'readable'; }
          catch (error) { return error.name; }
        }, info.jar.b);
        check(run, 'dom-origin-isolation', 'jar', foreignFrame === 'SecurityError', 'SecurityError', foreignFrame);

        await request(a, '/scope', 'POST');
        const outsidePath = await request(a, '/api/echo');
        const insidePath = await request(a, '/scoped/echo');
        check(run, 'cookie-path', 'jar', outsidePath.body.scoped === '' && insidePath.body.scoped === 'a-scope', ['', 'a-scope'], [outsidePath.body.scoped, insidePath.body.scoped]);
        await request(a, '/expire', 'POST');
        const beforeExpiry = await request(a, '/api/echo');
        await new Promise(resolve => setTimeout(resolve, 1100));
        const afterExpiry = await request(a, '/api/echo');
        check(run, 'cookie-expiry', 'jar', beforeExpiry.body.cookies.includes('short') && !afterExpiry.body.cookies.includes('short'), [true, false], [beforeExpiry.body.cookies.includes('short'), afterExpiry.body.cookies.includes('short')]);
        const redirect = await request(a, '/redirect');
        check(run, 'logical-origin-redirect', 'jar', redirect.body.query === 'redirect=kept', 'redirect=kept', redirect.body.query);
        const websocket = await a.evaluate(() => window.fixture.websocket());
        check(run, 'websocket-handshake-cookie', 'jar', websocket === 'authenticated:a', 'authenticated:a', websocket);
        const event = await a.evaluate(() => window.fixture.event());
        check(run, 'sse-cookie', 'jar', event === 'authenticated:a', 'authenticated:a', event);

        // A separate tab/iframe uses the same entry and its server-side login.
        const tab = await context.newPage();
        await tab.goto(info.jar.a);
        await tab.waitForFunction(() => !!window.fixture);
        check(run, 'independent-tab-login', 'jar', (await request(tab, '/api/protected')).status === 200, 200, (await request(tab, '/api/protected')).status);
        await request(b, '/delete', 'POST');
        const aAfterDelete = await request(a, '/api/protected');
        const bAfterDelete = await request(b, '/api/protected');
        check(run, 'cookie-deletion-partition', 'jar', aAfterDelete.status === 200 && bAfterDelete.status === 401, [200, 401], [aAfterDelete.status, bAfterDelete.status]);
        await a.screenshot({ path: join(output, `${name}-jar.png`) });
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  }
  evidence.gatePassed = evidence.browsers.length === 2 && evidence.browsers.every(run => run.checks.every(check => check.passed));
  evidence.supportedBoundaryPassed = evidence.browsers.length === 2
    && new Set(evidence.browsers.map(run => run.name)).size === 2
    && evidence.browsers.every(run => run.checks.filter(check => check.classification === 'supported').every(check => check.passed)
      && [...limitations].every(id => run.checks.some(check => check.id === id && !check.passed)));
} catch (error) {
  evidence.error = String(error);
  throw error;
} finally {
  server.kill('SIGTERM');
  await exited;
  await writeFile(join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
}
console.log(`Original all-compatibility gate: ${evidence.gatePassed ? 'PASS' : 'FAIL'}; accepted first-version boundary: ${evidence.supportedBoundaryPassed ? 'PASS' : 'FAIL'}. Evidence: dist/unify-linux-startup/ip-cookie/accepted-boundary/result.json`);
if (!evidence.supportedBoundaryPassed) process.exitCode = 1;
