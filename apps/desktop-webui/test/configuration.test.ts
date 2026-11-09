import test from 'node:test';
import assert from 'node:assert/strict';

const { editableConfiguration, editAdvanced, synchronizeConfiguration } = await import(new URL('../browser/configuration.js', import.meta.url).href);

function fixture(catalogId = 'work-owned-image') {
  const raw = {
    agentImage: { catalogId }, skills: ['one'], packages: [{ name: 'tools', enabled: true }],
    agentsMd: 'original', modelRef: 'saved-model', mcpServers: [], resources: { cpuMillis: 2000 }, tools: { denied: [] },
  };
  return {
    raw,
    config: {
      skills: [...raw.skills], packages: raw.packages.map(p => ({ ...p, source: 'Saved Work copy' })),
      agents: raw.agentsMd, advanced: editableConfiguration(raw), agentImage: { ...raw.agentImage }, validationError: '',
      active: { agentImage: { catalogId: 'different-active-image' } },
    },
  };
}

for (const image of ['new-work-image', 'imported-work-image']) {
  test(`configuration preserves ${image} while editing other fields and empty selections`, () => {
    const { raw, config } = fixture(image);
    assert.equal(Object.hasOwn(JSON.parse(config.advanced), 'agentImage'), false);
    config.agents = 'edited';
    let saved = synchronizeConfiguration(config);
    assert.deepEqual(saved, { ...raw, agentsMd: 'edited' });
    editAdvanced(config, JSON.stringify({ ...JSON.parse(config.advanced), skills: [], packages: [], agentsMd: '', modelRef: 'changed-model' }));
    saved = synchronizeConfiguration(config);
    assert.deepEqual(saved.agentImage, raw.agentImage);
    assert.deepEqual(config.skills, []);
    assert.deepEqual(config.packages, []);
    assert.equal(config.agents, '');
    assert.equal(saved.modelRef, 'changed-model');
    assert.deepEqual(saved.resources, raw.resources);
    assert.equal(Object.hasOwn(JSON.parse(config.advanced), 'agentImage'), false);
  });
}

test('configuration rejects different, null, and malformed image imports without consuming the draft', () => {
  for (const image of [{ catalogId: 'replacement' }, null, 'replacement', { catalogId: 'work-owned-image', unexpected: true }]) {
    const { config } = fixture();
    const text = JSON.stringify({ ...JSON.parse(config.advanced), agentImage: image, agentsMd: 'keep input' });
    editAdvanced(config, text);
    assert.match(config.validationError, /agentImage/);
    assert.throws(() => synchronizeConfiguration(config), /agentImage/);
    assert.equal(config.advanced, text);
    assert.equal(config.agents, 'original');
    editAdvanced(config, JSON.stringify({ agentsMd: 'corrected', skills: [], packages: [] }));
    assert.equal(synchronizeConfiguration(config).agentsMd, 'corrected');
    assert.deepEqual(config.agentImage, { catalogId: 'work-owned-image' });
  }
});

test('configuration accepts an unchanged imported image and removes its redundant editable field', () => {
  const { raw, config } = fixture();
  editAdvanced(config, JSON.stringify(raw));
  assert.deepEqual(synchronizeConfiguration(config), raw);
  assert.equal(Object.hasOwn(JSON.parse(config.advanced), 'agentImage'), false);
});
