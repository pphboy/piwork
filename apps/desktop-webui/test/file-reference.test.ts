import assert from 'node:assert/strict';
import test from 'node:test';

const {
  parseFileReference, encodeFileReferencePath, workspacePath, filesDeepLink, fileReferenceLink,
  filesRouteTarget, isFilesRoute, MAX_FILE_SEGMENT_BYTES, MAX_FILE_PATH_BYTES, MAX_FILE_PATH_DEPTH,
} = await import(new URL('../browser/file-reference.js', import.meta.url).href);

/** Mirror the production hash parser: split first, then decode each segment once. */
function routeOf(hash: string): string[] {
  return hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
}

test('file references round-trip Chinese, spaces, percent and hash exactly once', () => {
  const names = ['报告.txt', 'quarterly report 2026.txt', '100% done.txt', 'issue #42.md', 'literal %2e name.txt'];
  for (const name of names) {
    const path = `/output/${name}`;
    const encoded = encodeFileReferencePath(path);
    assert.ok(encoded, name);
    assert.equal(encoded!.split('/').length, 3);
    assert.equal(parseFileReference(`piwork-file:${encoded}`), path, name);
    // Every percent in the encoded segment starts a valid two-digit escape.
    assert.doesNotMatch(encoded!.slice(1).split('/')[1]!, /%(?![0-9A-Fa-f]{2})/, name);
  }
});

test('a literal %2e is data, not a path control, after one decode', () => {
  assert.equal(parseFileReference('piwork-file:/output/%252e'), '/output/%2e');
  assert.equal(parseFileReference('piwork-file:/output/%2e'), undefined);
  assert.equal(parseFileReference('piwork-file:/output/%2e%2e'), undefined);
});

test('Files deep links bind the Work and round-trip the decoded path', () => {
  const workId = 'work-6f1c-0123';
  const path = '/output/报告 #1 100%.txt';
  const link = filesDeepLink(workId, path)!;
  assert.match(link, /^#\/work\/work-6f1c-0123\/files\/%2Foutput%2F/);
  assert.doesNotMatch(link, / /);
  const segments = routeOf(link);
  assert.deepEqual(segments.slice(0, 3), ['work', workId, 'files']);
  assert.deepEqual(filesRouteTarget(segments), { workId, path });
  assert.equal(isFilesRoute(segments), true);
  assert.equal(fileReferenceLink(`piwork-file:${encodeFileReferencePath(path)}`, workId)?.href, link);
  // No Work context means no navigation target.
  assert.equal(fileReferenceLink(`piwork-file:${encodeFileReferencePath(path)}`, ''), undefined);
});

test('authority, query/fragment, dot segments and encoded separators are rejected', () => {
  for (const href of [
    'piwork-file://evil.example/etc/passwd', 'piwork-file:///etc/passwd', 'PIWORK-FILE:/a.txt', 'piwork-file:a.txt',
    'piwork-file:/a.txt?download=1', 'piwork-file:/a.txt#fragment', 'piwork-file:',
    'piwork-file:/', 'piwork-file://', 'piwork-file:/a//b.txt', 'piwork-file:/a/', 'piwork-file:/a\\b.txt',
    'piwork-file:/.', 'piwork-file:/..', 'piwork-file:/a/../b.txt', 'piwork-file:/a/%2e/b.txt',
    'piwork-file:/a%2fb.txt', 'piwork-file:/a%2Fb.txt', 'piwork-file:/a%5cb.txt',
    'piwork-file:/a/%00.txt', 'piwork-file:/a/%0a.txt', 'piwork-file:/a/%7f.txt', 'piwork-file:/a/%c2%85.txt',
    'piwork-file:/a/%zz.txt', 'piwork-file:/a/%2.txt', 'piwork-file:/a/%e6%8a.txt', 'piwork-file:/a/%ef%bf%be.txt',
    'https://example.com/a.txt', 'file:///a.txt', '/a.txt', 'piwork-file:/a/./b.txt',
  ]) assert.equal(parseFileReference(href), undefined, href);
});

test('WF-005 segment, total-path and depth bounds reject without truncation', () => {
  const maxSegment = 'a'.repeat(MAX_FILE_SEGMENT_BYTES);
  assert.equal(parseFileReference(`piwork-file:/${maxSegment}`), `/${maxSegment}`);
  assert.equal(parseFileReference(`piwork-file:/${maxSegment}a`), undefined);
  // Percent-encoded UTF-8 counts decoded bytes, not source characters.
  const wide = '报'.repeat(85); // 255 UTF-8 bytes
  assert.equal(parseFileReference(`piwork-file:/${wide}`), `/${wide}`);
  assert.equal(parseFileReference(`piwork-file:/${wide}报`), undefined);

  const depth = Array.from({ length: MAX_FILE_PATH_DEPTH }, () => 'a'); // 128 segments
  assert.ok(parseFileReference(`piwork-file:/${depth.join('/')}`));
  assert.equal(parseFileReference(`piwork-file:/${[...depth, 'a'].join('/')}`), undefined);

  const fits = Array.from({ length: 16 }, () => maxSegment);
  assert.equal(`/${fits.join('/')}`.length, MAX_FILE_PATH_BYTES);
  assert.ok(parseFileReference(`piwork-file:/${fits.join('/')}`));
  const tooLong = [...fits, maxSegment];
  assert.equal(parseFileReference(`piwork-file:/${tooLong.join('/')}`), undefined);
});

test('decoded workspace paths are validated without double decoding', () => {
  assert.equal(workspacePath('/a/%2e'), '/a/%2e');
  assert.equal(workspacePath('/a/%2e%2e'), '/a/%2e%2e');
  assert.equal(workspacePath('/a/../b'), undefined);
  assert.equal(workspacePath('/a//b'), undefined);
  assert.equal(workspacePath('/a/b/'), undefined);
  assert.equal(workspacePath('/'), undefined);
  assert.equal(workspacePath('/a\\b'), undefined);
  assert.equal(workspacePath('/a/\u0000b'), undefined);
  assert.equal(workspacePath('/a/\u007fb'), undefined);
  assert.equal(workspacePath('/报告 #1.txt'), '/报告 #1.txt');
  assert.equal(filesDeepLink('work-1', '/a/../b'), undefined);
});

test('invalid Files routes never resolve to a target', () => {
  assert.equal(filesRouteTarget(['work', 'work-1', 'files']), undefined);
  assert.equal(filesRouteTarget(['work', 'work-1', 'files', '/a', 'extra']), undefined);
  assert.equal(filesRouteTarget(['work', 'work-1', 'files', '/a/../b']), undefined);
  assert.equal(filesRouteTarget(['work', '', 'files', '/a']), undefined);
  assert.equal(isFilesRoute(['work', 'work-1', 'settings']), false);
});

test('decoded workspace paths enforce the same 255-byte segment limit as references', () => {
  const max = 'a'.repeat(MAX_FILE_SEGMENT_BYTES);
  assert.equal(workspacePath(`/${max}`), `/${max}`);
  assert.equal(workspacePath(`/${max}a`), undefined);
  const wide = '报'.repeat(85); // 255 UTF-8 bytes
  assert.equal(workspacePath(`/${wide}`), `/${wide}`);
  assert.equal(workspacePath(`/${wide}报`), undefined);
  assert.equal(filesDeepLink('work-1', `/${max}a`), undefined);
});
