import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium, expect } from '@playwright/test';

test('language picker owns its child layer, reanchors explicitly and retains standalone mode', async () => {
  const server = createServer(async (request, response) => {
    if (request.url !== '/') {
      const name = request.url.slice(1);
      if (!['i18n.js', 'controls.css', 'tokens.css'].includes(name)) { response.writeHead(404).end();
      return;
      }
      response.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : 'text/css');
      response.end(await readFile(new URL(name, import.meta.url)));
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(`<!doctype html><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/controls.css">
      <div id="parent" style="position:absolute;right:8px;top:12px;width:248px;background:white">
      <button id="language" data-language-trigger="menu" data-language-submenu="true" role="menuitem">Language</button></div>
      <button id="outside" style="position:absolute;top:200px">Outside</button>
      <script type="module">
      import {createLanguagePicker} from '/i18n.js';
      window.chosen = '';
      window.picker = createLanguagePicker({label:()=> 'Language',choices:()=>[
        {id:'auto',label:'Follow browser',selected:true}, {id:'zh-CN',label:'简体中文'}, {id:'en',label:'English'}
      ],onChoose: id => window.chosen = id});
      document.addEventListener('click', event => {
        if (event.target.id === 'language') picker.open(event.target, {parentMenu:document.querySelector('#parent')});
      });
      window.ready=true;</script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch(process.env.PIWORK_TEST_BROWSER_BIN
    ? { headless: true, executablePath: process.env.PIWORK_TEST_BROWSER_BIN }
    : { headless: true, channel: 'chromium' });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 480 } });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.ready);
    await page.locator('#language').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('option')).toHaveCount(3);
    await expect(page.locator('#language')).toHaveAttribute('aria-expanded', 'true');
    const bounds = await page.locator('.language-picker').boundingBox();
    assert.ok(bounds.x >= 8 && bounds.x + bounds.width <= 352);
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('.language-picker')).toHaveCount(0);
    await expect(page.locator('#language')).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => {
      const old = document.querySelector('#parent');
      const next = old.cloneNode(true);
      old.replaceWith(next);
      picker.reanchor(next.querySelector('#language'), next);
    });
    await expect(page.locator('#language')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#language')).toBeFocused();
    await page.locator('#language').click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    assert.equal(await page.evaluate(() => window.chosen), 'en');
    await expect(page.locator('#parent')).toBeVisible();
    await page.locator('#language').click();
    await page.locator('#outside').click();
    await expect(page.locator('.language-picker')).toHaveCount(0);
    await page.locator('#language').click();
    await page.evaluate(() => { document.querySelector('#parent').remove();
    picker.reanchor(null, null);
    });

    await expect(page.locator('.language-picker')).toHaveCount(0);
    await page.evaluate(() => picker.open(document.querySelector('#outside')));
    assert.equal(await page.evaluate(() => picker.isSubmenu), false);
    await page.keyboard.press('Tab');
    await expect(page.locator('.language-picker')).toHaveCount(0);
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
