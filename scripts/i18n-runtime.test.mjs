// 共享语言规则的运行时测试：locale 映射、偏好顺序、显式选择、存储失败与参数插值。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOCALE_STORAGE_KEY,
  createI18n,
  interpolate,
  matchLocale,
  normalizeLocale,
  resolveLocale,
} from '../apps/ui-shared/i18n.js';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const state = { getThrows: false, setThrows: false, writes: 0 };
  return {
    data,
    state,
    getItem(key) {
      if (state.getThrows) throw new Error('storage denied');
      return data.has(key) ? data.get(key) : null;
    },
    removeItem(key) {
      if (state.setThrows) throw new Error('storage denied');
      data.delete(key);
    },
    setItem(key, value) {
      if (state.setThrows) throw new Error('storage denied');
      state.writes += 1;
      data.set(key, String(value));
    },
  };
}

const catalog = {
  en: { greeting: 'Hello {name}', 'only.en': 'English only' },
  'zh-CN': { greeting: '你好，{name}' },
};

test('语言标签映射到两种受支持语言', () => {
  const cases = [
    ['zh-CN', 'zh-CN'],
    ['zh-TW', 'zh-CN'],
    ['zh-Hans', 'zh-CN'],
    ['zh-Hant-TW', 'zh-CN'],
    ['zh', 'zh-CN'],
    ['en-US', 'en'],
    ['EN-gb', 'en'],
    ['en', 'en'],
    ['fr-FR', null],
    ['', null],
    ['   ', null],
    [null, null],
    [undefined, null],
    [42, null],
  ];
  for (const [value, expected] of cases) {
    assert.equal(normalizeLocale(value), expected, `normalizeLocale(${JSON.stringify(value)})`);
  }
});

test('浏览器语言偏好按顺序匹配，全部不匹配时回退英文', () => {
  assert.equal(matchLocale(['fr-FR', 'zh-TW', 'en-US']), 'zh-CN');
  assert.equal(matchLocale(['de-DE', 'en-GB']), 'en');
  assert.equal(matchLocale(['de-DE', 'fr-FR']), 'en');
  assert.equal(matchLocale([]), 'en');
  assert.equal(matchLocale(undefined), 'en');
  assert.equal(matchLocale('zh-CN'), 'en');
});

test('同源已保存的显式选择优先于浏览器语言', () => {
  const storage = fakeStorage({ [LOCALE_STORAGE_KEY]: 'en' });
  assert.deepEqual(resolveLocale({ storage, languages: ['zh-CN'] }), { locale: 'en', saved: true });
});

test('损坏或不受支持的保存值不覆盖浏览器偏好', () => {
  for (const value of ['zh-invalid-locale-???', 'en-US', 'zh', ' EN ']) {
    const storage = fakeStorage({ [LOCALE_STORAGE_KEY]: value });
    assert.deepEqual(resolveLocale({ storage, languages: ['en-US'] }), { locale: 'en', saved: false });
  }
});

test('createI18n 未显式传入 languages 时读取浏览器偏好', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { languages: ['zh-TW', 'en-US'] },
  });
  try {
    // Passing an explicit undefined must not shadow the browser preference.
    const fromBrowser = createI18n({ catalog, storage: null, languages: undefined });
    assert.equal(fromBrowser.locale, 'zh-CN');
    const explicit = createI18n({ catalog, storage: null, languages: ['en-GB'] });
    assert.equal(explicit.locale, 'en');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('无效的已保存值被忽略并回退浏览器偏好', () => {
  const storage = fakeStorage({ [LOCALE_STORAGE_KEY]: 'fr-FR' });
  assert.deepEqual(resolveLocale({ storage, languages: ['zh-CN'] }), { locale: 'zh-CN', saved: false });
  const empty = fakeStorage({ [LOCALE_STORAGE_KEY]: '' });
  assert.deepEqual(resolveLocale({ storage: empty, languages: ['en-US'] }), { locale: 'en', saved: false });
});

test('读取存储抛错时仍按浏览器偏好选择', () => {
  const storage = fakeStorage();
  storage.state.getThrows = true;
  assert.deepEqual(resolveLocale({ storage, languages: ['zh-CN'] }), { locale: 'zh-CN', saved: false });
});

test('没有持久存储时仍能切换语言，但不宣称已持久化', () => {
  const i18n = createI18n({ catalog, storage: null, languages: ['zh-CN'] });
  assert.equal(i18n.locale, 'zh-CN');
  assert.equal(i18n.saved, false);
  i18n.setLocale('en');
  assert.equal(i18n.locale, 'en');
  assert.equal(i18n.saved, false);
});

test('显式选择会保存并在同一 origin 的后续访问中生效', () => {
  const storage = fakeStorage();
  const first = createI18n({ catalog, storage, languages: ['en-US'] });
  assert.equal(first.locale, 'en');
  assert.equal(first.saved, false);
  first.setLocale('zh-CN');
  assert.equal(first.locale, 'zh-CN');
  assert.equal(first.saved, true);
  assert.equal(storage.data.get(LOCALE_STORAGE_KEY), 'zh-CN');

  const second = createI18n({ catalog, storage, languages: ['en-US'] });
  assert.equal(second.locale, 'zh-CN');
  assert.equal(second.saved, true);
});

test('无效的切换值不会改变当前语言', () => {
  const i18n = createI18n({ catalog, storage: fakeStorage(), languages: ['en-US'] });
  assert.equal(i18n.setLocale('fr-FR'), 'en');
  assert.equal(i18n.locale, 'en');
});

test('写入存储抛错不阻止语言切换', () => {
  const storage = fakeStorage();
  const i18n = createI18n({ catalog, storage, languages: ['en-US'] });
  storage.state.setThrows = true;
  i18n.setLocale('zh-CN');
  assert.equal(i18n.locale, 'zh-CN');
  assert.equal(i18n.saved, false);
});

test('不同 origin 的存储互不影响', () => {
  const originA = fakeStorage();
  const originB = fakeStorage();
  const a = createI18n({ catalog, storage: originA, languages: ['en-US'] });
  a.setLocale('zh-CN');
  assert.equal(originA.data.get(LOCALE_STORAGE_KEY), 'zh-CN');

  const b = createI18n({ catalog, storage: originB, languages: ['en-US'] });
  assert.equal(b.locale, 'en');
  assert.equal(b.saved, false);
  assert.equal(originB.data.has(LOCALE_STORAGE_KEY), false);
});

test('onPersist 的返回值决定是否宣称已保存', () => {
  let persisted;
  const i18n = createI18n({
    catalog,
    storage: null,
    languages: ['en-US'],
    onPersist(value) {
      persisted = value;
      return true;
    },
  });
  i18n.setLocale('zh-CN');
  assert.equal(persisted, 'zh-CN');
  assert.equal(i18n.locale, 'zh-CN');
  assert.equal(i18n.saved, true);
});

test('参数插值替换占位符，缺失参数保留原占位符', () => {
  assert.equal(interpolate('Hello {name}', { name: 'Ada' }), 'Hello Ada');
  assert.equal(interpolate('Hello {name}', {}), 'Hello {name}');
  assert.equal(interpolate('Hello {name}', undefined), 'Hello {name}');
  assert.equal(interpolate('{a} and {b} and {a}', { a: 'A', b: 'B' }), 'A and B and A');
  assert.equal(interpolate('{user.name}', { 'user.name': 'Ada' }), 'Ada');
  assert.equal(interpolate('plain'), 'plain');
});

test('插值不做 HTML 转义，转义仍由调用方的 esc 负责', () => {
  assert.equal(interpolate('{value}', { value: '<b>Work</b>' }), '<b>Work</b>');
});

test('词条查找按当前语言、英文、key 依次回退', () => {
  const i18n = createI18n({ catalog, storage: fakeStorage(), languages: ['zh-CN'] });
  assert.equal(i18n.locale, 'zh-CN');
  assert.equal(i18n.t('greeting', { name: 'Ada' }), '你好，Ada');
  assert.equal(i18n.t('only.en'), 'English only');
  assert.equal(i18n.t('missing.key'), 'missing.key');
});

test('语言选择列表显示自身语言名称与选中态', () => {
  const i18n = createI18n({ catalog, storage: fakeStorage(), languages: ['en-US'] });
  const choices = i18n.choices();
  assert.deepEqual(choices.map((choice) => choice.id), ['auto', 'zh-CN', 'en']);
  assert.equal(choices.find((choice) => choice.id === 'zh-CN').label, '简体中文');
  assert.equal(choices.find((choice) => choice.id === 'en').label, 'English');
  assert.equal(choices.find((choice) => choice.id === 'auto').selected, true);
  assert.equal(choices.find((choice) => choice.id === 'zh-CN').selected, false);
  i18n.setLocale('zh-CN');
  assert.equal(i18n.choices().find((choice) => choice.id === 'zh-CN').selected, true);
});

test('设置文档语言在没有 document 的环境中不抛错', () => {
  const i18n = createI18n({ catalog, storage: fakeStorage(), languages: ['en-US'] });
  assert.doesNotThrow(() => i18n.setDocumentLanguage());
});

for (const blocked of [false, true]) test(`恢复跟随浏览器清除手动偏好且存储受限仍可使用：${blocked}`, () => {
  const storage = fakeStorage({ [LOCALE_STORAGE_KEY]: 'en' });
  const i18n = createI18n({ catalog, storage, languages: ['zh-CN'] });
  assert.equal(i18n.preference, 'en');
  storage.state.setThrows = blocked;
  i18n.setLocale('auto');
  assert.equal(i18n.preference, 'auto');
  assert.equal(i18n.locale, 'zh-CN');
  assert.equal(i18n.saved, false);
  assert.deepEqual(i18n.choices().filter(choice => choice.selected).map(choice => choice.id), ['auto']);
  if (!blocked) {
    assert.equal(storage.getItem(LOCALE_STORAGE_KEY), null);
    assert.deepEqual(resolveLocale({ storage, languages: ['en-US'] }), { locale: 'en', saved: false });
  }
});
