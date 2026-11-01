import { adapter } from './adapter.js';
export const modelPort = {
    get identityEpoch() { return adapter.identityEpoch; },
    readModels: () => adapter.modelRequest('models'),
    create: input => adapter.modelRequest('models', 'POST', input),
    update: (id, input) => adapter.modelRequest(`models/${encodeURIComponent(id)}`, 'PATCH', input),
    setEnabled: (id, enabled) => adapter.modelRequest(`models/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, 'POST', {}),
    remove: id => adapter.modelRequest(`models/${encodeURIComponent(id)}`, 'DELETE'),
    chooseForFutureWork: modelRef => adapter.modelRequest('default-work', 'PATCH', { modelRef }),
    test: input => adapter.modelRequest('model-tests', 'POST', input),
};
//# sourceMappingURL=model-port.js.map