import assert from 'node:assert/strict';
import test from 'node:test';
import { SkillEditor } from '../src/skill-editor.ts';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function port(overrides = {}) {
  const calls = { files: 0, read: [], save: [] };
  let identity = 1;
  const baseRead = async (skill, path) => ({ path, content: `${skill}:${path}`, version: 'v1' });
  const baseSave = async (skill, path) => ({ path, version: 'v2' });
  return {
    identity: () => identity,
    files: async () => [],
    read: async (skill, path) => { calls.read.push([skill, path]); return (overrides.read ?? baseRead)(skill, path); },
    save: async (...args) => { calls.save.push(args); return (overrides.save ?? baseSave)(...args); },
    calls,
    setIdentity: next => { identity = next; },
  };
}

test('saving submits only the current file and its read version', async () => {
  const content = port();
  const editor = new SkillEditor(content);
  assert.equal(await editor.open('code-review', 'references/checklist.md'), true);
  assert.equal(editor.dirty, false);
  editor.input('updated checklist');
  assert.equal(editor.dirty, true);
  assert.equal(await editor.save(), 'saved');
  assert.deepEqual(content.calls.save, [['code-review', 'references/checklist.md', 'updated checklist', 'v1']]);
  assert.equal(editor.baseline, 'updated checklist');
  assert.equal(editor.dirty, false);
  assert.equal(editor.version, 'v2');
});

test('a late read cannot replace the file opened after it', async () => {
  const first = deferred(), second = deferred();
  const content = port({
    read: async (skill, path) => (path === 'SKILL.md' ? first.promise : second.promise),
  });
  const editor = new SkillEditor(content);
  const opening = editor.open('code-review', 'SKILL.md');
  const secondOpen = editor.open('code-review', 'references/rules.md');
  second.resolve({ path: 'references/rules.md', content: 'rules', version: 'v2' });
  assert.equal(await secondOpen, true);
  first.resolve({ path: 'SKILL.md', content: 'manifest', version: 'v1' });
  assert.equal(await opening, false);
  assert.equal(editor.path, 'references/rules.md');
  assert.equal(editor.draft, 'rules');
});

test('input after a submitted save stays dirty when the save confirms', async () => {
  const saved = deferred();
  const content = port({ save: async () => saved.promise });
  const editor = new SkillEditor(content);
  await editor.open('code-review', 'SKILL.md');
  editor.input('first edit');
  const saving = editor.save();
  editor.input('second edit');
  saved.resolve({ path: 'SKILL.md', version: 'v2' });
  assert.equal(await saving, 'saved');
  assert.equal(editor.baseline, 'first edit');
  assert.equal(editor.draft, 'second edit');
  assert.equal(editor.dirty, true);
});

test('conflicts and explicit failures preserve the draft and baseline', async () => {
  for (const [code, outcome] of [['SKILL_FILE_CONFLICT', 'conflict'], ['SKILL_UPLOAD_LIMIT_EXCEEDED', 'failed']]) {
    const content = port({ save: async () => { throw Object.assign(new Error(code), { code }); } });
    const editor = new SkillEditor(content);
    await editor.open('code-review', 'SKILL.md');
    editor.input('draft');
    assert.equal(await editor.save(), outcome);
    assert.equal(editor.draft, 'draft');
    assert.equal(editor.baseline, 'code-review:SKILL.md');
    assert.equal(editor.unknown, false);
    assert.equal(editor.error, code);
  }
});

test('an unknown save is verified read-only and never replayed', async () => {
  let reads = 0;
  const content = port({
    read: async (skill, path) => {
      reads++;
      return reads === 1
        ? { path, content: 'baseline', version: 'v1' }
        : { path, content: 'submitted', version: 'v2' };
    },
    save: async () => { throw Object.assign(new Error('lost'), { code: 'RESULT_UNKNOWN' }); },
  });
  const editor = new SkillEditor(content);
  await editor.open('code-review', 'SKILL.md');
  editor.input('submitted');
  assert.equal(await editor.save(), 'unknown');
  assert.equal(editor.unknown, true);
  assert.deepEqual(editor.submitted, { skill: 'code-review', path: 'SKILL.md', content: 'submitted', version: 'v1' });
  assert.equal(await editor.save(), 'noop');
  assert.equal(content.calls.save.length, 1);
  const verified = await editor.verify();
  assert.deepEqual(verified, { content: 'submitted', version: 'v2', matchesSubmission: true });
  assert.equal(editor.unknown, false);
  assert.equal(editor.baseline, 'submitted');
  assert.equal(content.calls.save.length, 1);
});

test('verification keeps the unknown lock when Core content differs', async () => {
  let reads = 0;
  const content = port({
    read: async (skill, path) => ({ path, content: reads++ === 0 ? 'baseline' : 'someone else', version: reads === 1 ? 'v1' : 'v9' }),
    save: async () => { throw Object.assign(new Error('lost'), { code: 'RESULT_UNKNOWN' }); },
  });
  const editor = new SkillEditor(content);
  await editor.open('code-review', 'SKILL.md');
  editor.input('submitted');
  await editor.save();
  const verified = await editor.verify();
  assert.equal(verified.matchesSubmission, false);
  assert.equal(editor.unknown, true);
  assert.equal(editor.draft, 'submitted');
});

test('non-text files cannot be saved and identity changes clear everything', async () => {
  const content = port({ read: async () => { throw Object.assign(new Error('binary'), { code: 'SKILL_FILE_NOT_TEXT' }); } });
  const editor = new SkillEditor(content);
  await editor.open('code-review', 'assets/raw.bin');
  assert.equal(editor.status, 'not-text');
  editor.input('x');
  assert.equal(await editor.save(), 'noop');

  const pending = deferred();
  const changing = port({ read: async () => pending.promise });
  const second = new SkillEditor(changing);
  const opening = second.open('code-review', 'SKILL.md');
  changing.setIdentity(2);
  pending.resolve({ path: 'SKILL.md', content: 'text', version: 'v1' });
  assert.equal(await opening, false);
  assert.equal(second.status, 'loading');
  assert.equal(second.syncIdentity(), true);
  assert.equal(second.status, 'empty');
  assert.equal(second.draft, '');
});
