import test from 'node:test';
import assert from 'node:assert/strict';
const { renderChatMarkdown } = await import(new URL('../browser/chat-markdown.js', import.meta.url).href);

test('assistant Markdown supports headings, emphasis, quotes, nested lists and GFM tables', () => {
  const result = renderChatMarkdown('# Heading\n\n**bold** and *emphasis* and ~~old~~\n\n> Quote\n\n1. First\n   - Nested\n   - Next\n2. Second\n\n| Name | Value |\n| :--- | ---: |\n| A | `b` |');
  for (const fragment of ['<h1>Heading</h1>', '<strong>bold</strong>', '<em>emphasis</em>', '<del>old</del>', '<blockquote>', '<ol>', '<ul>', '<li>Nested</li>', 'class="chat-markdown-table"', '<table>', '<th align="right">Value</th>', '<code>b</code>']) assert.ok(result.includes(fragment), fragment);
});

test('HTML and attribute payloads are displayed literally and never become elements', () => {
  const result = renderChatMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<svg onload=alert(1)>\n\n[x](https://example.com/\"quoted \"title\\\" onclick=alert(1)\")');
  assert.doesNotMatch(result, /<(?:script|img|svg)\b/);
  assert.match(result, /&lt;script&gt;/);
  assert.doesNotMatch(result, /" onclick=/);
});

test('only explicit HTTP(S) and mail links are navigable, including autolinks', () => {
  const result = renderChatMarkdown('[Web](https://example.com/path?a=1&b=2 "A title")\n\n<https://example.org>\n\n[Mail](mailto:person@example.com)');
  assert.match(result, /href="https:\/\/example.com\/path\?a=1&amp;b=2"/);
  assert.match(result, /target="_blank" rel="noopener noreferrer" title="A title"/);
  assert.match(result, /href="https:\/\/example.org"/);
  assert.match(result, /href="mailto:person@example.com"/);
  for (const href of ['javascript:alert%281%29', 'JaVaScRiPt:alert%281%29', 'data:text/html,bad', 'vbscript:msgbox%281%29', '//evil.example', '/desktop/logout', 'file:///etc/passwd', 'javascript&colon;alert%281%29', '&#106;avascript:alert%281%29', 'java&#x09;script:alert%281%29', 'https:\\evil.example', 'mailto:x@example.com?body=%0d%0aInjected']) {
    assert.doesNotMatch(renderChatMarkdown(`[bad](${href})`), /<a\b/, href);
  }
});

test('Markdown images and HTML media never trigger external fetches', () => {
  const result = renderChatMarkdown('![private image](https://tracker.example/pixel)\n\n<img src="https://tracker.example/html">\n\n![x](data:image/svg+xml,bad)');
  assert.match(result, /\[Image: private image\]/);
  assert.doesNotMatch(result, /<(?:img|iframe|video|audio|source)\b/);
  assert.doesNotMatch(result, /<[^>]+\bsrc=/);
});

test('fenced code preserves long lines, escapes markup and survives every streamed prefix', () => {
  const message = '```html\n<img onerror="bad">\n' + 'x'.repeat(2000) + '\n```\n\nDone **now**';
  const result = renderChatMarkdown(message);
  assert.match(result, /class="chat-markdown-code" tabindex="0"/);
  assert.match(result, /&lt;img onerror=&quot;bad&quot;&gt;/);
  assert.ok(result.includes('x'.repeat(2000)));
  assert.match(result, /<strong>now<\/strong>/);
  for (let length = 0; length <= 35; length++) assert.doesNotThrow(() => renderChatMarkdown(message.slice(0, length)));
  assert.match(renderChatMarkdown('```js\nconst x = "<script>";'), /<pre[^>]*><code>const x = &quot;&lt;script&gt;&quot;;/);
  assert.match(renderChatMarkdown('\\*literal\\* and `<b>`'), /\*literal\* and <code>&lt;b&gt;<\/code>/);
});

test('large messages fall back without truncating or executing content', () => {
  const text = '<script>' + 'x'.repeat(65536) + '</script>';
  const result = renderChatMarkdown(text);
  assert.match(result, /^<div class="chat-markdown-plain">/);
  assert.ok(result.includes('x'.repeat(65536)));
  assert.doesNotMatch(result, /<script>/);
  assert.match(renderChatMarkdown('line\n'.repeat(4097)), /^<div class="chat-markdown-plain">/);
  assert.match(renderChatMarkdown('[x]('.repeat(8000)), /^<div class="chat-markdown-plain">/);
  assert.match(renderChatMarkdown('>'.repeat(5000) + 'quoted'), /^<div class="chat-markdown-plain">/);
});

test('Chinese headings and bold text render inside long table cells', () => {
  const text = '# 标题\n\n**重点**\n\n| 项目 | 说明 |\n| --- | --- |\n| 中文 | ' + '长内容'.repeat(1000) + ' |';
  const result = renderChatMarkdown(text);
  assert.match(result, /<h1>标题<\/h1>/);
  assert.match(result, /<strong>重点<\/strong>/);
  assert.match(result, /class="chat-markdown-table"/);
  assert.ok(result.includes('长内容'.repeat(1000)));
});
