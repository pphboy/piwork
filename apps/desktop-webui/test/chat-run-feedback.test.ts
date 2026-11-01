import assert from 'node:assert/strict';
import test from 'node:test';
const { ChatRunFeedback, RunFeedbackObservations } = await import(new URL('../browser/chat-run-feedback.js', import.meta.url).href);
const { NoticeStore } = await import(new URL('../browser/notices.js', import.meta.url).href);
const target = { identity: 'one', work: 'work', session: 'session', run: 'run-original' };
const run = (extra = {}) => ({ id: target.run, sessionId: target.session, status: 'running', cursor: 2, ...extra });
const recovery = () => ({ label: () => 'Original Run', run: () => {} });
function fixture() {
  const tracker = new ChatRunFeedback(), observations = new RunFeedbackObservations(), notices = new NoticeStore();
  tracker.setIdentity('one');
  notices.setIdentity('one');
  const project = () => {
    const result = tracker.project((item: typeof target) => observations.get(item.work, item.session, item.run), (facts: ReturnType<typeof run> & { error?: string; executionError?: string }) => String(facts.executionError || facts.error || facts.status), recovery);
    for (const item of result) {
      if (item.resolve) notices.resolve(item.owner);
      if (item.event) notices.publish(item.event);
    }
    return result;
  };
  return { tracker, observations, notices, project };
}

test('Chat feedback ignores arbitrary historical Runs and registers exact UI acceptance only', () => {
  const { tracker, observations, notices, project } = fixture();
  observations.record('work', run({ status: 'failed', error: 'Old history' }), true);
  project();
  assert.equal(notices.items().length, 0);
  assert.equal(tracker.accept({ ...target, identity: 'obsolete' }), false);
  tracker.accept(target);
  project();
  assert.equal(notices.items()[0].tone, 'error');
  notices.destroy();
});

test('Chat observation unknown survives error clearing until a real new observation confirms the same Run', () => {
  const { tracker, observations, notices, project } = fixture();
  tracker.accept(target);
  observations.record('work', run(), true);
  observations.record('work', run({ error: 'Stream lost' }), false);
  project();
  const revision = observations.get('work', 'session', 'run-original').revision;
  assert.equal(notices.items()[0].tone, 'unknown');
  observations.record('work', run(), false);
  assert.equal(observations.get('work', 'session', 'run-original').revision, revision);
  project();
  assert.equal(notices.items().length, 1);
  observations.record('work', run({ cursor: 3 }), true);
  project();
  assert.equal(notices.items().length, 0);
  notices.destroy();
});

test('Chat terminal failure is sticky, dismissal never changes it, and another prompt cannot replace its owner', () => {
  const { tracker, observations, notices, project } = fixture();
  tracker.accept(target);
  observations.record('work', run({ status: 'failed', error: 'Model rejected', executionError: 'Model rejected' }), true);
  project();
  notices.dismiss(notices.items()[0].id);
  project();
  assert.equal(notices.items().length, 0);
  tracker.accept({ ...target, run: 'later-run' });
  observations.record('work', run({ id: 'later-run', status: 'succeeded' }), true);
  const result = project();
  assert.ok(result.some((item: { target: typeof target; event?: unknown }) => item.target.run === 'run-original' && item.event));
  observations.record('work', run({ status: 'running' }), true);
  assert.equal(project().find((item: { target: typeof target }) => item.target.run === 'run-original').resolve, false);
  notices.destroy();
});

test('Chat successful or cancelled terminal prunes only its exact observation and never announces completion', () => {
  for (const status of ['succeeded', 'cancelled']) {
    const { tracker, observations, notices, project } = fixture();
    tracker.accept(target);
    observations.record('work', run({ error: 'Stream lost' }), false);
    project();
    observations.record('work', run({ status }), true);
    const result = project();
    assert.equal(result[0].retired, true);
    assert.equal(notices.items().length, 0);
    assert.equal(project().length, 0);
    notices.destroy();
  }
});

test('Chat identity clear fences old accepted targets and observation snapshots', () => {
  const { tracker, observations, notices, project } = fixture();
  tracker.accept(target);
  observations.record('work', run({ error: 'Original error' }), false);
  project();
  tracker.setIdentity('two');
  observations.clear();
  notices.setIdentity('two');
  assert.equal(tracker.accept(target), false);
  assert.equal(project().length, 0);
  assert.equal(notices.items().length, 0);
  notices.destroy();
});

test('Chat notice captures original Work display context without following another prompt or renamed input', () => {
  const tracker = new ChatRunFeedback(), observations = new RunFeedbackObservations();
  tracker.setIdentity('one');
  const original = { ...target, workName: 'Original Work' };
  tracker.accept(original);
  original.workName = 'Later renamed input';
  observations.record('work', run({ status: 'failed', error: 'Original failure' }), true);
  const result = tracker.project(
    (item: typeof target) => observations.get(item.work, item.session, item.run),
    (_run: unknown, item: typeof original) => item.workName,
    recovery,
  );
  assert.equal(result[0].event.message(), 'Original Work');
});

test('Chat execution failure remains an error even beside completed output or an accepted Run', () => {
  for (const status of ['accepted', 'succeeded']) {
    const { tracker, observations, notices, project } = fixture();
    tracker.accept(target);
    observations.record('work', run({ status, error: 'Known execution failure', executionError: 'Known execution failure' }), true);
    const outcome = project()[0];
    assert.equal(outcome.event.tone, 'error');
    assert.equal(outcome.retired, false);
    assert.equal(notices.items()[0].message(), 'Known execution failure');
    observations.record('work', run({ status: 'running' }), true);
    assert.equal(project()[0].resolve, false);
    assert.equal(notices.items().length, 1);
    notices.destroy();
  }
});
