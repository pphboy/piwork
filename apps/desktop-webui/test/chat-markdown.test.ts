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

test('Work file references become Files links bound to the reply Work', () => {
  const html = renderChatMarkdown('[报告.txt](piwork-file:/output/%E6%8A%A5%E5%91%8A.txt)', { workId: 'work-1' });
  assert.match(html, /<a class="chat-file-link" href="#\/work\/work-1\/files\/%2Foutput%2F%E6%8A%A5%E5%91%8A\.txt"/);
  assert.match(html, /data-path="\/output\/报告\.txt"/);
  assert.match(html, /title="Open in Files"/);
  assert.doesNotMatch(html, /target="_blank"/);
  // Without a confirmed Work the same text stays readable and non-navigable.
  const plain = renderChatMarkdown('[x](piwork-file:/a.txt)');
  assert.doesNotMatch(plain, /<a\b/);
  assert.match(plain, />x</);
});

test('invalid, ambiguous or cross-scheme file references stay text', () => {
  for (const href of ['piwork-file://evil.example/a.txt', 'piwork-file:/a/../b.txt', 'piwork-file:/a%2fb.txt',
    'piwork-file:/', 'piwork-file:/a.txt?download=1', 'PIWORK-FILE:/a.txt', 'file:///etc/passwd']) {
    const html = renderChatMarkdown(`[bad](${href})`, { workId: 'work-1' });
    assert.doesNotMatch(html, /chat-file-link/, href);
    assert.doesNotMatch(html, /<a\b/, href);
  }
  assert.match(renderChatMarkdown('[web](https://example.com/a.txt)', { workId: 'work-1' }), /href="https:\/\/example.com\/a.txt"/);
});

test('file links in code, HTML and Markdown image syntax never become navigation', () => {
  const fenced = renderChatMarkdown('```\n[x](piwork-file:/a.txt)\n```', { workId: 'work-1' });
  assert.doesNotMatch(fenced, /chat-file-link/);
  const image = renderChatMarkdown('![track](piwork-file:/pixel.png)', { workId: 'work-1' });
  assert.doesNotMatch(image, /chat-file-link|<(?:img|iframe|video|audio|source)\b/);
  assert.match(image, /\[Image: track\]/);
  const html = renderChatMarkdown('<a href="piwork-file:/a.txt">raw</a>', { workId: 'work-1' });
  assert.doesNotMatch(html, /chat-file-link|<a\b/);
  assert.match(html, /&lt;a href=/);
});

test('every streamed prefix of a file reference is safe and the completed one is one link', () => {
  const message = 'See [report](piwork-file:/output/report%201.txt).';
  for (let length = 0; length <= message.length; length++) assert.doesNotThrow(() => renderChatMarkdown(message.slice(0, length), { workId: 'work-1' }));
  const html = renderChatMarkdown(message, { workId: 'work-1' });
  assert.equal((html.match(/class="chat-file-link"/g) || []).length, 1);
  assert.match(html, /href="#\/work\/work-1\/files\/%2Foutput%2Freport%201\.txt"/);
});
