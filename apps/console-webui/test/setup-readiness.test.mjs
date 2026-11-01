import assert from 'node:assert/strict';
import test from 'node:test';
import { preparationComponents, preparationIsReady } from '../src/setup-readiness.ts';
const snapshot = () => ({ status: { ready: true }, preparation: { ready: true,
  components: Object.fromEntries(preparationComponents.map(name => [name, { state: 'ready' }])),
} });
test('ready requires current status, preparation and all six observed components', () => {
  assert.equal(preparationIsReady(snapshot(), false), true);
  for (const name of preparationComponents) {
    for (const state of ['pending', 'preparing', 'retrying', 'failed', 'unconfigured', 'unknown', undefined]) {
      const value = snapshot();
      value.preparation.components[name].state = state;
      assert.equal(preparationIsReady(value, false), false, `${name}: ${state}`);
    }
  }
});
test('stale all-ready, missing snapshot and merely saved configuration cannot unlock completion', () => {
  assert.equal(preparationIsReady(snapshot(), true), false);
  assert.equal(preparationIsReady({}, false), false);
  assert.equal(preparationIsReady({ runtime: { configured: true } }, false), false);
  for (const key of ['status', 'preparation']) {
    const value = snapshot();
    value[key].ready = false;
    assert.equal(preparationIsReady(value, false), false);
  }
});
