import test from 'node:test';
import assert from 'node:assert/strict';

const { formatDateTime, formatTime, formatNumber, localeTag, i18n, stateText, LocalizedMessage } = await import(
  new URL('../browser/locale.js', import.meta.url).href
);

test('generic state labels do not reuse Work-specific descriptions', () => {
  i18n.setLocale('zh-CN');
  assert.equal(stateText('Starting'), '启动中');
  assert.equal(stateText('Unknown'), '未知');
  assert.equal(stateText('Ready'), '就绪');
  assert.equal(stateText('technical-id'), 'technical-id');
  i18n.setLocale('en');
  assert.equal(stateText('Starting'), 'Starting');
});

// UIL-I18N-002: dates and numbers follow the selected interface language.
test('locale-aware formatting follows the selected interface language', () => {
  i18n.setLocale('en');
  assert.equal(localeTag(), 'en-US');
  const english = formatDateTime('2020-01-02T03:04:05Z', { timeZone: 'UTC' });
  const englishTime = formatTime('2020-01-02T03:04:05Z', { timeZone: 'UTC' });
  assert.match(english, /2020/);
  assert.match(englishTime, /3:04:05/);

  i18n.setLocale('zh-CN');
  assert.equal(localeTag(), 'zh-CN');
  const chinese = formatDateTime('2020-01-02T03:04:05Z', { timeZone: 'UTC' });
  assert.match(chinese, /2020/);
  assert.notEqual(chinese, english);

  assert.equal(formatNumber(1234), '1,234');
  assert.equal(formatNumber(Number.NaN), 'NaN');
  assert.equal(formatDateTime('not-a-date'), '');
  assert.equal(formatTime('not-a-date'), '');
  i18n.setLocale('en');
});

// UIL-I18N-002: a cached error re-renders in the language active at display time.
test('cached LocalizedMessage follows later language changes', () => {
  const message = new LocalizedMessage('d.error.requestFailed', { status: 503 }, 'OPERATION_NOT_FOUND');
  i18n.setLocale('en');
  const english = String(message);
  i18n.setLocale('zh-CN');
  const chinese = String(message);
  assert.ok(english.includes('OPERATION_NOT_FOUND'));
  assert.ok(chinese.includes('OPERATION_NOT_FOUND'));
  assert.notEqual(english, chinese);
  assert.match(english, /Request failed \(503\)/);
  i18n.setLocale('en');
});
