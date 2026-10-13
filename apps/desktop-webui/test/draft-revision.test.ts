import test from 'node:test';
import assert from 'node:assert/strict';

const moduleURL = new URL('../browser/draft-revision.js', import.meta.url).href;
const { NewWorkDraftRevision, hasUnsentDrafts, createSubmissionBlocked } = await import(moduleURL);

test('New Work resets only on the next explicit open after reliable acceptance', () => {
  const draft = new NewWorkDraftRevision();
  assert.equal(draft.open(), false);
  draft.edit();
  const submitted = draft.capture();
  assert.equal(draft.accept(submitted), true);
  assert.deepEqual(draft.capture(), submitted, 'acceptance does not itself change form fields');
  assert.equal(draft.open(), true);
  assert.equal(draft.open(), false, 'the accepted draft is consumed exactly once');
});

test('rejected or unknown New Work keeps its exact draft and does not authorize a reset', () => {
  for (const outcome of ['rejected', 'unknown']) {
    const draft = new NewWorkDraftRevision();
    const fields = { name: '  Original Work  ', json: '{"x": 1}', skills: ['one'], advanced: true };
    const expected = structuredClone(fields);
    draft.open(); draft.edit();
    // Neither a known rejection nor a lost response calls accept.
    if (draft.open()) Object.assign(fields, { name: '', json: '', skills: [], advanced: false });
    assert.deepEqual(fields, expected, outcome);
  }
});

test('late accepted A cannot consume edited B, even when B has the same visible text', () => {
  const draft = new NewWorkDraftRevision();
  draft.open(); draft.edit(); const a = draft.capture();
  draft.edit(); draft.edit(); // User changes A then restores its original text.
  assert.equal(draft.accept(a), false);
  assert.equal(draft.open(), false);
});

test('late accepted A cannot consume a newly reopened draft context', () => {
  const draft = new NewWorkDraftRevision();
  draft.open(); draft.edit(); const a = draft.capture();
  assert.equal(draft.open(), false);
  assert.equal(draft.accept(a), false);
  assert.equal(draft.open(), false);
});

test('editing after acceptance and changing identity invalidate the old reset marker', () => {
  const draft = new NewWorkDraftRevision();
  draft.open(); const a = draft.capture(); draft.accept(a); draft.edit();
  assert.equal(draft.open(), false);
  const b = draft.capture(); draft.clear();
  assert.equal(draft.accept(b), false);
  assert.equal(draft.open(), false);
});

test('unsent guard sees all Work/Session texts, including whitespace-only entered input', () => {
  assert.equal(hasUnsentDrafts({ texts: Object.values({ selected: '', otherWork: 'unfinished' }) }), true);
  assert.equal(hasUnsentDrafts({ texts: ['', '  \n'] }), true);
  assert.equal(hasUnsentDrafts({ texts: ['', ''], imageGroups: [[], []], pending: [] }), false);
});

test('unsent guard includes selected images still reading and snapshots awaiting acceptance', () => {
  assert.equal(hasUnsentDrafts({ texts: [], imageGroups: [[], [{ reading: true }]] }), true);
  assert.equal(hasUnsentDrafts({ texts: [], pending: [{ text: 'sending text', images: [] }] }), true);
  assert.equal(hasUnsentDrafts({ texts: [], pending: [{ text: '', images: [{ id: 'image-in-flight' }] }] }), true);
  assert.equal(hasUnsentDrafts({ texts: [], imageGroups: [], pending: [] }), false, 'identity cleanup is supplied by caller');
});

test('Create name edits retain upstream independent intent while duplicates and unknown results remain locked', () => {
  const records = [{ action: 'create-work', resource: 'A taken', pending: true }];
  assert.equal(createSubmissionBlocked(records, ' A taken '), true);
  assert.equal(createSubmissionBlocked(records, 'B taken'), false);
  assert.equal(createSubmissionBlocked([{ ...records[0], pending: false, blocked: true }], 'B taken'), true);
  assert.equal(createSubmissionBlocked([{ ...records[0], pending: false, blocked: false }], 'A taken'), false);
});
