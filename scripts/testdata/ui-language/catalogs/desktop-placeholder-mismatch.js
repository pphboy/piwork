import { catalog as valid } from './desktop-valid.js';

const catalog = structuredClone(valid);
catalog.en['view.parameterName'] = 'Hello {name}';
catalog['zh-CN']['view.parameterName'] = '你好 {nom}';
catalog.en['view.duplicate'] = 'Open {target}';
catalog['zh-CN']['view.duplicate'] = '打开 {target} {target}';
export { catalog };
