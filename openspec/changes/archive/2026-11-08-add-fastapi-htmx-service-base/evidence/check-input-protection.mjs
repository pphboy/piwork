// Reproduce the controlled browser failures used in this change's local acceptance.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const original = new URL('../../../../scripts/check-fastapi-htmx-base.mjs', import.meta.url);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
let source = readFileSync(original, 'utf8').replace(/from '([^']+)'/g, (match, spec) =>
  spec.startsWith('.') ? `from '${new URL(spec, original).href}'` : match);
const before = "  docker('restart', container);\n  await ready(address);\n  await expect(page.getByText('Changed page structure around your day.')).toBeVisible({ timeout: 15000 });";
assert(source.includes(before), 'The base fixture changed; review this historical acceptance adapter');
source = source.replace(before, `  await page.evaluate(() => {
    const input = document.createElement('input'); input.type='file'; input.id='synthetic-file-selection'; document.body.append(input);
  });
  await page.locator('#synthetic-file-selection').setInputFiles({name:'synthetic.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
  docker('restart', container);
  await ready(address);
  await expect(page.locator('[data-piwork-status]')).toContainText('finish the current operation');
  await expect(page.getByText('Build a little structure around your day.')).toBeVisible();
  await page.evaluate(() => {
    window.originalSetItem=Storage.prototype.setItem;
    Storage.prototype.setItem=function(){throw new Error('controlled storage failure');};
    document.getElementById('synthetic-file-selection').remove();
  });
  await expect(page.locator('[data-piwork-status]')).toContainText('could not be saved');
  await expect(page.getByLabel('Todo title')).toHaveValue('draft stays');
  await expect(page.getByText('Build a little structure around your day.')).toBeVisible();
  await page.evaluate(() => {Storage.prototype.setItem=window.originalSetItem;});
  await expect(page.getByText('Changed page structure around your day.')).toBeVisible({timeout:15000});`);
const marker = "  assert.notEqual(changed.frontendVersion, initial.frontendVersion);";
assert(source.includes(marker));
source = source.replace(marker, marker + `
  const previous=JSON.parse(python("from pathlib import Path;print(Path('/var/data/workspace/apps/sample/.build/previous.json').read_text())"));
  assert.equal(previous.codeVersion, initial.codeVersion);
  assert.equal(previous.environmentHash, initial.environmentHash);
  python("import json;from pathlib import Path;r=Path('/var/data/workspace/apps/sample');v=json.loads((r/'.build/previous.json').read_text());(r/'templates/page.html').write_bytes((r/'.build/releases'/v['release']/'templates/page.html').read_bytes());assert Path(v['python']).is_file()");
  docker('restart',container);
  await ready(address);
  await expect(page.getByText('Build a little structure around your day.')).toBeVisible({timeout:15000});
  await expect(page.getByText('Agent shared state',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Todo title')).toHaveValue('draft stays');
  assert.equal((await (await fetch(address+'/api/runtime-version')).json()).codeVersion,initial.codeVersion);`);
source = source.replace("'ready-page-adoption', 'restart-data'",
  "'ready-page-adoption', 'restart-data', 'unrestorable-file-protected', 'storage-failure-no-reload', 'previous-code-dependency-restoration'");
const generated = new URL('../../../../dist/fastapi-htmx-base/check-input-protection.mjs', import.meta.url);
writeFileSync(generated, source);
const result = spawnSync(process.execPath, [fileURLToPath(generated)], { cwd: root, stdio: 'inherit' });
assert.equal(result.status, 0);
