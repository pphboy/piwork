import test from 'node:test';
import assert from 'node:assert/strict';

const moduleURL = new URL('../browser/file-results.js', import.meta.url).href;
const { FileMutationResults, UnknownFileLocks, normalizeWorkspacePath, fileParentDirectory } = await import(moduleURL);
const succeeded = (path: string) => ({ path, status: 'succeeded', message: 'Confirmed', httpStatus: 204 });
const failed = (path: string) => ({ path, status: 'failed', message: 'FILE_PERMISSION_DENIED', httpStatus: 403 });
const unknown = (path: string) => ({ path, status: 'unknown', message: 'Response lost' });
const action = (token: number, generation = 0) => ({ key: 'confirm-transfer', token, generation });

test('workspace paths canonicalize separators but never decode names, traverse, or accept external URLs', () => {
  assert.equal(normalizeWorkspacePath('/from//child/'), '/from/child');
  assert.equal(normalizeWorkspacePath('/literal%2Fname'), '/literal%2Fname');
  assert.equal(fileParentDirectory('/from/child/'), '/from');
  assert.equal(fileParentDirectory('/name'), '/');
  assert.equal(fileParentDirectory('/'), '/');
  for (const path of ['../name', 'name', '//host/name', 'https://host/name', '/a/../b', '/a/./b', '/a\\b', '/a\0b'])
    assert.throws(() => normalizeWorkspacePath(path), { name: 'Error' }, path);
  assert.throws(() => new FileMutationResults([{ source: '/' }]));
});

test('Delete A204/B403 retry selects only B even when externally recreated A is explicitly selected', () => {
  const targets = [{ source: '/A' }, { source: '/B' }];
  const ledger = new FileMutationResults(targets);
  ledger.record(targets, [succeeded('/A'), failed('/B')]);
  assert.deepEqual(ledger.retryTargets([]), []);
  assert.deepEqual(ledger.retryTargets(['/A']), []);
  assert.deepEqual(ledger.retryTargets(['/A', '/B', '/B']), [{ source: '/B' }]);
  // A's external reappearance changes no evidence in the original mutation attempt.
  const retry = ledger.retryTargets(['/B']);
  ledger.record(retry, [succeeded('/B')]);
  assert.deepEqual(ledger.retryTargets(['/A', '/B']), []);
  assert.equal(ledger.results.filter((row: { path: string }) => row.path === '/A').length, 1);
  assert.equal(ledger.attempts.length, 2);
  assert.deepEqual(ledger.attempts[1].targets, [{ source: '/B' }]);
});

test('COPY/MOVE retry keeps the exact destination and excludes unknown or never-submitted inputs', () => {
  const targets = [{ source: '/a', destination: '/out/a' }, { source: '/b', destination: '/out/b' }, { source: '/c', destination: '/out/c' }];
  const ledger = new FileMutationResults(targets);
  assert.equal(ledger.hasResults, false);
  assert.deepEqual(ledger.retryTargets(['/a']), []);
  ledger.record(targets, [succeeded('/a'), failed('/b'), unknown('/c')]);
  assert.equal(ledger.hasResults, true);
  assert.deepEqual(ledger.retryTargets(['/a', '/b', '/c']), [targets[1]]);
  assert.equal(ledger.results[1].message, 'FILE_PERMISSION_DENIED');
  assert.throws(() => ledger.record([{ source: '/b', destination: '/different/b' }], [failed('/b')]));
});

test('recursive partial results cannot replay a parent or its already successful children', () => {
  const targets = [{ source: '/folder', destination: '/out/folder' }];
  const ledger = new FileMutationResults(targets);
  ledger.record(targets, [succeeded('/folder/child-a'), failed('/folder/child-b'), failed('/folder')]);
  assert.deepEqual(ledger.retryTargets(['/folder', '/folder/child-b']), []);
  assert.equal(ledger.results.length, 3);
  ledger.record(targets, [failed('/folder/child-b')]);
  assert.deepEqual(ledger.retryTargets(['/folder']), [], 'failure-only multistatus may omit changed children');
});

test('missing, foreign and malformed result rows retain exact feedback and fail closed for retries', () => {
  const targets = [{ source: '/a' }];
  for (const results of [[], [failed('/foreign')], [failed('unknown path: HTTP/1.1 403 Forbidden')]]) {
    const ledger = new FileMutationResults(targets);
    ledger.record(targets, results);
    assert.ok(ledger.results.some((row: { status: string }) => row.status === 'unknown'));
    assert.deepEqual(ledger.retryTargets(['/a']), []);
    if (results.length) assert.ok(ledger.results.some((row: { path: string }) => row.path === results[0]!.path));
  }
});

test('source/destination collisions in unassociated batch results cannot authorize a retry', () => {
  const targets = [{ source: '/a', destination: '/b' }, { source: '/b', destination: '/c' }];
  const ledger = new FileMutationResults(targets);
  ledger.record(targets, [failed('/a'), failed('/b')]);
  assert.deepEqual(ledger.retryTargets(['/a', '/b']), []);
});

test('attempt input and result snapshots are immutable even if the original arrays change', () => {
  const target = { source: '/a', destination: '/out/a' }, result = failed('/a');
  const ledger = new FileMutationResults([target]);
  const attempt = ledger.record([target], [result]);
  target.destination = '/changed'; result.message = 'changed';
  assert.equal(ledger.targets[0].destination, '/out/a');
  assert.equal(attempt.results[0].message, 'FILE_PERMISSION_DENIED');
  assert.equal(Object.isFrozen(attempt.results[0]), true);
  assert.equal(Object.isFrozen(ledger.targets), true);
});

test('unknown locks cover both source and computed destination, including another source and descendants', () => {
  const locks = new UnknownFileLocks();
  const original = locks.add('one', { source: '/source/a', destination: '/dest/a' }, action(1));
  assert.equal(locks.conflict('one', [{ source: '/source/a' }]), original);
  assert.equal(locks.conflict('one', [{ source: '/dest/a' }]), original);
  assert.equal(locks.conflict('one', [{ source: '/other/a', destination: '/dest/a' }]), original);
  assert.equal(locks.conflict('one', [{ source: '/dest' }]), original);
  assert.equal(locks.conflict('one', [{ source: '/dest/a/child' }]), original);
  assert.equal(locks.conflict('one', [{ source: '/dest/another' }]), undefined);
  assert.equal(locks.conflict('two', [{ source: '/dest/a' }]), undefined);
});

test('upload unknown locks use the exact computed target, with no basename-only cross-folder lock', () => {
  const locks = new UnknownFileLocks();
  locks.add('one', { source: '/uploads/photo.png' });
  assert.ok(locks.conflict('one', [{ source: '/source/photo.png', destination: '/uploads/photo.png' }]));
  assert.equal(locks.conflict('one', [{ source: '/elsewhere/photo.png' }]), undefined);
});

test('review requires actual rereads of both original source and destination directories', () => {
  const locks = new UnknownFileLocks();
  const original = locks.add('one', { source: '/source/a', destination: '/dest/a' }, action(1));
  const review = locks.reviewSnapshot('one');
  assert.deepEqual(review.directories, ['/source', '/dest']);
  assert.deepEqual(locks.completeReview(review, ['/unrelated']).released, []);
  assert.deepEqual(locks.completeReview(review, ['/source']).released, []);
  assert.equal(locks.conflict('one', [{ source: '/dest/a' }]), original);
  const complete = locks.completeReview(review, ['/source/', '/dest/']);
  assert.deepEqual(complete.released, [original]);
  assert.deepEqual(complete.actions, [action(1)]);
  assert.equal(locks.conflict('one', [{ source: '/dest/a' }]), undefined);
});

test('late review of A never clears newly unknown B even in the same directory', () => {
  const locks = new UnknownFileLocks();
  locks.add('one', { source: '/dir/a' }, action(1));
  const reviewA = locks.reviewSnapshot('one');
  const b = locks.add('one', { source: '/dir/b' }, action(2));
  const result = locks.completeReview(reviewA, ['/dir']);
  assert.equal(result.released.length, 1);
  assert.deepEqual(result.actions, [action(1)]);
  assert.equal(locks.conflict('one', [{ source: '/dir/b' }]), b);
});

test('late review cannot clear a newer generation at the same source/destination', () => {
  const locks = new UnknownFileLocks();
  const a = locks.add('one', { source: '/dir/a', destination: '/out/a' }, action(1));
  const reviewA = locks.reviewSnapshot('one');
  const b = locks.add('one', { source: '/dir/a', destination: '/out/a' }, action(2));
  assert.equal(a.id, b.id); assert.notEqual(a.generation, b.generation);
  assert.deepEqual(locks.completeReview(reviewA, ['/dir', '/out']), { released: [], actions: [] });
  assert.equal(locks.conflict('one', [{ source: '/out/a' }]), b);
});

test('partial review releases an action only when all of its exact unknown locks are gone', () => {
  const locks = new UnknownFileLocks();
  locks.add('one', { source: '/a/one' }, action(1));
  locks.add('one', { source: '/b/two' }, action(1));
  locks.add('one', { source: '/c/three' }, action(2));
  const review = locks.reviewSnapshot('one');
  assert.deepEqual(locks.completeReview(review, ['/a']).actions, []);
  assert.deepEqual(locks.completeReview(review, ['/b']).actions, [action(1)]);
  assert.ok(locks.conflict('one', [{ source: '/c/three' }]));
});

test('identity clear makes old snapshots inert, including same work/path/action key after sign-in', () => {
  const locks = new UnknownFileLocks();
  locks.add('one', { source: '/a' }, action(1));
  const old = locks.reviewSnapshot('one');
  locks.clear(); const fresh = locks.add('one', { source: '/a' }, action(2, 1));
  assert.deepEqual(locks.completeReview(old, ['/']), { released: [], actions: [] });
  assert.equal(locks.conflict('one', [{ source: '/a' }]), fresh);
});
