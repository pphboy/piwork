import { catalog as valid } from './desktop-valid.js';

const catalog = structuredClone(valid);
catalog['zh-CN']['view.extra'] = '仅中文词条';
export { catalog };
