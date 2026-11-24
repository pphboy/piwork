import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, expect } from '@playwright/test';

// The parent Native test owns the isolated Core, resource ledger and webapp.
// Synthetic credentials travel over stdin, never command arguments or logs.
let input = '';
for await (const chunk of process.stdin) input += chunk;
const fixture = JSON.parse(input);
const { origin, coreURL, authorization, workID, skillName, source = 'core', originalManifest, originalSupport, editedManifest, editedSupport, output } = fixture;
const { account = 'admin', password = 'development-fixture-pass' } = fixture;
const shots = process.env.PIWORK_TEST_SCREENSHOT_DIR || output;
await mkdir(shots, { recursive: true });
async function api(method, path, body) {
  const response = await fetch(coreURL + '/api/v1/' + path, { method, headers: {
    Authorization: authorization,
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, `${method} ${path} rejected (${response.status}): ${JSON.stringify(result)}`);
  return result;
}
async function operation(receipt) {
  await expect.poll(async () => (await api('GET', `operations/${receipt.operationId}`)).state,
    { timeout: 180_000 }).toBe('succeeded');
}
async function readFiles(id) {
  const result = await api('POST', `works/${id}/configuration/editor/read`, {
    files: [{ skillName, path: 'SKILL.md' }, { skillName, path: 'references/note.txt' }],
  });
  return Object.fromEntries(result.files.map(file => [file.path, file.text]));
}
async function sdkRead(id, stage) {
  const session = await api('POST', `works/${id}/sessions`, { idempotencyKey: `editor-${stage}-${id}` });
  const accepted = await api('POST', `works/${id}/runs`, {
    sessionId: session.sessionId, submissionKey: `sdk-${stage}-${id}`,
    prompt: 'Read the configured Skill and supporting file',
  });
  let run;
  await expect.poll(async () => {
    run = await api('GET', `works/${id}/runs/${accepted.run.runId}`);
    return run.state;
  },
    { timeout: 90_000 }).toBe(4);
  const hash = createHash('sha256').update(editedManifest).update('\0').update(editedSupport).digest('hex').slice(0, 16);
  assert.equal(run.finalText, 'skill-read:' + hash, 'SDK did not read the Work editor bytes');
}
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.PIWORK_TEST_BROWSER_BIN || chromium.executablePath() });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const browserErrors = [];
page.on('pageerror', error => browserErrors.push(error.message));
try {
  await page.goto(origin + '/login');
  await page.getByLabel('Account', { exact: true }).fill(account);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.works-page').waitFor();
  await page.locator(`[data-action="open-work"][data-id="${workID}"]`).first().click();
  await page.locator('.work-header').getByRole('button', { name: 'Work options', exact: true }).click();
  await page.locator('#modal').getByRole('menuitem', { name: 'Settings', exact: true }).click();

  // Add commits only the new name and must not save an unrelated local draft.
  const before = await api('GET', `works/${workID}/configuration`);
  const agentsDraft = before.desired.agentsMd + '\nKeep this unsaved while adding a Skill.\n';
  await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await page.locator('#agents-editor').fill(agentsDraft);
  await page.locator('[data-action="settings-section"][data-tab="Skills"]').click();
  await page.locator('[data-action="open-add-skill"]').first().click();
  if (source === 'local') {
    // One complete local directory; Core must not need a catalog entry.
    await page.evaluate(({ name, manifest, support }) => {
      const input = document.querySelector('#skill-directory-input');
      const transfer = new DataTransfer();
      for (const [relative, text] of [[`${name}/README.md`, '# Supporting readme'], [`${name}/SKILL.md`, manifest], [`${name}/references/note.txt`, support]]) {
        const file = new File([text], relative.split('/').pop(), { type: 'text/markdown' });
        Object.defineProperty(file, 'webkitRelativePath', { value: relative });
        transfer.items.add(file);
      }
      input.files = transfer.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, { name: skillName, manifest: originalManifest, support: originalSupport });
    const importResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/configuration/skills/import') && response.request().method() === 'POST', { timeout: 180_000 });
    await page.locator('#modal [data-action="confirm-add-skill"]').click();
    const importedResponse = await importResponse;
    assert.equal(importedResponse.status(), 200);
    assert.match(importedResponse.request().headers()['content-type'] || '', /^multipart\/form-data; boundary=/);
  } else {
    await page.locator(`#modal input[data-add-skill="${skillName}"]`).check();
    const addResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/configuration/editor') && response.request().method() === 'PATCH');
    await page.locator('#modal [data-action="confirm-add-skill"]').click();
    const addedResponse = await addResponse;
    assert.equal(addedResponse.status(), 200);
    assert.deepEqual(addedResponse.request().postDataJSON(), { addSkills: [skillName] });
  }
  await expect(page.locator('#settings-file-selector')).toHaveValue('SKILL.md');
  await expect(page.locator('#skill-file-editor')).toHaveValue(originalManifest);
  const afterAdd = await api('GET', `works/${workID}/configuration`);
  assert.equal(afterAdd.desired.agentsMd, before.desired.agentsMd);
  assert.equal(afterAdd.pendingApply, true);
  assert.equal(afterAdd.active.skills.includes(skillName), false);
  assert.equal(afterAdd.runtime.skills.some(skill => skill.name === skillName && skill.loaded), false);
  await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await expect(page.locator('#agents-editor')).toHaveValue(agentsDraft);
  await page.locator('[data-action="settings-section"][data-tab="Skills"]').click();
  await page.locator(`[data-action="settings-skill"][data-skill="${skillName}"]`).click();
  await expect(page.locator('#skill-file-editor')).toHaveValue(originalManifest);

  await page.locator('#skill-file-editor').fill(editedManifest);
  await page.locator('#settings-file-selector').selectOption('references/note.txt');
  await expect(page.locator('#skill-file-editor')).toHaveValue(originalSupport);
  await page.locator('#skill-file-editor').fill(editedSupport);
  await page.locator('[data-action="settings-section"][data-tab="AGENTS.md"]').click();
  await expect(page.locator('#agents-editor')).toHaveValue(agentsDraft);
  const saveResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/configuration/editor') && response.request().method() === 'PATCH');
  await page.locator('[data-action="save-config"]').click();
  const saved = await saveResponse;
  assert.equal(saved.status(), 200);
  const patch = saved.request().postDataJSON();
  assert.equal(patch.agentsMd, agentsDraft);
  assert.deepEqual(patch.skillFiles.map(file => file.path).sort(), ['SKILL.md', 'references/note.txt']);
  assert.deepEqual(await readFiles(workID), { 'SKILL.md': editedManifest, 'references/note.txt': editedSupport });
  const beforeApply = await api('GET', `works/${workID}/configuration`);
  assert.equal(beforeApply.pendingApply, true);
  assert.equal(beforeApply.active.skills.includes(skillName), false);
  await page.screenshot({ path: join(shots, 'settings-saved-pending.png') });

  const applyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/configuration/apply') && response.request().method() === 'POST');
  await page.locator('[data-action="apply-config"]').click();
  await operation(await (await applyResponse).json());
  await expect.poll(async () => (await api('GET', `works/${workID}/configuration`)).pendingApply,
    { timeout: 90_000 }).toBe(false);
  await sdkRead(workID, 'applied');
  await operation(await api('POST', `works/${workID}/stop`, { idempotencyKey: 'editor-browser-stop' }));
  await operation(await api('POST', `works/${workID}/start`, { idempotencyKey: 'editor-browser-restart' }));
  await sdkRead(workID, 'restarted');
  assert.deepEqual(await readFiles(workID), { 'SKILL.md': editedManifest, 'references/note.txt': editedSupport });

  // Export and import through the current browser UI, not a constructed archive.
  await operation(await api('POST', `works/${workID}/stop`, { idempotencyKey: 'editor-browser-export-stop' }));
  await page.locator('[data-action="back-work"]').click();
  await page.getByRole('heading', { name: 'This Work is stopped', exact: true }).waitFor({ timeout: 90_000 });
  await page.locator('.work-header').getByRole('button', { name: 'Work options', exact: true }).click();
  const downloadEvent = page.waitForEvent('download', { timeout: 180_000 });
  const exportResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${workID}/exports`) && response.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('menuitem', { name: 'Export Work', exact: true }).click();
  assert.equal((await exportResponse).status(), 202);
  const download = await downloadEvent;
  const archive = join(output, 'settings-browser.work');
  await download.saveAs(archive);
  assert.equal(await download.failure(), null);
  const bytes = await readFile(archive);
  assert.equal(bytes.subarray(0, 8).toString(), 'PIWORK2\n');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Works', exact: true }).click();
  await page.getByRole('button', { name: 'Import Work', exact: true }).click();
  await page.locator('#work-file-input').setInputFiles(archive);
  await page.locator('#modal .import-result').waitFor({ timeout: 30_000 });
  await expect(page.locator('#modal [data-action="confirm-import"]')).toBeEnabled();
  await page.locator('#import-name').fill('Editor imported Work');
  const importResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/_desktop/api/work-imports' && response.request().method() === 'POST', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Import Work', exact: true }).last().click();
  const imported = await (await importResponse).json();
  await operation(imported);
  assert.equal((await api('GET', `works/${imported.workId}`)).observedState, 'stopped');
  assert.deepEqual(await readFiles(imported.workId), { 'SKILL.md': editedManifest, 'references/note.txt': editedSupport });
  await operation(await api('POST', `works/${imported.workId}/start`, { idempotencyKey: 'editor-import-start' }));
  await sdkRead(imported.workId, 'imported');
  assert.deepEqual(browserErrors, []);
  console.log(JSON.stringify({ result: 'Work Settings browser/real Core round trip passed', files: 2,
    draftPreservedDuringAdd: true, sdkReadVerified: true, restartVerified: true,
    archiveBytes: bytes.length, importedStopped: true, importedSDKReadVerified: true }));
} catch (error) {
  await page.screenshot({ path: join(shots, 'settings-failure.png') }).catch(() => undefined);
  throw error;
} finally { await browser.close(); }
