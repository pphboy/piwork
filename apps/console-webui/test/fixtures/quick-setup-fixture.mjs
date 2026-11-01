/** Small DOM surface for the real mounted feature. Browser geometry stays in Playwright. */
export function setupRoot() {
  const listeners = new Map();
  const fields = new Map();
  const values = {
    'model-name': 'Fixture model', 'model-id': 'fixture-model', 'model-api': 'openai-responses',
    'model-base-url': 'https://model.example.invalid/v1', 'model-key': 'synthetic-key',
  };
  class Input {
    constructor(id) {
      this.id = id;
      this.dataset = {};
      this.validity = { valid: true };
      this.validationMessage = '';
      this.disabled = false;
    }
    get value() { return values[this.id] || ''; }
    set value(value) { values[this.id] = value; }
    closest(selector) { return selector === '#model-form' ? form : null; }
    setAttribute() {}
    removeAttribute() {}
    setCustomValidity() {}
    focus() { root.focused = this.id; }
  }
  for (const name of Object.keys(values)) fields.set('#' + name, new Input(name));
  const form = { values, querySelectorAll: () => [...fields.values()] };
  const nodes = new Map([
    ['#setup-notice', { innerHTML: '' }], ['#setup-status', { innerHTML: '' }],
    ['#model-advanced', { open: true }], ['#model-test-result', { innerHTML: '' }],
    ['#test-body', { innerHTML: '' }],
  ]);
  const dialog = () => ({ open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  nodes.set('#test-dialog', dialog());
  nodes.set('#leave-dialog', dialog());
  const root = {
    innerHTML: '', focused: '', values, nodes,
    querySelector(selector) {
      if (selector === '#model-form') return this.innerHTML.includes('id="model-form"') ? form : null;
      if (selector === '#model-key') return this.innerHTML.includes('id="model-form"') ? fields.get(selector) : null;
      return nodes.get(selector) || fields.get(selector) || null;
    },
    querySelectorAll(selector) {
      if (selector === 'input[type=password]') return [fields.get('#model-key')];
      if (selector === 'form input, form select') return [...fields.values()];
      if (selector === 'dialog[open]') return [...nodes.values()].filter(node => node.open && typeof node.close === 'function');
      return [];
    },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
    fire(name, target = form) {
      listeners.get(name)?.({ target, button: 0, preventDefault() {}, stopPropagation() {} });
    },
    action(name) {
      this.fire('click', { dataset: { action: name }, closest(selector) {
        return selector === '[data-action],[data-model-action]' ? this : null;
      } });
    },
    modelAction(name) {
      this.fire('click', { dataset: { modelAction: name }, closest(selector) {
        return selector === '[data-action],[data-model-action]' ? this : null;
      } });
    },
    input(id, value) {
      values[id] = value;
      this.fire('input', fields.get('#' + id));
    },
    output() { return this.innerHTML + [...nodes.values()].map(node => node.innerHTML || '').join(''); },
  };
  globalThis.HTMLInputElement = Input;
  globalThis.FormData = class {
    constructor(input) { this.values = input.values; }
    get(key) { return this.values[key]; }
  };
  globalThis.document = { documentElement: { lang: 'en', setAttribute() {} }, querySelector: () => null };
  globalThis.confirm = () => true;
  return root;
}
export const settle = async () => {
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
};
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes;
  reject = no; });
  return { promise, resolve, reject };
};
export const model = (id = 'model-fixture', extra = {}) => ({
  id, modelRef: id, name: 'Fixture model', model: 'fixture-model', api: 'openai-responses',
  baseUrl: 'https://model.example.invalid/v1', enabled: true, credentialAvailable: true, ...extra,
});
export const initialSnapshot = () => ({ administrator: true, runtime: { configured: false }, defaultAgentImage: 'agent:fixture' });
