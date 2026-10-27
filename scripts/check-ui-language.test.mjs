// 语言资源检查的负例/正例测试。全部使用 scripts/testdata/ui-language 下的合成夹具。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractUsedKeys, isProductText, scanSourceText, validateCatalogPair, validateSourceKeys } from './check-ui-language.mjs';
import { sharedTerms } from './testdata/ui-language/catalogs/shared.js';
import { catalog as desktopValid } from './testdata/ui-language/catalogs/desktop-valid.js';
import { catalog as consoleValid } from './testdata/ui-language/catalogs/console-valid.js';
import { catalog as desktopMissingZh } from './testdata/ui-language/catalogs/desktop-missing-zh.js';
import { catalog as desktopExtraZh } from './testdata/ui-language/catalogs/desktop-extra-zh.js';
import { catalog as desktopEmptyValue } from './testdata/ui-language/catalogs/desktop-empty-value.js';
import { catalog as desktopPlaceholderMismatch } from './testdata/ui-language/catalogs/desktop-placeholder-mismatch.js';
import { catalog as desktopSharedTermMismatch } from './testdata/ui-language/catalogs/desktop-shared-term-mismatch.js';
import { catalog as desktopMissingShared } from './testdata/ui-language/catalogs/desktop-missing-shared.js';

const fixtureBase = join(dirname(fileURLToPath(import.meta.url)), 'testdata/ui-language');

function validate(desktop, consoleCatalog = consoleValid, terms = sharedTerms) {
  return validateCatalogPair({ desktop, console: consoleCatalog, sharedTerms: terms, base: fixtureBase });
}

function source(name) {
  return readFileSync(join(fixtureBase, 'sources', name), 'utf8');
}

test('完整的词条对没有错误', () => {
  assert.deepEqual(validate(desktopValid), []);
});

test('英文有而中文缺失的 key 会被报告', () => {
  const errors = validate(desktopMissingZh);
  assert(errors.some((error) => error.key === 'view.hello' && error.message.includes('缺少 zh-CN')));
});

test('中文多出的 key 会被报告', () => {
  const errors = validate(desktopExtraZh);
  assert(errors.some((error) => error.key === 'view.extra' && error.message.includes('多出')));
});

test('空值会被报告', () => {
  const errors = validate(desktopEmptyValue);
  assert(errors.some((error) => error.key === 'view.empty' && error.message.includes('为空')));
});

test('占位符参数名不同或重复都会被报告', () => {
  const errors = validate(desktopPlaceholderMismatch);
  const parameter = errors.find((error) => error.key === 'view.parameterName');
  const duplicate = errors.find((error) => error.key === 'view.duplicate');
  assert(parameter && parameter.message.includes('占位符不一致'));
  assert(duplicate && duplicate.message.includes('占位符不一致'));
  assert(parameter.message.includes('name'));
  assert(parameter.message.includes('nom'));
});

test('共享术语值不一致会被报告', () => {
  const errors = validate(desktopSharedTermMismatch);
  assert(errors.some((error) => error.key === 'term.core' && error.message.includes('共享术语')));
});

test('缺少共享术语会被报告', () => {
  const errors = validate(desktopMissingShared);
  assert(errors.some((error) => error.key === 'term.work' && error.message.includes('缺少共享术语')));
});

test('新增的普通英文句子会被硬编码检查发现', () => {
  const findings = scanSourceText(source('hardcoded.ts'), { file: 'hardcoded.ts' });
  const texts = findings.map((finding) => finding.text);
  assert(texts.includes('Work not found'));
  assert(texts.includes('Created ${…}'));
  assert(texts.includes('Save file'));
  assert(findings.every((finding) => finding.line > 0 && finding.file === 'hardcoded.ts'));
});

test('界面标签、单词和 HTML 中的硬编码会被发现', () => {
  for (const source of [
    'const label = "Save";', 'const label = "Retry";', 'const saveButton = "Save";',
    'const label = "save changes";', 'const html = "<button>Save</button>";', 'const html = "<span>Save</span>";',
    'const html = `<input placeholder="Search">`;', 'const html = `<button aria-label="Close"></button>`;',
  ]) assert.equal(scanSourceText(source, { file: 'new-ui.ts' }).length, 1, source);
});

test('URL、路径、选择器、协议值、命令和正则不会被误报', () => {
  assert.deepEqual(scanSourceText(source('allowed-technical.ts'), { file: 'allowed-technical.ts' }), []);
});

test('行注释 i18n-exempt 可以豁免同一行的文案', () => {
  assert.deepEqual(scanSourceText(source('exempt-line.ts'), { file: 'exempt-line.ts' }), []);
});

test('文件顶部 i18n-file-exempt 可以豁免整个文件', () => {
  assert.deepEqual(scanSourceText(source('exempt-file.ts'), { file: 'exempt-file.ts' }), []);
});

test('EXEMPT 列表按文件与精确文本匹配，不影响其他文件', () => {
  const text = "const a = 'Generated protocol label';\nconst b = 'Work failed';\n";
  const exempt = [{ file: 'fixture.ts', text: 'Generated protocol label', reason: '合成例外' }];
  const matched = scanSourceText(text, { file: 'fixture.ts', exempt });
  assert.equal(matched.length, 1);
  assert.equal(matched[0].text, 'Work failed');
  const otherFile = scanSourceText(text, { file: 'other.ts', exempt });
  assert.equal(otherFile.length, 2);
});

test('用户内容示例会命中启发式，但可以通过明确例外排除', () => {
  const file = 'user-content.ts';
  const text = source(file);
  const withoutExemption = scanSourceText(text, { file });
  assert(withoutExemption.length >= 2);
  const withExemption = scanSourceText(text, {
    file,
    exempt: [
      { file, text: 'Quarterly planning', reason: '用户内容示例' },
      { file, text: 'Release notes draft.md', reason: '文件名示例' },
    ],
  });
  assert.deepEqual(withExemption, []);
});

test('源码引用的词条 key 必须存在', () => {
  const keys = new Set(['view.title', 'setup.component.docker', 'setup.component.agent']);
  assert.deepEqual(validateSourceKeys("const a = t('view.title');", keys, 'fixture.ts'), []);
  const missing = validateSourceKeys("const a = t('view.missing');", keys, 'fixture.ts');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].key, 'view.missing');
  assert.equal(missing[0].line, 1);
  assert.equal(missing[0].message, '使用的词条 key 不存在');
});

test('动态词条前缀必须有匹配词条', () => {
  const keys = new Set(['setup.component.docker', 'setup.component.agent']);
  const source = "const label = t('setup.component.' + name);";
  assert.deepEqual(validateSourceKeys(source, keys, 'fixture.ts'), []);
  const errors = validateSourceKeys("const label = t('setup.unknown.' + name);", keys, 'fixture.ts');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, '动态词条前缀没有匹配的词条');
});

test('LocalizedMessage 的显式组件 key 也被审计', () => {
  const keys = new Set(['d.error.known']);
  const source = "const message = new LocalizedMessage('d.error.nope', { name });";
  const { used } = extractUsedKeys(source);
  assert.deepEqual(used.map((item) => item.key), ['d.error.nope']);
  assert.equal(validateSourceKeys(source, keys, 'fixture.ts').length, 1);
});

test('产品文案判定保留技术值', () => {
  assert.equal(isProductText('Work not found'), true);
  assert.equal(isProductText('This folder is empty.'), true);
  assert.equal(isProductText('in_progress'), false);
  assert.equal(isProductText('application/json'), false);
  assert.equal(isProductText('Work'), false);
});
