import { adapter } from './adapter.js';

/** Model management cannot call unrelated Console endpoints through this port. */
export interface ModelWrite {
  name: string;
  model: string;
  api: string;
  baseUrl: string;
  credential?: string;
}
export interface ModelTestInput {
  modelId?: string;
  api: string;
  baseUrl: string;
  model: string;
  credential?: string;
}
export interface ModelPort {
  readonly identityEpoch: number;
  readModels(): Promise<Record<string, any>>;
  create(input: ModelWrite): Promise<Record<string, any>>;
  update(id: string, input: ModelWrite): Promise<Record<string, any>>;
  setEnabled(id: string, enabled: boolean): Promise<Record<string, any>>;
  remove(id: string): Promise<Record<string, any>>;
  chooseForFutureWork(modelRef: string): Promise<Record<string, any>>;
  test(input: ModelTestInput): Promise<Record<string, any>>;
}
export const modelPort: ModelPort = {
  get identityEpoch() { return adapter.identityEpoch; },
  readModels: () => adapter.modelRequest('models'),
  create: input => adapter.modelRequest('models', 'POST', input),
  update: (id, input) => adapter.modelRequest(`models/${encodeURIComponent(id)}`, 'PATCH', input),
  setEnabled: (id, enabled) => adapter.modelRequest(`models/${encodeURIComponent(id)}/${enabled ? 'enable' : 'disable'}`, 'POST', {}),
  remove: id => adapter.modelRequest(`models/${encodeURIComponent(id)}`, 'DELETE'),
  chooseForFutureWork: modelRef => adapter.modelRequest('default-work', 'PATCH', { modelRef }),
  test: input => adapter.modelRequest('model-tests', 'POST', input),
};
