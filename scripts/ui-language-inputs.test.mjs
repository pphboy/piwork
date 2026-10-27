// 构建输入 hash 测试：共享语言模块和两端词条必须影响对应应用的输入。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { consoleInputHash, desktopInputHash } from './build-cli.mjs';

const SHARED_I18N = 'export const LOCALES = ["zh-CN", "en"];\n';
const DESKTOP_CATALOG = 'export const catalog = { en: {}, "zh-CN": {} };\n';
const CONSOLE_CATALOG = 'export const catalog = { en: {}, "zh-CN": {} };\n';

function write(base, name, content) {
  mkdirSync(dirname(join(base, name)), { recursive: true });
  writeFileSync(join(base, name), content);
}

/** 构造 desktopInputHash / consoleInputHash 所需的最小合成输入树。 */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'piwork-ui-language-inputs-'));
  for (const directory of [
    'apps/desktop-webui/src/i18n',
    'apps/desktop-webui/public',
    'apps/desktop-webui/scripts',
    'apps/console-webui/src/i18n',
    'apps/console-webui/public',
    'apps/console-webui/scripts',
    'apps/ui-shared/assets',
  ]) {
    mkdirSync(join(base, directory), { recursive: true });
  }
  const files = {
    'package-lock.json': '{"lockfileVersion":3}\n',
    'apps/desktop-webui/tsconfig.json': '{}\n',
    'apps/desktop-webui/package.json': '{}\n',
    'apps/desktop-webui/src/i18n/catalog.js': DESKTOP_CATALOG,
    'apps/desktop-webui/public/index.html': '<!doctype html>\n',
    'apps/desktop-webui/scripts/copy-static.mjs': 'fixture copy\n',
    'scripts/sync-desktop-assets.mjs': 'fixture sync\n',
    'apps/console-webui/tsconfig.json': '{}\n',
    'apps/console-webui/package.json': '{}\n',
    'apps/console-webui/src/i18n/catalog.js': CONSOLE_CATALOG,
    'apps/console-webui/public/index.html': '<!doctype html>\n',
    'apps/console-webui/scripts/copy-static.mjs': 'fixture copy\n',
    'scripts/sync-console-assets.mjs': 'fixture sync\n',
    'apps/ui-shared/assets/piwork-logo.png': 'fixture logo\n',
    'apps/ui-shared/browser-crypto.js': 'fixture crypto\n',
    'apps/ui-shared/i18n.js': SHARED_I18N,
    'apps/ui-shared/boot.js': 'fixture boot\n',
    'apps/ui-shared/tokens.css': 'fixture tokens\n',
    'apps/ui-shared/controls.css': 'fixture controls\n',
  };
  for (const [name, content] of Object.entries(files)) write(base, name, content);
  return base;
}

function withFixture(run) {
  const base = fixture();
  try {
    run(base);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test('输入 hash 是稳定的 sha256', () => {
  withFixture((base) => {
    const desktop = desktopInputHash(base);
    const consoleHash = consoleInputHash(base);
    assert.match(desktop, /^[a-f0-9]{64}$/);
    assert.match(consoleHash, /^[a-f0-9]{64}$/);
    assert.equal(desktopInputHash(base), desktop);
    assert.equal(consoleInputHash(base), consoleHash);
  });
});

test('修改共享语言模块会同时改变两端输入 hash', () => {
  withFixture((base) => {
    const desktop = desktopInputHash(base);
    const consoleHash = consoleInputHash(base);
    write(base, 'apps/ui-shared/i18n.js', 'export const LOCALES = ["zh-CN", "en", "extra"];\n');
    assert.notEqual(desktopInputHash(base), desktop);
    assert.notEqual(consoleInputHash(base), consoleHash);

    write(base, 'apps/ui-shared/i18n.js', SHARED_I18N);
    assert.equal(desktopInputHash(base), desktop);
    assert.equal(consoleInputHash(base), consoleHash);
  });
});

test('修改 Desktop 词条只改变 Desktop 输入 hash', () => {
  withFixture((base) => {
    const desktop = desktopInputHash(base);
    const consoleHash = consoleInputHash(base);
    write(base, 'apps/desktop-webui/src/i18n/catalog.js', 'export const catalog = { en: { a: "A" }, "zh-CN": { a: "甲" } };\n');
    assert.notEqual(desktopInputHash(base), desktop);
    assert.equal(consoleInputHash(base), consoleHash);
  });
});

test('修改 Console 词条只改变 Console 输入 hash', () => {
  withFixture((base) => {
    const desktop = desktopInputHash(base);
    const consoleHash = consoleInputHash(base);
    write(base, 'apps/console-webui/src/i18n/catalog.js', 'export const catalog = { en: { a: "A" }, "zh-CN": { a: "甲" } };\n');
    assert.equal(desktopInputHash(base), desktop);
    assert.notEqual(consoleInputHash(base), consoleHash);
  });
});
