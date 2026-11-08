import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const { ServiceViewControls, decodeServiceViewRequest, resolveServiceViewTarget } = await import(new URL('../browser/service-view-controls.js', import.meta.url).href);
const fixture = JSON.parse(readFileSync(new URL('../../../../fixtures/service-view-controls.json', import.meta.url), 'utf8'));
const request = (target: object = {}, action = 'select') => ({ kind: 'piwork.service-view', version: 1, status: 'requested', action, serviceId: 'service-b', ...target });
const preview = (value = request()) => ({ kind: 'text', text: JSON.stringify(value), isError: false, truncated: false });
const event = () => ({ workId: 'work', sessionId: 'session', runId: 'run', sequence: '1', kind: { $case: 'tool', tool: {
  phase: 'tool-end', toolName: 'service_select', toolCallId: 'call|provider/item', isError: false, result: preview(),
} } });

test('Service view decoder agrees with producer fixtures and rejects text, malformed and incomplete requests', () => {
  for (const target of fixture.validTargets) {
    for (const action of ['select', 'refresh']) assert.deepEqual(decodeServiceViewRequest(`service_${action}`, preview(request(target, action))), request(target, action));
  }
  for (const target of fixture.invalidTargets) assert.equal(decodeServiceViewRequest('service_select', preview({ ...request(), serviceId: undefined, ...target })), undefined);
  for (const patch of fixture.invalidRequests) assert.equal(decodeServiceViewRequest('service_select', preview({ ...request(), ...patch })), undefined);
  for (const patch of [{ isError: true }, { truncated: true }, { kind: 'unavailable' }, { text: 'not json' }, { text: ' '.repeat(1025) }]) {
    assert.equal(decodeServiceViewRequest('service_select', { ...preview(), ...patch }), undefined);
  }
  assert.equal(decodeServiceViewRequest('other_tool', preview()), undefined);
  assert.equal(decodeServiceViewRequest('service_refresh', preview()), undefined);
});

test('Service view origin is per page, consumes ignored attempts once, and never returns after invalidation', () => {
  const owner = new ServiceViewControls(), observer = new ServiceViewControls();
  const attempts: any[] = [], other: any[] = [];
  owner.observePage(1, 'work');
   observer.observePage(1, 'work');
  owner.subscribe((value: unknown) => attempts.push(value));
   observer.subscribe((value: unknown) => other.push(value));
  owner.begin('key', 'work', 'session');
   owner.accept('key', 'work', 'session', 'run');
  for (const value of [owner, observer]) { value.consume(event());
   value.consume(event());
   }
  assert.equal(attempts.length, 1);
   assert.equal(other.length, 0);
  assert.equal(attempts[0].current(), true);
  owner.observePage(1, 'other');
   owner.observePage(1, 'work');
  assert.equal(attempts[0].current(), false);
  owner.accept('key', 'work', 'session', 'run');
   owner.consume(event());
  assert.equal(attempts.length, 1);
  owner.begin('next', 'work', 'session');
   owner.observePage(2, 'work');
  owner.accept('next', 'work', 'session', 'run');
   owner.consume(event());
  assert.equal(attempts.length, 1);
});

test('Service view events must match the original Run, complete native tool and opaque call ID', () => {
  const controls = new ServiceViewControls();
   const attempts: any[] = [];
  controls.observePage(1, 'work');
   controls.begin('key', 'work', 'session');
   controls.accept('key', 'work', 'session', 'run');
  controls.subscribe((value: unknown) => attempts.push(value));
  for (const key of ['workId', 'sessionId', 'runId']) controls.consume({ ...event(), [key]: 'other' });
  for (const patch of [{ phase: 'tool-start' }, { isError: true }, { toolName: 'other' }, { toolCallId: '' }]) {
    const value = event();
     Object.assign(value.kind.tool, patch);
     controls.consume(value);
  }
  assert.equal(attempts.length, 0);
  controls.consume(event());
   controls.finish('run');
   controls.consume({ ...event(), sequence: '2' });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].current(), true, 'normal Run completion does not invalidate an already started view attempt');
});

test('Service view target resolves exact IDs and declared ports without substituting a fallback Service', () => {
  const services = [{ id: 'service-a', ports: [80], observed: 'Ready' }, { id: 'service-b', ports: [3000, 8080], observed: 'Stopped' }, { id: 'service-c', ports: [80], observed: 'Removed' }];
  const selected = { serviceId: 'service-b', port: 8080 };
  assert.equal(resolveServiceViewTarget({ serviceId: 'service-b' }, services, selected).port, 8080);
  assert.equal(resolveServiceViewTarget({ serviceId: 'service-a' }, services, selected).port, 80);
  assert.equal(resolveServiceViewTarget({ serviceId: 'service-b', port: 3000 }, services, selected).service.id, 'service-b');
  for (const target of [{ serviceId: 'unknown' }, { serviceId: 'service-c' }, { serviceId: 'service-a', port: 8080 }]) {
    assert.equal(resolveServiceViewTarget(target, services, selected), undefined);
  }
});
